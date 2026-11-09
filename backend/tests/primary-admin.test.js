const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const application = require('./helpers/application');

test('one primary admin delegates access while assistants cannot grant permissions or replace the primary', async (t) => {
  const { pool, client } = await application(t);
  const primary = client(),
    assistant = client(),
    member = client();
  const ids = [];
  const password = 'PrimaryAdmin2026!';
  for (const [index, request] of [primary, assistant, member].entries()) {
    assert.equal(
      (
        await request('/api/register', 'POST', {
          full_name: 'Admin authority ' + index,
          phone: '090999990' + index,
          password,
        })
      ).status,
      201,
    );
    ids.push((await request('/api/me')).user.id);
  }
  await pool.query(
    "INSERT INTO user_roles(user_id,role) VALUES($1,'admin'),($2,'admin')",
    ids.slice(0, 2),
  );
  // Before explicit selection, no admin may assume the primary authority.
  assert.equal((await primary('/api/admin/users')).status, 403);
  await pool.query('UPDATE platform_settings SET primary_admin_id=$1 WHERE id=1', [ids[0]]);
  assert.equal((await primary('/api/me')).user.is_primary_admin, true);
  assert.equal((await assistant('/api/me')).user.is_primary_admin, false);
  const ordinaryLogin = await member('/api/login', 'POST', { phone: '0909999902', password });
  assert.equal(ordinaryLogin.role, 'user');
  const primaryLogin = await primary('/api/login', 'POST', { phone: '0909999900', password });
  assert.equal(primaryLogin.status, 200);
  assert.equal(primaryLogin.role, 'admin');
  const rights = { can_list: true, can_bid: true, admin: true, is_primary_admin: true };
  for (const id of ids) {
    assert.equal(
      (await assistant(`/api/admin/users/${id}/permissions`, 'PATCH', rights)).status,
      403,
    );
  }
  assert.equal((await assistant('/api/admin/users')).status, 403);
  assert.equal((await assistant('/api/admin/summary')).status, 200);
  assert.equal(
    (await assistant(`/api/admin/users/${ids[2]}/status`, 'PATCH', { status: 'suspended' })).status,
    403,
  );
  assert.equal(
    (await primary(`/api/admin/users/${ids[0]}/permissions`, 'PATCH', rights)).status,
    409,
  );
  assert.equal(
    (await primary(`/api/admin/users/${ids[0]}/status`, 'PATCH', { status: 'suspended' })).status,
    409,
  );
  assert.equal(
    (await primary(`/api/admin/users/${ids[2]}/permissions`, 'PATCH', rights)).status,
    200,
  );
  assert.equal((await member('/api/me')).status, 401);
  const delegatedLogin = await member('/api/login', 'POST', { phone: '0909999902', password });
  assert.equal(delegatedLogin.role, 'admin');
  assert.equal((await member('/api/me')).user.is_primary_admin, false);
  assert.equal((await member('/api/admin/summary')).status, 200);
  assert.equal(
    (await member(`/api/admin/users/${ids[1]}/permissions`, 'PATCH', rights)).status,
    403,
  );
  const selected = (await pool.query('SELECT primary_admin_id FROM platform_settings WHERE id=1'))
    .rows[0].primary_admin_id;
  assert.equal(selected, ids[0]);
  const migration = await fs.readFile(
    path.resolve(__dirname, '../database/migrations/016_primary_administrator.sql'),
    'utf8',
  );
  await pool.query(migration);
  await pool.query(migration);
  assert.equal((await primary('/api/me')).user.is_primary_admin, true);
  assert.equal(
    (await primary('/api/admin/users')).users.filter((user) => user.is_primary_admin).length,
    1,
  );
  assert.equal(
    (await primary(`/api/admin/users/${ids[2]}/permissions`, 'PATCH', { ...rights, admin: false }))
      .status,
    200,
  );
  assert.equal((await member('/api/admin/summary')).status, 401);
  assert.equal(
    (await member('/api/login', 'POST', { phone: '0909999902', password })).role,
    'user',
  );
  assert.equal((await member('/api/admin/summary')).status, 403);
});
