/**
 * يجهز طلب تسجيل اختباري بمرفق جواز اصطناعي حتى تستخدم الاختبارات عقد التسجيل الفعلي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const fs = require('node:fs');
const path = require('node:path');
const passport = fs.readFileSync(path.resolve(__dirname, '../../fixtures/car.png'));
module.exports = function registration(body) {
  if (body instanceof FormData) return body;
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => form.append(key, String(value)));
  form.append('passport_image', new Blob([passport], { type: 'image/png' }), 'passport.png');
  return form;
};
