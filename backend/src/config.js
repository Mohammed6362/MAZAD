/**
 * تحميل إعدادات البيئة وتوحيد منفذ الخادم ومدة الجلسة ومسارات الصور ونسخة الواجهة المبنية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
module.exports = {
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET,
  sessionTtl: 8 * 60 * 60 * 1000,
  uploadsRoot: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, '../uploads'),
  frontendDist: path.resolve(__dirname, '../../frontend/dist'),
};
