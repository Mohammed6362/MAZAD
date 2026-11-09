const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const application = require('./helpers/application');

test('approved auction ownership images are public while pending papers, unrelated files and passports stay protected', async (t) => {
  const { pool, client } = await application(t);
  const owner = client(),
    admin = client(),
    guest = client();
  for (const [index, request] of [owner, admin].entries()) {
    assert.equal(
      (
        await request('/api/register', 'POST', {
          full_name: 'Ownership publication ' + index,
          phone: '090888880' + index,
          password: 'Documents2026!',
        })
      ).status,
      201,
    );
  }
  const adminId = (await admin('/api/me')).user.id;
  const ownerId = (await owner('/api/me')).user.id;
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [adminId]);
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  function form(vin) {
    const body = new FormData();
    Object.entries({
      vin,
      make: 'Hyundai',
      model: 'Azera',
      year: 2022,
      condition: 'good',
      location: 'طرابلس',
    }).forEach(([name, value]) => body.append(name, String(value)));
    body.append('images', new Blob([photo], { type: 'image/png' }), 'car.png');
    body.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'ownership.png');
    return body;
  }
  const vin = '1HGCM82633A008881';
  const first = await owner('/api/cars', 'POST', form(vin));
  const second = await owner('/api/cars', 'POST', form('1HGCM82633A008882'));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const documents = (await admin(`/api/admin/cars/${first.car.id}/ownership`)).documents;
  const otherDocument = (await admin(`/api/admin/cars/${second.car.id}/ownership`)).documents[0];
  const schedule = () =>
    admin(`/api/admin/cars/${first.car.id}/auction`, 'POST', {
      starting_price: 1000,
      start_time: new Date(Date.now() + 60000),
      end_time: new Date(Date.now() + 3600000),
    });
  assert.equal((await schedule()).status, 409);
  assert.equal((await guest('/api/auctions/999999/ownership')).status, 404);
  assert.equal((await guest(documents[0].url, 'GET', undefined, true)).status, 401);
  assert.equal(
    (await guest(`/api/admin/users/${ownerId}/passport`, 'GET', undefined, true)).status,
    401,
  );
  assert.equal(
    (
      await admin(`/api/admin/cars/${first.car.id}/approve`, 'PATCH', {
        ownership_verified: true,
        ownership_revision: 1,
      })
    ).status,
    200,
  );
  const auction = await schedule();
  assert.equal(auction.status, 201, JSON.stringify(auction));
  const auctionId = auction.auction.id;
  const published = await guest(`/api/auctions/${auctionId}/ownership`);
  assert.equal(published.status, 200);
  assert.equal(published.documents.length, 1);
  assert(!JSON.stringify(published).includes('storage_key'));
  assert(!JSON.stringify(published).includes('private/'));
  const image = await guest(published.documents[0].url, 'GET', undefined, true);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert((await image.arrayBuffer()).byteLength > 0);
  assert.equal(
    (
      await guest(
        `/api/auctions/${auctionId}/ownership/${otherDocument.id}`,
        'GET',
        undefined,
        true,
      )
    ).status,
    404,
  );
  const stored = (
    await pool.query('SELECT storage_key FROM car_ownership_documents WHERE id=$1', [
      documents[0].id,
    ])
  ).rows[0].storage_key;
  assert.equal((await guest('/uploads/' + stored, 'GET', undefined, true)).status, 404);
  await pool.query("UPDATE auctions SET status='cancelled' WHERE id=$1", [auctionId]);
  assert.equal((await owner(`/api/account/cars/${first.car.id}`, 'PATCH', form(vin))).status, 200);
  assert.equal((await guest(`/api/auctions/${auctionId}/ownership`)).status, 404);
  assert.equal((await guest(published.documents[0].url, 'GET', undefined, true)).status, 404);
});
