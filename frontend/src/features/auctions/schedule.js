/**
 * تحويل تاريخ وساعة الجدولة من توقيت ليبيا إلى UTC، ورفض التاريخ غير الصالح وحساب مدة المزاد.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Auction scheduling uses Libya's UTC+02:00 time, independent of the device's zone.
// يفسر التاريخ والساعة على أساس توقيت ليبيا الثابت UTC+02:00 ويرفض التطبيع الصامت للتواريخ غير الموجودة.
export function auctionDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00+02:00`);
  if (Number.isNaN(value.getTime())) return null;
  // Reject normalized dates such as February 30 rather than silently moving them.
  const local = new Date(value.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return local === `${date}T${time}` ? value.toISOString() : null;
}

// يعيد تاريخ اليوم في ليبيا بصيغة حقل التاريخ حتى لا يتأثر حد الإدخال الأدنى بتوقيت الجهاز.
export function libyaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tripoli',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// يحسب فرق الموعدين بالدقائق ثم يعرض الأيام والساعات والدقائق الموجبة في ملخص الجدولة.
export function auctionDuration(start, end) {
  const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return [
    [Math.floor(minutes / 1440), 'يوم'],
    [Math.floor((minutes % 1440) / 60), 'ساعة'],
    [minutes % 60, 'دقيقة'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, unit]) => `${count} ${unit}`)
    .join(' و');
}
