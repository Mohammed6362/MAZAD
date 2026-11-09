/**
 * أدوات مشتركة للجلسات ورسائل الأخطاء والحقول النصية والأرقام الاختيارية بدل تكرارها في المسارات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// يحوّل عمليات الجلسة التي تستخدم callback إلى Promise حتى يمكن انتظار اكتمال الحفظ أو الإنهاء.
function sessionOperation(req, method) {
  return new Promise((resolve, reject) =>
    req.session[method]((error) => (error ? reject(error) : resolve())),
  );
}
// يرجع خطأ API موحدًا مع الحالة المناسبة وعبارة يمكن للواجهة عرضها.
function respondError(res, status, message) {
  return res.status(status).json({ success: false, message });
}
// يقص الفراغات والطول الزائد من النص؛ القيم غير النصية تصبح حقلًا فارغًا.
function trimField(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
// يميز الحقل الفارغ عن العدد الصحيح وعن القيمة غير الصالحة حتى لا تتحول الأخطاء إلى صفر.
function optionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d+$/.test(String(value))) return NaN;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : NaN;
}

module.exports = { sessionOperation, respondError, trimField, optionalInteger };
