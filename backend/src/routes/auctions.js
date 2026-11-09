/**
 * قراءة بيانات المزاد والعروض العامة وإرسال المزايدة؛ يحول أخطاء قواعد البيانات إلى رسائل مفهومة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { parseAmount } = require('../utils/money');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { respondError } = require('../utils/http');
const { carVisibilitySql, viewerParameters } = require('../utils/carVisibility');
module.exports = function registerRoutes(app) {
  // عرض معلومات المزاد والحالة المحسوبة بوقت الخادم دون كشف قيمة حد البيع الخاص.
  app.get('/api/auctions/:id', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT a.id, a.car_id, a.starting_price, a.current_price, a.min_increment,
              a.bid_count, a.start_time, a.end_time, a.payment_mode,a.payment_due_hours,a.soft_close_seconds,COALESCE((SELECT amount FROM wallet_holds WHERE auction_id=a.id AND user_id=$2::bigint),0) AS my_held_amount,clock_timestamp() AS server_time, (a.reserve_price IS NOT NULL) AS has_reserve, (a.reserve_price IS NULL OR (a.bid_count>0 AND a.current_price>=a.reserve_price)) AS reserve_met,
              CASE WHEN a.status IN ('active','scheduled') AND a.start_time <= NOW() AND a.end_time > NOW() THEN 'active'
                   WHEN a.status IN ('active','scheduled') AND a.start_time > NOW() AND a.end_time > NOW() THEN 'scheduled'
                   WHEN a.status IN ('active','scheduled') AND a.end_time <= NOW() THEN 'ended' ELSE a.status::text END AS status,
              c.make, c.model, c.year, c.location, COALESCE(c.seller_id=$2::bigint,FALSE) AS is_owner
       FROM auctions a JOIN cars c ON c.id = a.car_id
       WHERE a.id = $1 AND ${carVisibilitySql()}`,
        [req.params.id, ...viewerParameters(req)],
      );
      if (!result.rowCount) return respondError(res, 404, 'المزاد غير موجود.');
      return res.json({ success: true, auction: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });
  // عرض أعلى العروض دون بيانات هوية المزايدين الشخصية.
  app.get('/api/auctions/:id/bids', async (req, res, next) => {
    try {
      const exists = await pool.query(
        `SELECT 1 FROM auctions a JOIN cars c ON c.id=a.car_id WHERE a.id=$1 AND ${carVisibilitySql()}`,
        [req.params.id, ...viewerParameters(req)],
      );
      if (!exists.rowCount) return respondError(res, 404, 'المزاد غير موجود.');
      const result = await pool.query(
        'SELECT id, amount, placed_at FROM bids WHERE auction_id = $1 ORDER BY amount DESC, placed_at DESC LIMIT 50',
        [req.params.id],
      );
      return res.json({ success: true, count: result.rowCount, bids: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // قبول عرض من حساب مخول؛ دالة قاعدة البيانات تتولى قفل المزاد والحجز والزيادة والوقت بشكل ذري.
  app.post('/api/auctions/:id/bids', requireRole('user', 'can_bid'), async (req, res, next) => {
    const amount = parseAmount(req.body?.amount);
    if (!amount) return respondError(res, 400, 'أدخل قيمة مزايدة صالحة.');
    try {
      const result = await pool.query(
        'INSERT INTO bids (auction_id, bidder_id, amount) VALUES ($1,$2,$3) RETURNING id, auction_id, amount, placed_at',
        [req.params.id, req.session.userId, amount],
      );
      return res
        .status(201)
        .json({ success: true, message: 'تم تسجيل مزايدتك.', bid: result.rows[0] });
    } catch (error) {
      if (
        error.code === 'P0001' &&
        error.message?.includes('Insufficient available wallet balance')
      )
        return respondError(
          res,
          409,
          'رصيد محفظتك المتاح غير كافٍ لحجز هذا العرض. اشحن محفظتك أولًا.',
        );
      if (error.code === '23503') return respondError(res, 404, 'المزاد غير موجود.');
      if (error.code === '23505')
        return respondError(res, 409, 'توجد مزايدة بالقيمة نفسها بالفعل.');
      if (error.code === 'P0001' && error.message?.includes('Minimum bid amount'))
        return respondError(res, 409, 'المبلغ أقل من الحد الأدنى للمزايدة التالية.');
      if (error.code === 'P0001' && error.message?.includes('Seller cannot bid'))
        return respondError(res, 403, 'لا يمكن للبائع المزايدة على سيارته.');
      if (error.code === 'P0001')
        return respondError(res, 409, 'المزاد غير مفتوح للمزايدة أو لم تعد السيارة متاحة.');
      return next(error);
    }
  });
};
