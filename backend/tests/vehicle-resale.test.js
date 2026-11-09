const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const application = require('./helpers/application');

test('one vehicle keeps its VIN, ownership chain and independent listings across repeated sales', async (t) => {
  const { pool, client } = await application(t);
  const [firstOwner, secondOwner, thirdOwner, admin] = [client(), client(), client(), client()];
  const ids = [];
  for (const [index, request] of [firstOwner, secondOwner, thirdOwner, admin].entries()) {
    const registered = await request('/api/register', 'POST', {
      full_name: 'Resale fixture ' + index,
      phone: '090555550' + index,
      password: 'ResaleTest2026!',
    });
    assert.equal(registered.status, 201);
    ids.push((await request('/api/me')).user.id);
  }
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [ids[3]]);
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  const vin = '1HGCM82633A007777';
  function form(mileage = 10000) {
    const body = new FormData();
    Object.entries({
      vin,
      make: 'Hyundai',
      model: 'Azera',
      year: 2022,
      mileage_km: mileage,
      condition: 'good',
      location: 'Tripoli',
    }).forEach(([key, value]) => body.append(key, String(value)));
    body.append('images', new Blob([photo], { type: 'image/png' }), 'car.png');
    body.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'ownership.png');
    return body;
  }
  async function approve(id, extra = {}) {
    const pending = (await admin('/api/admin/cars/pending')).cars.find((car) => car.id === id);
    return admin(`/api/admin/cars/${id}/approve`, 'PATCH', {
      ownership_verified: true,
      ownership_revision: pending.ownership_revision,
      ...extra,
    });
  }
  async function sell(carId, seller, buyer) {
    const scheduled = await admin(`/api/admin/cars/${carId}/auction`, 'POST', {
      starting_price: 1000,
      min_increment: 10,
      start_time: new Date(Date.now() + 60000),
      end_time: new Date(Date.now() + 3600000),
      payment_mode: 'manual',
    });
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled));
    const auctionId = scheduled.auction.id;
    await pool.query(
      "UPDATE auctions SET start_time=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",
      [auctionId],
    );
    assert.equal(
      (await buyer(`/api/auctions/${auctionId}/bids`, 'POST', { amount: 1000 })).status,
      201,
    );
    await pool.query(
      "UPDATE auctions SET end_time=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
      [auctionId],
    );
    const closed = await admin(`/api/admin/auctions/${auctionId}/close`, 'POST');
    assert.equal(closed.status, 200);
    const invoiceId = closed.invoice.id;
    assert.equal((await admin(`/api/admin/invoices/${invoiceId}/pay`, 'POST')).status, 200);
    assert.equal((await seller(`/api/invoices/${invoiceId}/handover`, 'POST')).status, 200);
    return { auctionId, invoiceId };
  }

  const first = await firstOwner('/api/cars', 'POST', form());
  assert.equal(first.status, 201, JSON.stringify(first));
  const firstId = first.car.id;
  assert.equal((await secondOwner('/api/cars', 'POST', form())).status, 409);
  assert.equal((await approve(firstId)).status, 200);
  const firstSale = await sell(firstId, firstOwner, secondOwner);
  // A win/payment/handover alone never permits resale before the buyer confirms receipt.
  assert.equal((await secondOwner('/api/cars', 'POST', form())).status, 409);
  assert.equal(
    (await secondOwner('/api/invoices/' + firstSale.invoiceId + '/receive', 'POST')).status,
    200,
  );
  const vehicle = (await secondOwner('/api/account/vehicles')).vehicles[0];
  assert.equal(vehicle.vin, vin);
  assert.equal(vehicle.has_live_listing, false);
  assert.equal((await firstOwner(`/api/account/vehicles/${vehicle.id}/resale`)).status, 404);
  const seed = await secondOwner(`/api/account/vehicles/${vehicle.id}/resale`);
  assert.equal(seed.status, 200);
  assert(!JSON.stringify(seed).includes('ownership_documents'));
  const wrongIdentity = form();
  wrongIdentity.set('model', 'Sonata');
  assert.equal((await secondOwner('/api/cars', 'POST', wrongIdentity)).status, 409);

  const duplicate = await Promise.all([
    secondOwner('/api/cars', 'POST', form(20000)),
    secondOwner('/api/cars', 'POST', form(20000)),
  ]);
  assert.deepEqual(duplicate.map((r) => r.status).sort(), [201, 409]);
  const secondId = duplicate.find((r) => r.status === 201).car.id;
  assert.notEqual(secondId, firstId);
  assert.equal((await approve(secondId)).status, 200);
  const secondSale = await sell(secondId, secondOwner, thirdOwner);
  assert.notEqual(secondSale.auctionId, firstSale.auctionId);
  assert.equal(
    (await thirdOwner('/api/invoices/' + secondSale.invoiceId + '/receive', 'POST')).status,
    200,
  );
  // Retrying receipt never moves ownership back or duplicates the chain.
  assert.equal(
    (await secondOwner('/api/invoices/' + firstSale.invoiceId + '/receive', 'POST')).status,
    200,
  );
  assert.equal((await firstOwner('/api/account/cars/' + firstId, 'PATCH', form())).status, 409);
  const listings = (
    await pool.query('SELECT * FROM cars WHERE vehicle_id=$1 ORDER BY id', [vehicle.id])
  ).rows;
  assert.equal(listings.length, 2);
  assert.deepEqual(
    listings.map((c) => c.seller_id),
    ids.slice(0, 2),
  );
  assert.deepEqual(
    listings.map((c) => c.mileage_km),
    [10000, 20000],
  );
  assert(listings.every((c) => c.status === 'sold' && c.vin === vin));
  const docs = (
    await pool.query('SELECT car_id,storage_key FROM car_ownership_documents ORDER BY id')
  ).rows;
  assert.equal(docs.length, 2);
  assert.notEqual(docs[0].storage_key, docs[1].storage_key);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM vehicles WHERE vin=$1', [vin])).rows[0]
      .count,
    1,
  );
  assert.equal(
    (await pool.query('SELECT current_owner_id FROM vehicles WHERE id=$1', [vehicle.id])).rows[0]
      .current_owner_id,
    ids[2],
  );
  const oldInvoice = (await pool.query('SELECT * FROM invoices WHERE id=$1', [firstSale.invoiceId]))
    .rows[0];
  assert.equal(oldInvoice.seller_id, ids[0]);
  assert.equal(oldInvoice.buyer_id, ids[1]);

  // A documented transfer outside the platform needs an explicit extra admin decision.
  const external = await firstOwner('/api/cars', 'POST', form(30000));
  assert.equal(external.status, 201);
  assert.equal((await approve(external.car.id)).status, 409);
  assert.equal(
    (
      await approve(external.car.id, {
        ownership_transfer_confirmed: true,
        expected_owner_id: ids[1],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await approve(external.car.id, {
        ownership_transfer_confirmed: true,
        expected_owner_id: ids[2],
      })
    ).status,
    200,
  );
  const history = (
    await pool.query('SELECT * FROM vehicle_ownership_history WHERE vehicle_id=$1 ORDER BY id', [
      vehicle.id,
    ])
  ).rows;
  assert.deepEqual(
    history.map((h) => h.to_owner_id),
    [ids[0], ids[1], ids[2], ids[0]],
  );
  assert.equal((await secondOwner(`/api/admin/cars/${secondId}/history`)).status, 403);
  const visibleHistory = await admin(`/api/admin/cars/${secondId}/history`);
  assert.equal(visibleHistory.status, 200);
  assert.equal(
    visibleHistory.history.filter((event) => event.source === 'completed_sale').length,
    2,
  );
  const migration = await fs.readFile(
    path.resolve(__dirname, '../database/migrations/014_vehicle_identity_resale.sql'),
    'utf8',
  );
  await pool.query(migration);
  await pool.query(migration);
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM vehicle_ownership_history WHERE vehicle_id=$1',
        [vehicle.id],
      )
    ).rows[0].count,
    history.length,
  );
  assert.equal(
    (await pool.query('SELECT current_owner_id FROM vehicles WHERE id=$1', [vehicle.id])).rows[0]
      .current_owner_id,
    ids[0],
  );
});
