/**
 * أداة تشخيص تعرض أعمدة جداول قاعدة البيانات للتحقق من بنية البيئة الحالية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// يقرأ تعريفات الأعمدة من information_schema للتشخيص دون تعديل المخطط.
async function main() {
  try {
    const result = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'user_roles')
      ORDER BY table_name, ordinal_position
    `);

    console.table(result.rows);
  } catch (error) {
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

main();
