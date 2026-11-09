const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const application = require('./helpers/application');

test('admin notifications are isolated and only an admin can approve or reject ownership with or without papers', async (t) => {
  const { pool, client } = await application(t);
  const owner = client(),
    admin = client(),
    other = client(),
    guest = client();
  const ids = [];
  for (const [index, request] of [owner, admin, other].entries()) {
    assert.equal(
      (
        await request('/api/register', 'POST', {
          full_name: 'Policy fixture ' + index,
          phone: '090555550' + index,
          password: 'Policy2026!',
        })
      ).status,
      201,
    );
    ids.push((await request('/api/me')).user.id);
  }
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [ids[1]]);
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  function form(serial, documents = false) {
    const body = new FormData();
    Object.entries({
      vin: '1HGCM82633A' + String(serial).padStart(6, '0'),
      make: 'Hyundai',
      model: 'Azera',
      year: 2022,
      condition: 'good',
      location: 'طرابلس',
    }).forEach(([key, value]) => body.append(key, String(value)));
    body.append('images', new Blob([photo], { type: 'image/png' }), 'car.png');
    if (documents)
      body.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'paper.png');
    return body;
  }
  const created = await owner('/api/cars', 'POST', form(1));
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.car.id;
  assert.equal((await owner(`/api/account/cars/${id}`)).car.ownership_status, 'missing');
  assert.equal((await admin(`/api/admin/cars/${id}/ownership`)).documents.length, 0);
  const approval = { ownership_verified: true, ownership_revision: 1 };
  assert.equal((await owner(`/api/admin/cars/${id}/approve`, 'PATCH', approval)).status, 403);
  assert.equal((await owner(`/api/admin/cars/${id}/reject`, 'PATCH', {})).status, 403);
  assert.equal((await admin(`/api/admin/cars/${id}/approve`, 'PATCH', {})).status, 400);
  const schedule = () =>
    admin(`/api/admin/cars/${id}/auction`, 'POST', {
      starting_price: 1000,
      start_time: new Date(Date.now() + 60000),
      end_time: new Date(Date.now() + 3600000),
    });
  assert.equal((await schedule()).status, 409);
  assert.equal((await admin(`/api/admin/cars/${id}/approve`, 'PATCH', approval)).status, 200);
  assert.equal((await owner(`/api/account/cars/${id}`)).car.ownership_status, 'verified');
  // Editing without papers resets approval and invalidates the admin's previous revision.
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', form(1))).status, 200);
  assert.equal((await schedule()).status, 409);
  assert.equal((await admin(`/api/admin/cars/${id}/approve`, 'PATCH', approval)).status, 409);
  assert.equal(
    (
      await admin(`/api/admin/cars/${id}/approve`, 'PATCH', {
        ...approval,
        ownership_revision: 2,
      })
    ).status,
    200,
  );
  const auction = await schedule();
  assert.equal(auction.status, 201, JSON.stringify(auction));
  assert.deepEqual((await guest(`/api/auctions/${auction.auction.id}/ownership`)).documents, []);
  for (const withDocuments of [false, true]) {
    const car = await owner('/api/cars', 'POST', form(withDocuments ? 3 : 2, withDocuments));
    assert.equal(car.status, 201);
    assert.equal(
      (
        await admin(`/api/admin/cars/${car.car.id}/reject`, 'PATCH', {
          review_notes: 'قرار المدير بعد مراجعة الطلب',
        })
      ).status,
      200,
    );
    assert.equal((await owner(`/api/account/cars/${car.car.id}`)).car.status, 'rejected');
  }

  // Car triggers generate administrative notices; the account feed never exposes them.
  const adminFeed = await admin('/api/admin/notifications');
  assert.equal(adminFeed.status, 200);
  assert.equal(adminFeed.unread, 3);
  assert(adminFeed.notifications.every((item) => item.link.startsWith('/admin/')));
  const personalFeed = await admin('/api/notifications');
  assert.equal(personalFeed.unread, 0);
  assert.deepEqual(personalFeed.notifications, []);
  const ownerFeed = await owner('/api/notifications?audience=admin');
  assert(ownerFeed.notifications.length > 0);
  assert(ownerFeed.notifications.every((item) => !item.link.startsWith('/admin/')));
  for (const request of [owner, other, guest]) {
    const expected = request === guest ? 401 : 403;
    assert.equal((await request('/api/admin/notifications')).status, expected);
    assert.equal((await request('/api/ADMIN/notifications')).status, expected);
    assert.equal((await request('/api/admin/notifications/read', 'POST')).status, expected);
    assert.equal(
      (await request(`/api/admin/notifications/${adminFeed.notifications[0].id}/read`, 'POST'))
        .status,
      expected,
    );
  }
  // Reading one audience cannot mark the other audience or another user's notice.
  assert.equal(
    (await admin(`/api/notifications/${adminFeed.notifications[0].id}/read`, 'POST')).status,
    404,
  );
  assert.equal(
    (await other(`/api/notifications/${ownerFeed.notifications[0].id}/read`, 'POST')).status,
    404,
  );
  await admin('/api/notifications/read', 'POST');
  assert.equal((await admin('/api/admin/notifications')).unread, 3);
  await admin(`/api/admin/notifications/${adminFeed.notifications[0].id}/read`, 'POST');
  assert.equal((await admin('/api/admin/notifications')).unread, 2);
  await admin('/api/admin/notifications/read', 'POST');
  assert.equal((await admin('/api/admin/notifications')).unread, 0);
  assert.equal((await owner('/api/notifications')).unread, ownerFeed.unread);

  // Existing notices are reclassified without losing their reading history; reruns are safe.
  await pool.query('DROP TRIGGER trg_notification_audience ON notifications');
  const legacy = (
    await pool.query(
      "INSERT INTO notifications(user_id,title,body,link,read_at) VALUES($1,'Legacy','Legacy','/admin/invoices',NOW()) RETURNING id,read_at",
      [ids[0]],
    )
  ).rows[0];
  const migration = await fs.readFile(
    path.resolve(__dirname, '../database/migrations/017_notification_audiences.sql'),
    'utf8',
  );
  await pool.query(migration);
  await pool.query(migration);
  const migrated = (
    await pool.query('SELECT audience,read_at FROM notifications WHERE id=$1', [legacy.id])
  ).rows[0];
  assert.equal(migrated.audience, 'admin');
  assert.deepEqual(migrated.read_at, legacy.read_at);
  assert(!(await owner('/api/notifications')).notifications.some((item) => item.id === legacy.id));
  await pool.query("DELETE FROM user_roles WHERE user_id=$1 AND role='admin'", [ids[1]]);
  assert.equal((await admin('/api/admin/notifications')).status, 403);
  assert(
    !(await admin('/api/notifications')).notifications.some((item) =>
      item.link.startsWith('/admin/'),
    ),
  );
});
