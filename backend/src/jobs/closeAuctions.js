/**
 * عامل كل خمس ثوانٍ يغلق المزادات المنتهية وينهي مهلة الفواتير، ويمنع تداخل دورتي العمل في العملية نفسها.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { closeAuction } = require('../services/auctions');
const { expireUnpaidInvoices } = require('../services/sales');
// يعالج دفعة مزادات انتهى وقتها؛ يتجاهل تعارض الإغلاق إذا سبقه عامل آخر إلى المزاد.
async function closeEndedAuctions() {
  const { rows } = await pool.query(
    "SELECT id FROM auctions WHERE status IN ('active','scheduled') AND end_time<=clock_timestamp() ORDER BY end_time LIMIT 25",
  );
  let closed = 0;
  for (const { id } of rows) {
    try {
      await closeAuction(id);
      closed++;
    } catch (error) {
      if (error.status !== 409)
        console.error(
          JSON.stringify({
            event: 'auction_close_error',
            auction_id: id,
            code: error.code || error.status || error.name,
          }),
        );
    }
  }
  return closed;
}
// يبدأ العامل الدوري مرة واحدة؛ لا يشغل دورة جديدة قبل اكتمال السابقة، ويعيد دالة لإيقافه بأمان.
function startAuctionCloser() {
  let active = null;
  const tick = () => {
    if (active) return;
    active = closeEndedAuctions()
      .then(() => expireUnpaidInvoices())
      .catch((error) =>
        console.error(
          JSON.stringify({ event: 'auction_worker_error', code: error.code || error.name }),
        ),
      )
      .finally(() => {
        active = null;
      });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
module.exports = { closeEndedAuctions, startAuctionCloser };
