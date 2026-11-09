/**
 * ينشئ خطأ يحمل حالة HTTP ورسالة آمنة يمكن عرضها للمستخدم من معالج الأخطاء المركزي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
module.exports = function httpError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: true });
};
