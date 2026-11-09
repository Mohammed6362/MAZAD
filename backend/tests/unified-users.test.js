/**
 * يعيد بناء مخطط قديم في بيئة معزولة ويتأكد أن دمج buyer وseller يحافظ على الحسابات والبيانات والإدارة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

test('merging existing buyer and seller roles preserves accounts, cars, sessions and admin grants', async (t) => {
  const name = `mazad_merge_${process.pid}_${Date.now()}`;
  process.env.NODE_ENV = 'test';
  const db = new Pool(require('../src/databaseOptions')({ options: undefined }));
  let client;
  t.after(async () => {
    client?.release();
    assert.match(name, /^mazad_merge_\d+_\d+$/);
    await db.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await db.end();
  });
  await db.query(`CREATE SCHEMA ${name}`);
  client = await db.connect();
  await client.query(`SET search_path TO ${name}`);
  // Reconstruct the old schema in isolation, then migrate real legacy rows.
  let old = await fs.readFile(path.resolve(__dirname, '../database/schema.sql'), 'utf8');
  old = old.replace(
    "CREATE TYPE user_role AS ENUM ('user', 'admin');",
    "CREATE TYPE user_role AS ENUM ('buyer', 'seller', 'admin');",
  );
  old = old.replace("VALUES (NEW.id, 'user');", "VALUES (NEW.id, 'buyer'), (NEW.id, 'seller');");
  const carStart = old.indexOf('CREATE FUNCTION fn_validate_car_seller()');
  const carEnd = old.indexOf('CREATE TRIGGER trg_cars_validate_seller', carStart);
  old =
    old.slice(0, carStart) +
    old.slice(carStart, carEnd).replaceAll("r.role = 'user'", "r.role = 'seller'") +
    old.slice(carEnd);
  const bidStart = old.indexOf('CREATE FUNCTION fn_validate_bid()');
  const bidEnd = old.indexOf('CREATE TRIGGER trg_bids_validate', bidStart);
  old =
    old.slice(0, bidStart) +
    old.slice(bidStart, bidEnd).replaceAll("r.role = 'user'", "r.role = 'buyer'") +
    old.slice(bidEnd);
  await client.query(old);
  const {
    rows: [user],
  } = await client.query(
    "INSERT INTO users(full_name,phone,password_hash) VALUES('Legacy Test User','0900000031','unchanged-test-hash') RETURNING id",
  );
  await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [user.id]);
  const {
    rows: [car],
  } = await client.query(
    "INSERT INTO cars(seller_id,vin,make,model,year,condition,location,status) VALUES($1,'1HGCM82633A004351','Toyota','Camry',2020,'good','Tripoli','approved') RETURNING id",
    [user.id],
  );
  await client.query(
    "INSERT INTO user_sessions(sid,sess,expires_at) VALUES('legacy-test-session',$1::jsonb,NOW()+INTERVAL '1 hour')",
    [JSON.stringify({ userId: String(user.id), role: 'seller' })],
  );
  const folder = path.resolve(__dirname, '../database/migrations');
  for (const file of (await fs.readdir(folder)).filter((file) => file.endsWith('.sql')).sort())
    await client.query(await fs.readFile(path.join(folder, file), 'utf8'));
  const { rows: roles } = await client.query(
    'SELECT role::text FROM user_roles WHERE user_id=$1 ORDER BY role::text',
    [user.id],
  );
  assert.deepEqual(
    roles.map((row) => row.role),
    ['admin', 'user'],
  );
  assert.equal(
    (await client.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0]
      .password_hash,
    'unchanged-test-hash',
  );
  assert.equal(
    (await client.query('SELECT seller_id FROM cars WHERE id=$1', [car.id])).rows[0].seller_id,
    user.id,
  );
  assert.equal(
    (
      await client.query(
        "SELECT sess->>'role' AS role FROM user_sessions WHERE sid='legacy-test-session'",
      )
    ).rows[0].role,
    'user',
  );
  const {
    rows: [created],
  } = await client.query(
    "INSERT INTO users(full_name,phone,password_hash) VALUES('New User','0900000032','test-hash') RETURNING id",
  );
  assert.deepEqual(
    (
      await client.query('SELECT role::text FROM user_roles WHERE user_id=$1', [created.id])
    ).rows.map((row) => row.role),
    ['user'],
  );
  await client.query(await fs.readFile(path.join(folder, '007_unified_users.sql'), 'utf8'));
  assert.equal(
    (
      await client.query(
        "SELECT COUNT(*)::int AS count FROM user_roles WHERE role::text IN ('buyer','seller')",
      )
    ).rows[0].count,
    0,
  );
});
