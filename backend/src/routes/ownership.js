/**
 * مستندات الإدارة، وعرض أوراق الملكية المرتبطة بمزاد سيارة معتمدة؛ الجواز يبقى للإدارة فقط.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const path = require('node:path');
const pool = require('../db');
const { uploadsRoot } = require('../config');
const { requireRole } = require('../middleware/auth');
const { respondError } = require('../utils/http');
const { carVisibilitySql, viewerParameters } = require('../utils/carVisibility');
module.exports = (app) => {
  // الأوراق تُعرض من خلال المزاد المعتمد، دون فتح مجلد التخزين الخاص للعامة.
  app.get('/api/auctions/:id/ownership', async (req, res, next) => {
    try {
      const auction = await pool.query(
        `SELECT a.car_id FROM auctions a JOIN cars c ON c.id=a.car_id
         WHERE a.id=$1 AND ${carVisibilitySql()} AND c.ownership_status='verified'`,
        [req.params.id, ...viewerParameters(req)],
      );
      if (!auction.rowCount) return respondError(res, 404, 'أوراق الملكية غير متاحة لهذا المزاد.');
      const result = await pool.query(
        'SELECT id,mime_type FROM car_ownership_documents WHERE car_id=$1 ORDER BY id',
        [auction.rows[0].car_id],
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        documents: result.rows.map((doc) => ({
          ...doc,
          url: `/api/auctions/${req.params.id}/ownership/${doc.id}`,
        })),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/auctions/:id/ownership/:documentId', async (req, res, next) => {
    try {
      const {
        rows: [doc],
      } = await pool.query(
        `SELECT d.id,d.storage_key,d.mime_type FROM car_ownership_documents d
         JOIN cars c ON c.id=d.car_id JOIN auctions a ON a.car_id=c.id
         WHERE a.id=$1 AND d.id=$2 AND ${carVisibilitySql('$3', '$4')} AND c.ownership_status='verified'`,
        [req.params.id, req.params.documentId, ...viewerParameters(req)],
      );
      if (!doc || !/^private\/ownership\/[a-f0-9-]+\.(jpg|jpeg|png|webp)$/.test(doc.storage_key))
        return respondError(res, 404, 'المستند غير متاح لهذا المزاد.');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="ownership-${doc.id}${path.extname(doc.storage_key)}"`,
      );
      res.sendFile(path.join(uploadsRoot, doc.storage_key), (error) => {
        if (error && !res.headersSent) respondError(res, 404, 'المستند غير متاح.');
      });
    } catch (error) {
      next(error);
    }
  });
  // يرسل صورة الجواز لمدير نشط فقط ويتحقق من مسار التخزين ويمنع حفظها في ذاكرة التخزين المؤقت.
  app.get('/api/admin/users/:id/passport', requireRole('admin'), async (req, res, next) => {
    try {
      const {
        rows: [doc],
      } = await pool.query('SELECT storage_key,mime_type FROM user_passports WHERE user_id=$1', [
        req.params.id,
      ]);
      if (!doc || !/^private\/passports\/[a-f0-9-]+\.(jpg|jpeg|png|webp)$/.test(doc.storage_key))
        return respondError(res, 404, 'لا توجد صورة جواز محفوظة لهذا الحساب.');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="passport${path.extname(doc.storage_key)}"`,
      );
      res.sendFile(path.join(uploadsRoot, doc.storage_key), (error) => {
        if (error && !res.headersSent) respondError(res, 404, 'صورة الجواز غير متاحة.');
      });
    } catch (error) {
      next(error);
    }
  });
  // قائمة روابط المستندات المحمية للسيارة؛ كل فتح للرابط يفحص صلاحية المدير من جديد.
  app.get('/api/admin/cars/:id/ownership', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT id,mime_type,created_at FROM car_ownership_documents WHERE car_id=$1 ORDER BY id',
        [req.params.id],
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        documents: result.rows.map((doc) => ({ ...doc, url: `/api/admin/ownership/${doc.id}` })),
      });
    } catch (error) {
      next(error);
    }
  });
  // إرسال صورة ملكية خاصة بعد فحص الدور ومفتاح الملف، دون استخدام مجلد الصور العام.
  app.get('/api/admin/ownership/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const {
        rows: [doc],
      } = await pool.query(
        'SELECT id,storage_key,mime_type FROM car_ownership_documents WHERE id=$1',
        [req.params.id],
      );
      if (!doc || !/^private\/ownership\/[a-f0-9-]+\.(jpg|jpeg|png|webp)$/.test(doc.storage_key))
        return respondError(res, 404, 'المستند غير موجود.');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="ownership-${doc.id}${path.extname(doc.storage_key)}"`,
      );
      res.sendFile(path.join(uploadsRoot, doc.storage_key), (error) => {
        if (error && !res.headersSent) respondError(res, 404, 'المستند غير متاح.');
      });
    } catch (error) {
      next(error);
    }
  });
};
