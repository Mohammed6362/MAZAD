const pool = require('../db');
const error = require('../utils/httpError');

// المزادات أولًا ثم السيارة والمحافظ؛ لا يزيل السجل المالي أو يغيّر فواتير البيع القائمة.
module.exports = async function deleteListing(carId, adminId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: locked } = await client.query(
        'SELECT id FROM auctions WHERE car_id=$1 ORDER BY id FOR UPDATE',
        [carId],
      );
      const {
        rows: [car],
      } = await client.query('SELECT id,status FROM cars WHERE id=$1 FOR UPDATE', [carId]);
      if (!car) throw error(404, 'السيارة غير موجودة.');
      if (car.status === 'deleted') {
        await client.query('COMMIT');
        return { success: true, message: 'تم حذف السيارة.', already_deleted: true };
      }
      // قد تكون الجدولة سبقت قفل السيارة؛ نعيد المحاولة بدل عكس ترتيب الأقفال.
      const { rows: current } = await client.query('SELECT id FROM auctions WHERE car_id=$1', [
        carId,
      ]);
      if (current.some((auction) => !locked.some((row) => row.id === auction.id))) {
        await client.query('ROLLBACK');
        continue;
      }
      const { rows: open } = await client.query(
        "SELECT id FROM auctions WHERE car_id=$1 AND status IN ('scheduled','active') ORDER BY id",
        [carId],
      );
      const openIds = open.map((auction) => auction.id);
      await client.query(
        'SELECT user_id FROM wallets WHERE user_id IN (SELECT user_id FROM wallet_holds WHERE auction_id=ANY($1::bigint[])) ORDER BY user_id FOR UPDATE',
        [openIds],
      );
      await client.query('DELETE FROM wallet_holds WHERE auction_id=ANY($1::bigint[])', [openIds]);
      // إبقاء العروض السابقة ثابتة مع إشعار أصحابها بإلغاء المزاد.
      await client.query(
        `INSERT INTO notifications(user_id,title,body,link)
         SELECT DISTINCT bidder_id,'تم إلغاء المزاد','حذفت الإدارة عرض السيارة وألغت المزاد. فُك أي حجز للمزايدة على هذا المزاد.','/account/bids'
         FROM bids WHERE auction_id=ANY($1::bigint[])`,
        [openIds],
      );
      await client.query("UPDATE auctions SET status='cancelled' WHERE id=ANY($1::bigint[])", [
        openIds,
      ]);
      await client.query(
        "UPDATE cars SET status='deleted',deleted_at=clock_timestamp(),deleted_by=$2 WHERE id=$1",
        [carId, adminId],
      );
      await client.query('COMMIT');
      return { success: true, message: 'تم حذف السيارة.', cancelled_auctions: openIds.length };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (['40P01', '40001'].includes(err.code) && attempt < 4) continue;
      throw err;
    } finally {
      client.release();
    }
  }
  throw error(409, 'تغيّرت مزادات السيارة أثناء الحذف. أعد المحاولة.');
};
