const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const application = require('./helpers/application');

test('admin deletion handles every listing state, legacy invalid years, funded auctions and ongoing sales', async (t) => {
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
          full_name: 'Delete fixture ' + index,
          phone: '090666660' + index,
          password: 'Delete2026!',
        })
      ).status,
      201,
    );
    ids.push((await request('/api/me')).user.id);
  }
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [ids[1]]);
  await pool.query('UPDATE platform_settings SET listing_fee=10 WHERE id=1');
  assert.equal(
    (await owner('/api/account/wallet/top-up', 'POST', { amount: 100, request_key: randomUUID() }))
      .status,
    200,
  );
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  function form(serial) {
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
    body.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'paper.png');
    return body;
  }
  const create = async (serial) => {
    const result = await owner('/api/cars', 'POST', form(serial));
    assert.equal(result.status, 201);
    return result.car.id;
  };
  const approve = async (id) => {
    assert.equal(
      (
        await admin(`/api/admin/cars/${id}/approve`, 'PATCH', {
          ownership_verified: true,
          ownership_revision: 1,
        })
      ).status,
      200,
    );
  };
  const schedule = (id) =>
    admin(`/api/admin/cars/${id}/auction`, 'POST', {
      starting_price: 1000,
      start_time: new Date(Date.now() + 3600000),
      end_time: new Date(Date.now() + 7200000),
    });
  const id = await create(1);
  const pending = await create(80);
  assert.equal((await admin(`/api/admin/cars/${pending}`, 'DELETE')).status, 200);
  const rejected = await create(81);
  assert.equal(
    (await admin(`/api/admin/cars/${rejected}/reject`, 'PATCH', { reason: 'رفض تجريبي' })).status,
    200,
  );
  assert.equal((await admin(`/api/admin/cars/${rejected}`, 'DELETE')).status, 200);
  await approve(id);
  for (const request of [owner, other, guest])
    assert.equal(
      (await request(`/api/admin/cars/${id}`, 'DELETE')).status,
      request === guest ? 401 : 403,
    );
  const balance = (await owner('/api/account/wallet')).wallet.balance;
  const historyBefore = (await admin(`/api/admin/cars/${id}/history`)).history;
  assert(historyBefore.length > 0);
  assert.equal((await admin(`/api/admin/cars/${id}`, 'DELETE')).status, 200);
  const stored = (
    await pool.query(
      'SELECT status,deleted_at,deleted_by,listing_fee_amount FROM cars WHERE id=$1',
      [id],
    )
  ).rows[0];
  assert.equal(stored.status, 'deleted');
  assert(stored.deleted_at);
  assert.equal(String(stored.deleted_by), String(ids[1]));
  assert.equal(stored.listing_fee_amount, '10.000');
  assert.equal((await owner('/api/account/wallet')).wallet.balance, balance);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM wallet_transactions WHERE car_id=$1 AND kind='listing_fee'",
        [id],
      )
    ).rows[0].count,
    1,
  );
  assert.deepEqual((await admin(`/api/admin/cars/${id}/history`)).history, historyBefore);
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM car_ownership_documents WHERE car_id=$1',
        [id],
      )
    ).rows[0].count,
    1,
  );
  assert(!(await admin('/api/admin/cars')).cars.some((car) => car.id === id));
  for (const url of ['/api/account/cars', '/api/seller/cars', '/api/cars'])
    assert(!(await owner(url)).cars.some((car) => car.id === id));
  assert.equal((await owner(`/api/account/cars/${id}`)).status, 404);
  assert.equal((await guest(`/api/cars/${id}`)).status, 404);
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', form(1))).status, 409);
  assert.equal((await admin(`/api/admin/cars/${id}`, 'DELETE')).already_deleted, true);
  assert.equal((await schedule(id)).status, 409);
  assert(
    (await owner('/api/notifications')).notifications.some(
      (item) => item.title === 'حذفت الإدارة عرض سيارتك',
    ),
  );
  // A replacement listing may use the same VIN; the deleted listing remains independent.
  const replacement = await create(1);
  assert.notEqual(replacement, id);
  await approve(replacement);
  const scheduled = await schedule(replacement);
  assert.equal(scheduled.status, 201);
  assert.equal((await admin(`/api/admin/cars/${replacement}`, 'DELETE')).status, 200);
  assert.equal(
    (await pool.query('SELECT status FROM auctions WHERE id=$1', [scheduled.auction.id])).rows[0]
      .status,
    'cancelled',
  );
  const raceId = await create(2);
  await approve(raceId);
  const [removed, auction] = await Promise.all([
    admin(`/api/admin/cars/${raceId}`, 'DELETE'),
    schedule(raceId),
  ]);
  assert.equal(removed.status, 200);
  assert([201, 409].includes(auction.status));
  const state = (
    await pool.query(
      "SELECT c.status,(SELECT count(*)::int FROM auctions a WHERE a.car_id=c.id AND a.status IN ('scheduled','active')) AS open FROM cars c WHERE c.id=$1",
      [raceId],
    )
  ).rows[0];
  assert(!(state.status === 'deleted' && state.open > 0));

  assert.equal(
    (
      await other('/api/account/wallet/top-up', 'POST', {
        amount: 10000,
        request_key: randomUUID(),
      })
    ).status,
    200,
  );
  async function activeAuction(serial) {
    const id = await create(serial);
    await approve(id);
    const scheduled = await schedule(id);
    assert.equal(scheduled.status, 201);
    await pool.query(
      "UPDATE auctions SET status='active',start_time=clock_timestamp()-INTERVAL '10 minutes',end_time=clock_timestamp()+INTERVAL '1 hour' WHERE id=$1",
      [scheduled.auction.id],
    );
    assert.equal(
      (await other(`/api/auctions/${scheduled.auction.id}/bids`, 'POST', { amount: 1000 })).status,
      201,
    );
    return { id, auctionId: scheduled.auction.id };
  }
  const active = await activeAuction(4);
  const walletBefore = (await other('/api/account/wallet')).wallet;
  assert.equal(walletBefore.reserved, '1000.000');
  assert.equal((await admin(`/api/admin/cars/${active.id}`, 'DELETE')).status, 200);
  const walletAfter = (await other('/api/account/wallet')).wallet;
  assert.equal(walletAfter.reserved, '0.000');
  assert.equal(walletAfter.balance, walletBefore.balance);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM bids WHERE auction_id=$1', [
        active.auctionId,
      ])
    ).rows[0].count,
    1,
  );
  assert.equal(
    (await other(`/api/auctions/${active.auctionId}/bids`, 'POST', { amount: 1100 })).status,
    409,
  );
  assert.equal((await admin(`/api/admin/auctions/${active.auctionId}/close`, 'POST')).status, 409);
  assert(
    (await other('/api/notifications')).notifications.some(
      (item) => item.title === 'تم إلغاء المزاد',
    ),
  );

  // Reproduce the exact old-data constraint failure, then apply the migration without correcting the stored year.
  const legacy = await create(5);
  await approve(legacy);
  await pool.query('ALTER TABLE cars DROP CONSTRAINT ck_cars_year');
  await pool.query('UPDATE cars SET year=2050 WHERE id=$1', [legacy]);
  await pool.query(
    "ALTER TABLE cars ADD CONSTRAINT ck_cars_year CHECK(year BETWEEN 1950 AND EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli')) NOT VALID",
  );
  assert.equal((await admin(`/api/admin/cars/${legacy}`, 'DELETE')).status, 500);
  await pool.query(
    await fs.readFile(
      path.resolve(__dirname, '../database/migrations/019_delete_legacy_listings.sql'),
      'utf8',
    ),
  );
  assert.equal((await admin(`/api/admin/cars/${legacy}`, 'DELETE')).status, 200);
  assert.equal(
    (await pool.query('SELECT year FROM cars WHERE id=$1', [legacy])).rows[0].year,
    2050,
  );
  const invalid = form(99);
  invalid.set('year', '2050');
  assert.equal((await owner('/api/cars', 'POST', invalid)).status, 400);

  async function wonAuction(serial) {
    const car = await activeAuction(serial);
    await pool.query(
      "UPDATE auctions SET end_time=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",
      [car.auctionId],
    );
    const closed = await admin(`/api/admin/auctions/${car.auctionId}/close`, 'POST');
    assert.equal(closed.status, 200);
    return { ...car, invoiceId: closed.invoice.id };
  }
  // Removing a listing neither pays nor cancels its invoice; the sale workflow remains usable.
  const unpaid = await wonAuction(6);
  assert.equal((await admin(`/api/admin/cars/${unpaid.id}`, 'DELETE')).status, 200);
  assert.equal((await other('/api/account/wallet')).wallet.reserved, '1000.000');
  assert.equal((await other(`/api/invoices/${unpaid.invoiceId}/pay-wallet`, 'POST')).status, 200);
  assert.equal((await owner(`/api/invoices/${unpaid.invoiceId}/handover`, 'POST')).status, 200);
  assert.equal((await other(`/api/invoices/${unpaid.invoiceId}/receive`, 'POST')).status, 200);
  const paid = await wonAuction(7);
  assert.equal((await other(`/api/invoices/${paid.invoiceId}/pay-wallet`, 'POST')).status, 200);
  assert.equal((await admin(`/api/admin/cars/${paid.id}`, 'DELETE')).status, 200);
  assert.equal(
    (await pool.query('SELECT amount FROM invoice_escrows WHERE invoice_id=$1', [paid.invoiceId]))
      .rows[0].amount,
    '1000.000',
  );
  assert.equal((await owner(`/api/invoices/${paid.invoiceId}/handover`, 'POST')).status, 200);
  assert.equal((await other(`/api/invoices/${paid.invoiceId}/receive`, 'POST')).status, 200);
  const completed = await wonAuction(8);
  assert.equal(
    (await other(`/api/invoices/${completed.invoiceId}/pay-wallet`, 'POST')).status,
    200,
  );
  assert.equal((await owner(`/api/invoices/${completed.invoiceId}/handover`, 'POST')).status, 200);
  assert.equal((await other(`/api/invoices/${completed.invoiceId}/receive`, 'POST')).status, 200);
  assert.equal((await admin(`/api/admin/cars/${completed.id}`, 'DELETE')).status, 200);
  const expired = await wonAuction(9);
  assert.equal((await admin(`/api/admin/cars/${expired.id}`, 'DELETE')).status, 200);
  await pool.query("UPDATE invoices SET due_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1", [
    expired.invoiceId,
  ]);
  await require('../src/services/sales').processSale(expired.invoiceId, null, 'expire');
  for (const car of [unpaid, paid, completed, expired]) {
    assert.equal(
      (await pool.query('SELECT status FROM cars WHERE id=$1', [car.id])).rows[0].status,
      'deleted',
    );
    assert.equal((await guest(`/api/cars/${car.id}`)).status, 404);
  }
  // Bidding and the auction closer use the same auction locks as deletion.
  const bidRace = await activeAuction(10);
  const [removedDuringBid, concurrentBid] = await Promise.all([
    admin(`/api/admin/cars/${bidRace.id}`, 'DELETE'),
    other(`/api/auctions/${bidRace.auctionId}/bids`, 'POST', { amount: 1100 }),
  ]);
  assert.equal(removedDuringBid.status, 200);
  assert([201, 409].includes(concurrentBid.status));
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM wallet_holds WHERE auction_id=$1', [
        bidRace.auctionId,
      ])
    ).rows[0].count,
    0,
  );
  const closeRace = await activeAuction(11);
  await pool.query(
    "UPDATE auctions SET end_time=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",
    [closeRace.auctionId],
  );
  const [removedDuringClose, concurrentClose] = await Promise.all([
    admin(`/api/admin/cars/${closeRace.id}`, 'DELETE'),
    admin(`/api/admin/auctions/${closeRace.auctionId}/close`, 'POST'),
  ]);
  assert.equal(removedDuringClose.status, 200);
  assert([200, 409].includes(concurrentClose.status));
  assert.equal(
    (await pool.query('SELECT status FROM cars WHERE id=$1', [closeRace.id])).rows[0].status,
    'deleted',
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM wallet_holds h JOIN auctions a ON a.id=h.auction_id WHERE a.car_id=$1 AND a.status='cancelled'",
        [closeRace.id],
      )
    ).rows[0].count,
    0,
  );
});
