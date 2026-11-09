/**
 * مجموعة اتصالات PostgreSQL المشتركة؛ تقرأ إعدادات البيئة وحدود الاتصال وتبلغ عن أخطاء المجموعة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
require('./config');
const { Pool } = require('pg');
const pool = new Pool({
  options: process.env.DB_OPTIONS,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));

module.exports = pool;
