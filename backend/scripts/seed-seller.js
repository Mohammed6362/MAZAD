/**
 * تهيئة حساب اختبار ببيانات ثابتة داخل السكربت؛ الاتصال بقاعدة البيانات يأتي من البيئة، وليس هذا مسار التسجيل العام.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool(require('../src/databaseOptions')());

// يعيد استخدام حساب الاختبار أو ينشئه بالبيانات الثابتة، ثم يمنحه دور المستخدم دون تغيير كلمة مرور حساب موجود.
async function main() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const phone = '0910000001';
    const password = 'MazadTest2026!';

    let result = await client.query('SELECT id FROM users WHERE phone = $1', [phone]);

    let userId;

    if (result.rows.length > 0) {
      userId = result.rows[0].id;
      console.log('Using existing user ID:', userId);
    } else {
      const passwordHash = await bcrypt.hash(password, 12);

      result = await client.query(
        `INSERT INTO users
          (full_name, phone, password_hash, status, is_verified)
         VALUES ($1, $2, $3, 'active', false)
         RETURNING id`,
        ['Mazad Test User', phone, passwordHash],
      );

      userId = result.rows[0].id;
      console.log('Created user ID:', userId);
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'user')
       ON CONFLICT DO NOTHING`,
      [userId],
    );

    await client.query('COMMIT');
    console.log('Test user is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exitCode = 1;
});
