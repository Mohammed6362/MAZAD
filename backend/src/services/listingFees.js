/**
 * خصم رسوم أول اعتماد للسيارة فقط؛ يحترم حجوزات العارض ويسجل الرسم والإشعار داخل معاملة المراجعة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const error = require('../utils/httpError');

// Caller holds the car lock. All money changes share its review transaction.
// ينفذ رسم أول اعتماد تحت قفل السيارة والمحفظة، ويستبعد الحجوزات من الرصيد القابل للخصم.
async function chargeListingFee(client, car) {
  const {
    rows: [seller],
  } = await client.query('SELECT status,can_list FROM users WHERE id=$1', [car.seller_id]);
  if (seller.status !== 'active' || !seller.can_list)
    throw error(409, 'حساب العارض موقوف أو لا يملك صلاحية عرض السيارات.');
  // القيمة null تعني أن أول اعتماد لم يُسوَّ بعد؛ الصفر قيمة مسددة أو معفاة ولا يعني إعادة الخصم.
  if (car.listing_fee_amount !== null) return;
  const {
    rows: [policy],
  } = await client.query('SELECT listing_fee FROM platform_settings WHERE id=1');
  const {
    rows: [wallet],
  } = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [
    car.seller_id,
  ]);
  // الرصيد المحجوز للمزايدات غير متاح للرسوم؛ الخصم يجب أن يترك تغطية كاملة لكل الحجوزات.
  const {
    rows: [funds],
  } = await client.query(
    'SELECT $2::numeric-COALESCE(SUM(amount),0)>=$3::numeric AS sufficient FROM wallet_holds WHERE user_id=$1',
    [car.seller_id, wallet.balance, policy.listing_fee],
  );
  if (!funds.sufficient)
    throw error(
      409,
      `رصيد العارض المتاح غير كافٍ لرسوم عرض السيارة (${policy.listing_fee} د.ل). اطلب منه شحن المحفظة ثم أعد الاعتماد.`,
    );
  if (Number(policy.listing_fee) > 0) {
    const {
      rows: [updated],
    } = await client.query(
      'UPDATE wallets SET balance=balance-$2::numeric,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING balance',
      [car.seller_id, policy.listing_fee],
    );
    // الحركة مرتبطة بالسيارة وفهرسها الفريد يمنع رسم عرض ثانٍ للسيارة نفسها حتى مع إعادة الطلب.
    await client.query(
      "INSERT INTO wallet_transactions(user_id,car_id,kind,amount,balance_after) VALUES($1,$2,'listing_fee',-$3::numeric,$4)",
      [car.seller_id, car.id, policy.listing_fee, updated.balance],
    );
    await client.query(
      "INSERT INTO notifications(user_id,title,body,link) VALUES($1,'خصم رسوم عرض السيارة',$2,'/account/wallet')",
      [
        car.seller_id,
        `خُصمت رسوم عرض السيارة رقم ${car.id}: ${policy.listing_fee} د.ل، مرة واحدة عند الاعتماد.`,
      ],
    );
  }
  await client.query('UPDATE cars SET listing_fee_amount=$2 WHERE id=$1', [
    car.id,
    policy.listing_fee,
  ]);
}
module.exports = { chargeListingFee };
