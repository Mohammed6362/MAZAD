/**
 * مجموعة اتصالات PostgreSQL المشتركة؛ تقرأ إعدادات البيئة وحدود الاتصال وتبلغ عن أخطاء المجموعة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
require('./config');
const { Pool } = require('pg');
const pool = new Pool(require('./databaseOptions')());
pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));

module.exports = pool;
