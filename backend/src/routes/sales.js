/**
 * واجهة إجراءات دورة البيع؛ تربط صلاحيات البائع والمشتري والإدارة بخدمة السداد والتسليم والاعتراض.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { requireUser, requireRole } = require('../middleware/auth');
const { processSale } = require('../services/sales');
module.exports = (app) => {
  // إجراءات الأطراف تستخدم جلسة عادية؛ خدمة processSale تحدد إن كان الفاعل البائع أو المشتري المسموح.
  for (const action of ['handover', 'receive', 'dispute']) {
    app.post('/api/invoices/:id/' + action, requireUser, async (req, res, next) => {
      try {
        res.json(await processSale(req.params.id, req.auth.id, action, req.body));
      } catch (error) {
        next(error);
      }
    });
  }
  // إجراءات الإدارة تستخدم الحارس الإداري، وتحوّل اسم pay إلى manual_pay لتفريقه عن سداد المحفظة.
  for (const [route, action] of [
    ['pay', 'manual_pay'],
    ['cancel', 'cancel'],
    ['resume', 'resume'],
  ]) {
    app.post('/api/admin/invoices/:id/' + route, requireRole('admin'), async (req, res, next) => {
      try {
        const result = await processSale(req.params.id, req.auth.id, action, req.body, true);
        res.status(result.expired ? 409 : 200).json(result);
      } catch (error) {
        next(error);
      }
    });
  }
  // قراءة سجل المعاملة الثابت لطرفيها أو للإدارة دون كشفه لحساب غريب.
  app.get('/api/invoices/:id/events', requireUser, async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT e.id,e.kind,e.note,e.created_at FROM invoice_events e JOIN invoices i ON i.id=e.invoice_id WHERE i.id=$1 AND (i.buyer_id=$2 OR i.seller_id=$2 OR $3::boolean) ORDER BY e.id',
        [req.params.id, req.auth.id, req.auth.roles.includes('admin')],
      );
      res.json({ success: true, events: result.rows });
    } catch (error) {
      next(error);
    }
  });
};
