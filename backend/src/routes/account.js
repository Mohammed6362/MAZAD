/**
 * قوائم مزايدات المستخدم وفواتيره كطرف بيع أو شراء؛ يحد الاستعلام بكل حساب ولا يكشف فواتير الآخرين.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { requireRole, requireUser } = require('../middleware/auth');
const { respondError } = require('../utils/http');

module.exports = function registerAccountRoutes(app) {
  // تجميع مشاركات صاحب الحساب في المزادات وإضافة الفاتورة فقط عندما يكون طرفًا فيها. المسار القديم يبقى اسمًا بديلًا للتوافق.
  app.get(['/api/account/bids', '/api/buyer/bids'], requireRole('user'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `
        SELECT a.id AS auction_id, a.car_id, a.current_price, a.bid_count,
          a.status, a.start_time, a.end_time, a.winner_id, c.make, c.model, c.year, c.status AS car_status,
          i.id AS invoice_id,i.sale_status,i.due_at,
          MAX(b.amount) AS my_amount, MAX(b.placed_at) AS last_bid_at,
          (SELECT bidder_id = $1 FROM bids WHERE auction_id = a.id ORDER BY amount DESC LIMIT 1) AS leading
        FROM bids b JOIN auctions a ON a.id = b.auction_id JOIN cars c ON c.id = a.car_id LEFT JOIN invoices i ON i.auction_id=a.id AND (i.buyer_id=$1 OR i.seller_id=$1)
        WHERE b.bidder_id = $1 GROUP BY a.id, c.id,i.id ORDER BY MAX(b.placed_at) DESC`,
        [req.session.userId],
      );
      res.json({ success: true, bids: result.rows });
    } catch (error) {
      next(error);
    }
  });

  // عرض فواتير الجلسة كطرف بيع أو شراء، مع حالة الدفع والتسليم والضمان.
  app.get('/api/invoices', requireUser, async (req, res, next) => {
    if (!req.session.userId) return respondError(res, 401, 'سجّل الدخول للمتابعة.');
    try {
      const active = await pool.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [
        req.session.userId,
      ]);
      if (!active.rowCount) return respondError(res, 403, 'الحساب غير نشط.');
      const result = await pool.query(
        `
        SELECT i.*, a.payment_mode, c.make, c.model, c.year
        FROM invoices i JOIN auctions a ON a.id = i.auction_id JOIN cars c ON c.id = a.car_id
        WHERE i.buyer_id = $1 OR i.seller_id = $1 ORDER BY i.issued_at DESC`,
        [req.session.userId],
      );
      res.json({ success: true, invoices: result.rows });
    } catch (error) {
      next(error);
    }
  });
};
