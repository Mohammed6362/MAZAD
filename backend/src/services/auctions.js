/**
 * إغلاق المزاد داخل معاملة وقفل سجله؛ اختيار أعلى عرض مستوفٍ لحد البيع وإنشاء فاتورة أو فك الحجز.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const crypto = require('node:crypto');
const error = require('../utils/httpError');
// يقفل سجل المزاد حتى لا تتسابق المزايدة والإغلاق؛ ينشئ فاتورة واحدة للفائز أو يفك الحجز عند عدم البيع.
async function closeAuction(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      rows: [auction],
    } = await client.query(
      `SELECT a.*,c.seller_id FROM auctions a JOIN cars c ON c.id=a.car_id WHERE a.id=$1 FOR UPDATE OF a`,
      [id],
    );
    if (!auction) throw error(404, 'المزاد غير موجود.');
    const {
      rows: [clock],
    } = await client.query('SELECT clock_timestamp() AS now');
    if (
      !['active', 'scheduled'].includes(auction.status) ||
      new Date(auction.end_time) > new Date(clock.now)
    )
      throw error(409, 'المزاد لم ينتهِ أو سبق إغلاقه.');
    const {
      rows: [highest],
    } = await client.query(
      'SELECT bidder_id,amount FROM bids WHERE auction_id=$1 ORDER BY amount DESC,placed_at,id LIMIT 1',
      [id],
    );
    const winner =
      highest &&
      (auction.reserve_price === null || Number(highest.amount) >= Number(auction.reserve_price))
        ? highest
        : null;
    const {
      rows: [hold],
    } = await client.query('SELECT user_id FROM wallet_holds WHERE auction_id=$1', [id]);
    if (hold)
      await client.query('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE', [hold.user_id]);
    await client.query("UPDATE auctions SET status='closed',winner_id=$2 WHERE id=$1", [
      id,
      winner?.bidder_id || null,
    ]);
    let invoice = null;
    if (winner) {
      await client.query("UPDATE cars SET status='sold' WHERE id=$1", [auction.car_id]);
      const number = `ML-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const result = await client.query(
        "INSERT INTO invoices(invoice_number,auction_id,buyer_id,seller_id,winning_amount,due_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6*INTERVAL '1 hour')) RETURNING *",
        [number, id, winner.bidder_id, auction.seller_id, winner.amount, auction.payment_due_hours],
      );
      invoice = result.rows[0];
    } else await client.query('DELETE FROM wallet_holds WHERE auction_id=$1', [id]);
    await client.query('COMMIT');
    return {
      success: true,
      message: winner
        ? 'أُغلق المزاد وأُنشئت فاتورة للفائز.'
        : 'أُغلق المزاد دون بيع وفُك حجز الرصيد التجريبي.',
      winner: winner ? { user_id: winner.bidder_id, amount: winner.amount } : null,
      invoice,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { closeAuction };
