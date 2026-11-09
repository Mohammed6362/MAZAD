/**
 * تطبيق ملفات التحديث SQL بالترتيب على قاعدة مهيأة، دون إعادة إنشاء المخطط الأساسي فوق البيانات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// يتحقق من وجود الجداول الأساسية ثم ينفذ التحديثات بترتيب أسمائها دون حذف بيانات التشغيل.
async function migrateDatabase() {
  const client = await pool.connect();
  try {
    const baseTables = await client.query(
      `SELECT COUNT(DISTINCT table_name)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('cars', 'car_images')`,
    );
    if (baseTables.rows[0].count !== 2) {
      throw new Error('Apply database/schema.sql to a new database before running migrations.');
    }

    const directory = path.join(__dirname, '../database', 'migrations');
    const files = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
      console.log(`Applied ${file}`);
    }
    console.log('Database migrations are up to date.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateDatabase().catch((error) => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});
