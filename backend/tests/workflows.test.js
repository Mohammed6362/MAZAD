/**
 * اختبار دورة الحساب والسيارة والمراجعة والمزاد والمزايدة والفائز والفاتورة على بيانات معزولة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const registration = require('./helpers/registration');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

test('account, vehicle review, auction, bidding, winner and invoice workflow', async (t) => {
  // All database writes target an isolated schema; production data is never reused.
  const schema = `mazad_test_${Date.now()}`;
  const control = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'mazad-test-'));
  let server;
  let pool;
  t.after(async () => {
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    if (pool) await pool.end();
    assert.match(schema, /^mazad_test_\d+$/);
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
    await fs.rm(uploads, { recursive: true, force: true });
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const setup = await control.connect();
  try {
    await setup.query(`SET search_path TO ${schema}`);
    await setup.query(await fs.readFile(path.resolve(__dirname, '../database/schema.sql'), 'utf8'));
    const migrations = path.resolve(__dirname, '../database/migrations');
    for (const file of (await fs.readdir(migrations))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await setup.query(await fs.readFile(path.join(migrations, file), 'utf8'));
    await setup.query('UPDATE platform_settings SET listing_fee=0 WHERE id=1');
  } finally {
    setup.release();
  }
  process.env.NODE_ENV = 'test';
  process.env.DB_OPTIONS = `-c search_path=${schema}`;
  process.env.UPLOADS_DIR = uploads;
  const app = require('../src/app');
  pool = require('../src/db');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (url, method = 'GET', body) => {
      if (url === '/api/register' && body) body = registration(body);
      const form = body instanceof FormData;
      const response = await fetch(base + url, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(!form && body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? (form ? body : JSON.stringify(body)) : undefined,
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const data = await response.json();
      return { status: response.status, ...data };
    };
  }
  const seller = client();
  const buyer = client();
  const admin = client();
  const guest = client();
  async function approve(id) {
    const pending = (await admin('/api/admin/cars/pending')).cars.find(
      (car) => String(car.id) === String(id),
    );
    return admin('/api/admin/cars/' + id + '/approve', 'PATCH', {
      ownership_verified: true,
      ownership_revision: pending.ownership_revision,
    });
  }
  const credentials = { full_name: 'Workflow Test', password: 'WorkflowTest2026!' };
  const sellerIdentity = { ...credentials, phone: '0901234567' };
  assert.equal((await seller('/api/register', 'POST', sellerIdentity)).status, 201);
  const sellerMe = await seller('/api/me');
  assert.deepEqual([...sellerMe.user.roles].sort(), ['user']);
  assert.equal(
    (await buyer('/api/register', 'POST', { ...credentials, phone: '0901234568' })).status,
    201,
  );
  assert.equal(
    (await admin('/api/register', 'POST', { ...credentials, phone: '0901234569', role: 'admin' }))
      .status,
    400,
  );
  assert.equal(
    (await admin('/api/register', 'POST', { ...credentials, phone: '0901234569' })).status,
    201,
  );
  const adminUser = (await admin('/api/me')).user;
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [adminUser.id]);
  await pool.query('UPDATE platform_settings SET primary_admin_id=$1 WHERE id=1', [adminUser.id]);
  assert.equal((await admin('/api/me')).user.role, 'admin');
  assert.equal((await buyer('/api/session/role', 'POST', { role: 'admin' })).status, 403);
  assert.equal((await buyer('/api/admin/cars')).status, 403);
  assert.equal((await guest('/api/admin/cars/pending')).status, 401);
  assert.equal((await guest('/api/auctions/not-an-id')).status, 400);
  const form = new FormData();
  Object.entries({
    vin: '1HGCM82633A004352',
    make: 'Toyota',
    model: 'Camry',
    year: '2022',
    condition: 'good',
    location: 'Tripoli',
  }).forEach(([key, value]) => form.append(key, value));
  form.append(
    'images',
    new Blob([await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'))], {
      type: 'image/png',
    }),
    'car.png',
  );
  form.append(
    'ownership_documents',
    new Blob([await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'))], {
      type: 'image/png',
    }),
    'ownership.png',
  );
  const created = await seller('/api/cars', 'POST', form);
  assert.equal(created.status, 201, JSON.stringify(created));
  const carId = created.car.id;
  assert.equal((await guest(`/api/cars/${carId}`)).status, 404);
  const pending = await admin('/api/admin/cars/pending');
  assert.equal(pending.cars.length, 1);
  assert.equal(pending.cars[0].images.length, 1);
  assert.equal((await buyer(`/api/account/cars/${carId}`)).status, 404);
  assert.equal(
    (await admin(`/api/admin/cars/${carId}/reject`, 'PATCH', { reason: 'Correct mileage' })).status,
    200,
  );
  const editable = (await seller(`/api/account/cars/${carId}`)).car;
  assert.equal(editable.status, 'rejected');
  assert.equal(
    (await seller(`/api/account/cars/${carId}`, 'PATCH', { ...editable, mileage_km: 42000 }))
      .status,
    200,
  );
  const photoUpdate = new FormData();
  for (const key of [
    'vin',
    'make',
    'model',
    'year',
    'mileage_km',
    'transmission',
    'condition',
    'defects_notes',
    'location',
  ])
    if (editable[key] != null) photoUpdate.append(key, String(editable[key]));
  photoUpdate.append('keep_image_ids', '[]');
  assert.equal((await seller(`/api/account/cars/${carId}`, 'PATCH', photoUpdate)).status, 400);
  photoUpdate.append(
    'images',
    new Blob([await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'))], {
      type: 'image/png',
    }),
    'replacement.png',
  );
  assert.equal((await seller(`/api/account/cars/${carId}`, 'PATCH', photoUpdate)).status, 200);
  await assert.rejects(
    fs.access(path.join(uploads, 'cars', path.basename(editable.images[0].url))),
  );
  const corrupted = new FormData();
  for (const [key, value] of form.entries()) if (key !== 'images') corrupted.append(key, value);
  corrupted.append(
    'images',
    new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], {
      type: 'image/png',
    }),
    'corrupt.png',
  );
  assert.equal((await seller('/api/cars', 'POST', corrupted)).status, 400);
  assert.equal((await approve(carId)).status, 200);
  const published = await guest(`/api/cars/${carId}`);
  assert.equal(published.status, 200);
  assert.equal(published.car.images.length, 1);
  assert.equal((await seller(`/api/account/cars/${carId}`, 'PATCH', editable)).status, 200);
  assert.equal((await guest(`/api/cars/${carId}`)).status, 404);
  assert.equal((await approve(carId)).status, 200);
  assert.equal((await seller('/api/account/cars')).cars.length, 1);
  const auctionBody = {
    payment_mode: 'manual',
    starting_price: 1000,
    min_increment: 100,
    start_time: new Date(Date.now() + 60000),
    end_time: new Date(Date.now() + 600000),
  };
  const scheduled = await admin(`/api/admin/cars/${carId}/auction`, 'POST', auctionBody);
  assert.equal(scheduled.status, 201, JSON.stringify(scheduled));
  const auctionId = scheduled.auction.id;
  assert.equal((await seller(`/api/account/cars/${carId}`, 'PATCH', editable)).status, 409);
  assert.equal((await seller(`/api/auctions/${auctionId}`)).auction.is_owner, true);
  assert.equal((await buyer(`/api/auctions/${auctionId}`)).auction.is_owner, false);
  assert.equal((await admin(`/api/admin/cars/${carId}/auction`, 'POST', auctionBody)).status, 409);
  assert.equal(
    (await buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1000 })).status,
    409,
  );
  await pool.query("UPDATE auctions SET start_time=NOW()-INTERVAL '1 minute' WHERE id=$1", [
    auctionId,
  ]);
  assert.equal(
    (await buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 999 })).status,
    409,
  );
  assert.equal((await seller('/api/me')).user.role, 'user');
  assert.equal((await seller('/api/account/bids')).status, 200);
  assert.equal((await buyer('/api/account/cars')).status, 200);
  assert.equal(
    (await seller(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1000 })).status,
    403,
  );
  assert.equal(
    (await buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1000 })).status,
    201,
  );
  const concurrent = await Promise.all([
    buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1100 }),
    buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1100 }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await buyer('/api/account/bids')).bids[0].my_amount, '1100.000');
  assert.equal((await admin(`/api/admin/auctions/${auctionId}/close`, 'POST')).status, 409);
  await pool.query("UPDATE auctions SET end_time=NOW()-INTERVAL '1 second' WHERE id=$1", [
    auctionId,
  ]);
  assert.equal((await guest(`/api/auctions/${auctionId}`)).auction.status, 'ended');
  const publicDocuments = (await guest(`/api/auctions/${auctionId}/ownership`)).documents;
  const closed = await admin(`/api/admin/auctions/${auctionId}/close`, 'POST');
  assert.equal(closed.status, 200, JSON.stringify(closed));
  assert(closed.invoice.invoice_number);
  assert.equal((await buyer('/api/invoices')).invoices.length, 1);
  assert.equal((await buyer(`/api/admin/invoices/${closed.invoice.id}/pay`, 'POST')).status, 403);
  assert.equal((await admin('/api/admin/invoices')).invoices.length, 1);
  assert.equal((await admin(`/api/admin/invoices/${closed.invoice.id}/pay`, 'POST')).status, 200);
  assert.equal((await admin(`/api/admin/invoices/${closed.invoice.id}/pay`, 'POST')).status, 200);
  assert.equal((await buyer('/api/invoices')).invoices[0].status, 'paid');
  assert.equal((await admin('/api/invoices')).invoices.length, 0);
  assert.equal((await admin(`/api/admin/auctions/${auctionId}/close`, 'POST')).status, 409);
  assert.equal((await guest(`/api/auctions/${auctionId}`)).status, 404);
  assert.equal((await guest(`/api/cars/${carId}`)).status, 404);
  assert.equal((await buyer(`/api/auctions/${auctionId}`)).auction.status, 'closed');
  assert.equal((await buyer(`/api/cars/${carId}`)).car.status, 'sold');
  assert.equal((await seller(`/api/cars/${carId}`)).car.status, 'sold');
  assert.equal((await admin(`/api/cars/${carId}`)).car.status, 'sold');
  assert.equal((await guest(`/api/auctions/${auctionId}/bids`)).status, 404);
  assert.equal((await guest(`/api/auctions/${auctionId}/ownership`)).status, 404);
  assert.equal((await guest(publicDocuments[0].url)).status, 404);
  assert.equal((await buyer(`/api/auctions/${auctionId}/ownership`)).status, 200);
  const outsider = client();
  assert.equal(
    (await outsider('/api/register', 'POST', { ...credentials, phone: '0901234570' })).status,
    201,
  );
  assert.equal((await outsider(`/api/cars/${carId}`)).status, 404);
  assert.equal((await outsider(`/api/auctions/${auctionId}`)).status, 404);
  assert.equal((await outsider(`/api/auctions/${auctionId}/ownership`)).status, 404);
  assert.equal((await guest('/api/cars')).cars.length, 0);
  await seller('/api/logout', 'POST');
  assert.equal((await seller('/api/me')).status, 401);
  assert.equal(
    (
      await seller('/api/login', 'POST', {
        phone: sellerIdentity.phone,
        password: sellerIdentity.password,
        role: 'seller',
      })
    ).status,
    200,
  );
  assert.equal((await admin('/api/admin/auctions')).auctions.length, 1);
  // Reserve not met: closing must leave the car approved and create no invoice.
  const secondForm = new FormData();
  for (const [key, value] of form.entries()) secondForm.append(key, value);
  secondForm.set('vin', '1HGCM82633A004353');
  const second = await seller('/api/cars', 'POST', secondForm);
  assert.equal(second.status, 201);
  const secondId = second.car.id;
  assert.equal((await approve(secondId)).status, 200);
  const reserved = await admin(`/api/admin/cars/${secondId}/auction`, 'POST', {
    ...auctionBody,
    reserve_price: 2000,
  });
  assert.equal(reserved.status, 201);
  await pool.query("UPDATE auctions SET start_time=NOW()-INTERVAL '1 minute' WHERE id=$1", [
    reserved.auction.id,
  ]);
  assert.equal(
    (await buyer(`/api/auctions/${reserved.auction.id}/bids`, 'POST', { amount: 1000 })).status,
    201,
  );
  await pool.query("UPDATE auctions SET end_time=NOW()-INTERVAL '1 second' WHERE id=$1", [
    reserved.auction.id,
  ]);
  const unsold = await admin(`/api/admin/auctions/${reserved.auction.id}/close`, 'POST');
  assert.equal(unsold.winner, null);
  assert.equal(unsold.invoice, null);
  assert.equal((await guest(`/api/cars/${secondId}`)).car.status, 'approved');
  assert.equal((await buyer('/api/invoices')).invoices.length, 1);
  assert.equal((await guest('/api/missing')).status, 404);
  const summary = (await admin('/api/admin/summary')).summary;
  assert.equal(summary.users, 4);
  assert.equal(summary.sold_cars, 1);
  assert.equal(Number(summary.paid_total), 1100);
  const adminUsers = await admin('/api/admin/users');
  assert.equal(adminUsers.users.length, 4);
  assert(!('password_hash' in adminUsers.users[0]));
  const sellerNotifications = await seller('/api/notifications');
  assert(sellerNotifications.unread > 0);
  const buyerNotifications = await buyer('/api/notifications');
  assert(buyerNotifications.notifications.some((item) => item.title === 'فزت بالمزاد'));
  assert.equal(
    (await buyer(`/api/notifications/${sellerNotifications.notifications[0].id}/read`, 'POST'))
      .status,
    404,
  );
  assert.equal((await seller('/api/notifications/read', 'POST')).status, 200);
  assert.equal((await seller('/api/notifications')).unread, 0);
  const rescheduled = await admin(`/api/admin/cars/${secondId}/auction`, 'POST', auctionBody);
  assert.equal(rescheduled.status, 201);
  assert.equal(
    (await admin(`/api/admin/auctions/${rescheduled.auction.id}/cancel`, 'POST')).status,
    200,
  );
  assert.equal(
    (await guest(`/api/auctions/${rescheduled.auction.id}`)).auction.status,
    'cancelled',
  );
  const nextAuction = await admin(`/api/admin/cars/${secondId}/auction`, 'POST', auctionBody);
  assert.equal(nextAuction.status, 201);
  await pool.query("UPDATE auctions SET start_time=NOW()-INTERVAL '1 minute' WHERE id=$1", [
    nextAuction.auction.id,
  ]);
  assert.equal(
    (await admin(`/api/admin/auctions/${nextAuction.auction.id}/cancel`, 'POST')).status,
    409,
  );
  assert.equal(
    (await admin(`/api/admin/users/${adminUser.id}/status`, 'PATCH', { status: 'suspended' }))
      .status,
    409,
  );
  assert.equal(
    (await admin(`/api/admin/users/${sellerMe.user.id}/status`, 'PATCH', { status: 'suspended' }))
      .status,
    200,
  );
  assert.equal((await seller('/api/me')).status, 401);
  assert.equal(
    (await buyer(`/api/auctions/${nextAuction.auction.id}/bids`, 'POST', { amount: 1000 })).status,
    409,
  );
  assert.equal(
    (await admin(`/api/admin/users/${sellerMe.user.id}/status`, 'PATCH', { status: 'active' }))
      .status,
    200,
  );
  assert.equal(
    (
      await seller('/api/login', 'POST', {
        phone: sellerIdentity.phone,
        password: sellerIdentity.password,
        role: 'seller',
      })
    ).status,
    200,
  );
  assert.equal(
    (await buyer(`/api/auctions/${nextAuction.auction.id}/bids`, 'POST', { amount: 1000 })).status,
    201,
  );
  const buyerProfile = {
    full_name: 'Updated Buyer',
    phone: '0901234568',
    email: 'buyer@example.test',
  };
  assert.equal((await buyer('/api/account/profile', 'PATCH', buyerProfile)).status, 400);
  assert.equal(
    (
      await buyer('/api/account/profile', 'PATCH', {
        ...buyerProfile,
        current_password: credentials.password,
      })
    ).status,
    200,
  );
  assert.equal((await buyer('/api/me')).user.full_name, 'Updated Buyer');
  const otherSession = client();
  assert.equal(
    (
      await otherSession('/api/login', 'POST', {
        phone: buyerProfile.phone,
        password: credentials.password,
        role: 'buyer',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await buyer('/api/account/password', 'POST', {
        current_password: 'wrong',
        new_password: 'ChangedPassword2026!',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await buyer('/api/account/password', 'POST', {
        current_password: credentials.password,
        new_password: 'ChangedPassword2026!',
      })
    ).status,
    200,
  );
  assert.equal((await otherSession('/api/me')).status, 401);
  assert.equal((await buyer('/api/me')).status, 200);
  assert.equal(
    (
      await otherSession('/api/login', 'POST', {
        phone: buyerProfile.phone,
        password: credentials.password,
        role: 'buyer',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await otherSession('/api/login', 'POST', {
        phone: buyerProfile.phone,
        password: 'ChangedPassword2026!',
        role: 'buyer',
      })
    ).status,
    200,
  );
  assert.equal((await guest('/api/health')).status, 200);
  // The same normal account sells its own car and bids on another owner's car.
  const buyerCarForm = new FormData();
  for (const [key, value] of form.entries()) buyerCarForm.append(key, value);
  buyerCarForm.set('vin', '1HGCM82633A004359');
  const buyerCar = await buyer('/api/cars', 'POST', buyerCarForm);
  assert.equal(buyerCar.status, 201);
  assert.equal((await buyer('/api/account/cars')).cars.length, 1);
  assert.equal((await buyer('/api/account/bids')).status, 200);
  assert.equal((await approve(buyerCar.car.id)).status, 200);
  const oppositeAuction = await admin(
    '/api/admin/cars/' + buyerCar.car.id + '/auction',
    'POST',
    auctionBody,
  );
  assert.equal(oppositeAuction.status, 201);
  await pool.query("UPDATE auctions SET start_time=NOW()-INTERVAL '1 minute' WHERE id=$1", [
    oppositeAuction.auction.id,
  ]);
  assert.equal(
    (
      await seller('/api/auctions/' + oppositeAuction.auction.id + '/bids', 'POST', {
        amount: 1000,
      })
    ).status,
    201,
  );
  assert.equal(
    (await buyer('/api/auctions/' + oppositeAuction.auction.id + '/bids', 'POST', { amount: 1100 }))
      .status,
    403,
  );
  assert.equal((await seller('/api/seller/cars')).status, 200); // legacy route remains compatible
  assert.equal((await seller('/api/buyer/bids')).status, 200);
  const html = await fetch(base + '/admin/review');
  assert.equal(html.status, 200);
  assert((await html.text()).includes('<div id="root">'));
});
