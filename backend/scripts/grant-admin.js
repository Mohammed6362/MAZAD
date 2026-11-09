/**
 * أداة سطر أوامر لمنح الإدارة لحساب موجود؛ لا تنشئ كلمة مرور جديدة ولا حساب مدير تلقائيًا.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');

const phone =
  process.argv
    .find((value) => value.startsWith('--phone='))
    ?.slice('--phone='.length)
    .trim() || process.env.ADMIN_PHONE?.trim();
const email = process.env.ADMIN_EMAIL?.trim();
if (!phone && !email) {
  console.error('Set ADMIN_PHONE or ADMIN_EMAIL to an existing active user.');
  process.exit(1);
}

const pool = new Pool(require('../src/databaseOptions')());

// يبحث عن الحساب الموجود ثم يمنحه الدور الإداري؛ لا يستبدل كلمة المرور أو بياناته الشخصية.
async function grantAdminRole() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(130013)');
    const {
      rows: [settings],
    } = await client.query('SELECT primary_admin_id FROM platform_settings WHERE id=1 FOR UPDATE');
    const result = await client.query(
      phone
        ? 'SELECT id, status FROM users WHERE phone = $1 FOR UPDATE'
        : 'SELECT id, status FROM users WHERE lower(email) = lower($1) FOR UPDATE',
      [phone || email],
    );
    const user = result.rows[0];
    if (!user) throw new Error('No account matches the supplied phone or email.');
    if (user.status !== 'active') throw new Error('The account is not active.');
    if (settings.primary_admin_id && String(settings.primary_admin_id) !== String(user.id))
      throw new Error(
        'A primary administrator is already configured. Delegate access from that account.',
      );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
      [user.id],
    );
    await client.query('UPDATE platform_settings SET primary_admin_id=$1 WHERE id=1', [user.id]);
    await client.query('COMMIT');
    console.log(
      'The selected active account is the sole primary administrator. Other administrators remain delegated assistants.',
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

grantAdminRole().catch((error) => {
  console.error('Could not grant admin access:', error.message);
  process.exitCode = 1;
});
