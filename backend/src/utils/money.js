/**
 * يتحقق من المبلغ دون الاعتماد على حسابات الفاصلة العائمة، ويعيد سلسلة بثلاث خانات عشرية للمحفظة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Keep monetary values as decimal strings. PostgreSQL performs all balance arithmetic.
// يفحص شكل المبلغ وحدوده ثم يوحد الخانات العشرية؛ الحساب المالي الفعلي يبقى داخل PostgreSQL NUMERIC.
function parseAmount(value, max = '99999999999') {
  const text = String(value ?? '').trim();
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (minor <= 0n || minor > BigInt(max) * 1000n) return null;
  return `${BigInt(whole)}.${fraction.padEnd(3, '0')}`;
}
module.exports = { parseAmount };
