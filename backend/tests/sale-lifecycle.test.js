/**
 * اختبار تكامل الخصوصية والمراجعة والمهلة والضمان والتسليم والاعتراض والاسترداد والمنافسة المتزامنة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const application = require('./helpers/application');

test('private ownership review, deadlines, escrow, delivery, disputes, refunds and concurrent bidding', async (t) => {
  const { pool, client, uploads } = await application(t);
  const owner = client(),
    buyer = client(),
    admin = client(),
    other = client(),
    guest = client();
  const actors = [owner, buyer, admin, other];
  const health = await guest('/api/health', 'GET', undefined, true);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  await health.arrayBuffer();
  const ids = [];
  for (const [index, request] of actors.entries()) {
    assert.equal(
      (
        await request('/api/register', 'POST', {
          full_name: 'Sale fixture ' + index,
          phone: '090333330' + index,
          password: 'SalesTest2026!',
        })
      ).status,
      201,
    );
    ids.push((await request('/api/me')).user.id);
  }
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [ids[2]]);
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  let serial = 0;
  function form(withDocs = true) {
    const body = new FormData();
    Object.entries({
      vin: '1HGCM82633A' + String(++serial).padStart(6, '0'),
      make: 'Hyundai',
      model: 'Azera',
      year: 2022,
      condition: 'good',
      location: 'Tripoli',
    }).forEach(([key, value]) => body.append(key, String(value)));
    body.append('images', new Blob([photo], { type: 'image/png' }), 'car.png');
    if (withDocs)
      body.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'ownership.png');
    return body;
  }
  const noPhoto = form(false);
  noPhoto.delete('images');
  assert.equal((await owner('/api/cars', 'POST', noPhoto)).status, 400);
  assert.equal((await fs.readdir(path.join(uploads, 'cars'))).length, 0);
  const corrupt = form();
  corrupt.set(
    'ownership_documents',
    new Blob([Buffer.from('not an image')], { type: 'image/png' }),
    'fake.png',
  );
  assert.equal((await owner('/api/cars', 'POST', corrupt)).status, 400);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'ownership'))).length, 0);
  const first = await owner('/api/cars', 'POST', form());
  assert.equal(first.status, 201);
  const carId = first.car.id;
  const docs = await admin(`/api/admin/cars/${carId}/ownership`);
  assert.equal(docs.documents.length, 1);
  const doc = docs.documents[0];
  assert.equal((await guest(doc.url, 'GET', undefined, true)).status, 401);
  assert.equal((await owner(doc.url, 'GET', undefined, true)).status, 403);
  assert.equal((await other(doc.url, 'GET', undefined, true)).status, 403);
  const opened = await admin(doc.url, 'GET', undefined, true);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get('cache-control'), /no-store/);
  await opened.arrayBuffer();
  const stored = (
    await pool.query('SELECT storage_key FROM car_ownership_documents WHERE id=$1', [doc.id])
  ).rows[0].storage_key;
  assert.equal((await guest('/uploads/' + stored, 'GET', undefined, true)).status, 404);
  assert.equal((await guest('/uploads/cars/../' + stored, 'GET', undefined, true)).status, 404);
  assert.equal((await guest(`/api/account/cars/${carId}`)).status, 401);
  assert.equal((await admin(`/api/admin/cars/${carId}/approve`, 'PATCH', {})).status, 400);
  const revision = (await admin('/api/admin/cars/pending')).cars.find(
    (car) => car.id === carId,
  ).ownership_revision;
  assert.equal(
    (
      await admin(`/api/admin/cars/${carId}/approve`, 'PATCH', {
        ownership_verified: true,
        ownership_revision: revision - 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin(`/api/admin/cars/${carId}/approve`, 'PATCH', {
        ownership_verified: true,
        ownership_revision: revision,
      })
    ).status,
    200,
  );
  const publicCar = (await guest(`/api/cars/${carId}`)).car;
  assert(!JSON.stringify(publicCar).includes('ownership'));
  assert(!JSON.stringify(publicCar).includes(stored));

  for (const request of [buyer, other])
    assert.equal(
      (
        await request('/api/account/wallet/top-up', 'POST', {
          amount: 100000,
          request_key: randomUUID(),
        })
      ).status,
      200,
    );
  async function auction(mode = 'demo_wallet', useFirst = false) {
    let id = carId;
    if (!useFirst) {
      const created = await owner('/api/cars', 'POST', form());
      assert.equal(created.status, 201, JSON.stringify(created));
      id = created.car.id;
      const car = (await admin('/api/admin/cars/pending')).cars.find((car) => car.id === id);
      assert.equal(
        (
          await admin(`/api/admin/cars/${id}/approve`, 'PATCH', {
            ownership_verified: true,
            ownership_revision: car.ownership_revision,
          })
        ).status,
        200,
      );
    }
    const scheduled = await admin(`/api/admin/cars/${id}/auction`, 'POST', {
      starting_price: 1000,
      min_increment: 10,
      start_time: new Date(Date.now() + 60000),
      end_time: new Date(Date.now() + 3600000),
      payment_mode: mode,
      payment_due_hours: 48,
    });
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled));
    await pool.query(
      "UPDATE auctions SET start_time=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",
      [scheduled.auction.id],
    );
    assert.equal(
      (await buyer(`/api/auctions/${scheduled.auction.id}/bids`, 'POST', { amount: 1000 })).status,
      201,
    );
    return scheduled.auction.id;
  }
  async function close(id) {
    await pool.query(
      "UPDATE auctions SET end_time=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
      [id],
    );
    const result = await admin(`/api/admin/auctions/${id}/close`, 'POST');
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.invoice;
  }
  let id = await auction('demo_wallet', true);
  // 50 competing bid requests: accepted prices remain unique/ascending and fully funded.
  const offered = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      actors[i % 2 ? 3 : 1](`/api/auctions/${id}/bids`, 'POST', { amount: 1010 + i * 10 }),
    ),
  );
  assert(
    offered.every((result) => [201, 409].includes(result.status)),
    JSON.stringify(offered),
  );
  assert(offered.some((result) => result.status === 201));
  const highest = (
    await pool.query('SELECT MAX(amount)::text AS amount FROM bids WHERE auction_id=$1', [id])
  ).rows[0].amount;
  assert.equal(highest, '1500.000');
  const hold = (await pool.query('SELECT * FROM wallet_holds WHERE auction_id=$1', [id])).rows[0];
  assert.equal(hold.amount, highest);
  let invoice = await close(id);
  const winner = String(invoice.buyer_id) === String(ids[1]) ? buyer : other;
  assert.equal(Math.round((new Date(invoice.due_at) - new Date(invoice.issued_at)) / 3600000), 48);
  assert.equal((await guest(`/api/invoices/${invoice.id}/receive`, 'POST')).status, 401);
  assert.equal((await owner(`/api/invoices/${invoice.id}/pay-wallet`, 'POST')).status, 404);
  assert.equal((await winner(`/api/invoices/${invoice.id}/receive`, 'POST')).status, 409);
  const paid = await Promise.all(
    Array.from({ length: 8 }, () => winner(`/api/invoices/${invoice.id}/pay-wallet`, 'POST')),
  );
  assert(paid.every((result) => result.status === 200));
  assert.equal(paid.filter((result) => !result.already_paid).length, 1);
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '0.000');
  assert.equal((await owner('/api/account/wallet')).wallet.pending_proceeds, highest);
  const originalDue = invoice.due_at;
  await pool.query(
    await fs.readFile(
      path.resolve(__dirname, '../database/migrations/012_sale_lifecycle.sql'),
      'utf8',
    ),
  );
  const preserved = (
    await pool.query('SELECT sale_status,due_at FROM invoices WHERE id=$1', [invoice.id])
  ).rows[0];
  assert.equal(preserved.sale_status, 'awaiting_handover');
  assert.equal(new Date(preserved.due_at).toISOString(), new Date(originalDue).toISOString());
  assert.equal(
    (await pool.query('SELECT amount FROM invoice_escrows WHERE invoice_id=$1', [invoice.id]))
      .rows[0].amount,
    highest,
  );
  assert.equal((await owner(`/api/invoices/${invoice.id}/handover`, 'POST')).status, 200);
  const receipts = await Promise.all(
    Array.from({ length: 8 }, () => winner(`/api/invoices/${invoice.id}/receive`, 'POST')),
  );
  assert(receipts.every((result) => result.status === 200));
  assert.equal((await owner('/api/account/wallet')).wallet.balance, highest);
  assert.equal(
    (
      await admin(`/api/admin/invoices/${invoice.id}/cancel`, 'POST', {
        reason: 'Cannot cancel completed sales',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await winner(`/api/invoices/${invoice.id}/dispute`, 'POST', {
        reason: 'Cannot dispute completed sales',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM wallet_transactions WHERE invoice_id=$1 AND kind='sale_credit'",
        [invoice.id],
      )
    ).rows[0].n,
    1,
  );

  id = await auction();
  invoice = await close(id);
  assert.equal((await buyer(`/api/invoices/${invoice.id}/pay-wallet`, 'POST')).status, 200);
  assert.equal(
    (
      await buyer(`/api/invoices/${invoice.id}/dispute`, 'POST', {
        reason: 'The vehicle does not match the description',
      })
    ).status,
    200,
  );
  assert.equal((await owner(`/api/invoices/${invoice.id}/handover`, 'POST')).status, 409);
  assert.equal(
    (
      await buyer(`/api/admin/invoices/${invoice.id}/resume`, 'POST', {
        reason: 'Unauthorized decision',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/admin/invoices/${invoice.id}/resume`, 'POST', {
        reason: 'Resolved after reviewing evidence',
      })
    ).status,
    200,
  );
  assert.equal((await owner(`/api/invoices/${invoice.id}/handover`, 'POST')).status, 200);
  assert.equal(
    (
      await owner(`/api/invoices/${invoice.id}/dispute`, 'POST', {
        reason: 'Buyer reported an issue during handover',
      })
    ).status,
    200,
  );
  const refunds = await Promise.all([
    admin(`/api/admin/invoices/${invoice.id}/cancel`, 'POST', {
      reason: 'Confirmed issue, refund the buyer',
    }),
    admin(`/api/admin/invoices/${invoice.id}/cancel`, 'POST', {
      reason: 'Duplicate refund must not happen',
    }),
  ]);
  assert.deepEqual(refunds.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM wallet_transactions WHERE invoice_id=$1 AND kind='auction_refund'",
        [invoice.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await buyer('/api/invoices')).invoices.find((row) => row.id === invoice.id).settlement_state,
    'refunded',
  );
  assert.equal(
    (await owner('/api/account/cars')).cars.find((car) => String(car.auction_id) === String(id))
      .status,
    'pending_review',
  );
  assert.equal((await other(`/api/invoices/${invoice.id}/events`)).events.length, 0);
  const events = (await buyer(`/api/invoices/${invoice.id}/events`)).events;
  assert(events.some((event) => event.kind === 'resume'));
  assert(events.some((event) => event.kind === 'cancelled'));
  await assert.rejects(
    pool.query("UPDATE invoice_events SET note='tamper' WHERE id=$1", [events[0].id]),
  );

  const { expireUnpaidInvoices } = require('../src/services/sales');
  id = await auction();
  invoice = await close(id);
  await pool.query("UPDATE invoices SET due_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1", [
    invoice.id,
  ]);
  const expirations = await Promise.all([expireUnpaidInvoices(), expireUnpaidInvoices()]);
  assert.equal(
    expirations.reduce((a, b) => a + b, 0),
    1,
  );
  assert.equal(
    (await buyer('/api/invoices')).invoices.find((row) => row.id === invoice.id).sale_status,
    'expired',
  );
  assert.equal((await buyer(`/api/invoices/${invoice.id}/pay-wallet`, 'POST')).status, 409);
  assert.equal((await buyer('/api/account/wallet')).wallet.reserved, '0.000');
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE invoice_id=$1', [
        invoice.id,
      ])
    ).rows[0].n,
    0,
  );

  // A payment waiting for a lock cannot bypass the deadline while waiting.
  id = await auction();
  invoice = await close(id);
  const blocker = await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM auctions WHERE id=$1 FOR UPDATE', [id]);
  const late = buyer(`/api/invoices/${invoice.id}/pay-wallet`, 'POST');
  await blocker.query(
    "UPDATE invoices SET due_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE id=$1",
    [invoice.id],
  );
  await blocker.query('SELECT pg_sleep(0.2)');
  await blocker.query('COMMIT');
  blocker.release();
  assert.equal((await late).status, 409);
  assert.equal(
    (await buyer('/api/invoices')).invoices.find((row) => row.id === invoice.id).sale_status,
    'expired',
  );

  id = await auction('manual');
  invoice = await close(id);
  assert.equal((await admin(`/api/admin/invoices/${invoice.id}/pay`, 'POST')).status, 200);
  assert.equal(
    (
      await admin(`/api/admin/invoices/${invoice.id}/cancel`, 'POST', {
        reason: 'Manual refund needs explicit confirmation',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin(`/api/admin/invoices/${invoice.id}/cancel`, 'POST', {
        reason: 'External manual refund has been processed',
        manual_refund_confirmed: true,
      })
    ).status,
    200,
  );
  const total = (
    await pool.query(
      'SELECT (SELECT sum(balance) FROM wallets)+COALESCE((SELECT sum(amount) FROM invoice_escrows),0) AS total',
    )
  ).rows[0].total;
  assert.equal(total, '200000.000');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoice_escrows')).rows[0].n, 0);
  // Legacy approved cars cannot start another auction before ownership review.
  const legacy = (
    await pool.query(
      "INSERT INTO cars(seller_id,vin,make,model,year,condition,location,status) VALUES($1,'1HGCM82633A999999','Toyota','Camry',2020,'good','Tripoli','approved') RETURNING id",
      [ids[0]],
    )
  ).rows[0];
  const legacyImage = randomUUID() + '.png';
  await fs.copyFile(
    path.resolve(__dirname, '../fixtures/car.png'),
    path.join(uploads, 'cars', legacyImage),
  );
  await pool.query('INSERT INTO car_images(car_id,url,storage_key) VALUES($1,$2,$3)', [
    legacy.id,
    '/uploads/cars/' + legacyImage,
    'cars/' + legacyImage,
  ]);
  assert.equal(
    (
      await admin(`/api/admin/cars/${legacy.id}/auction`, 'POST', {
        starting_price: 1000,
        min_increment: 10,
        start_time: new Date(Date.now() + 60000),
        end_time: new Date(Date.now() + 3600000),
      })
    ).status,
    409,
  );
  const legacyForm = form();
  legacyForm.delete('images');
  legacyForm.set('vin', '1HGCM82633A999999');
  assert.equal((await owner(`/api/account/cars/${legacy.id}`, 'PATCH', legacyForm)).status, 200);
  const oldDoc = (await admin(`/api/admin/cars/${legacy.id}/ownership`)).documents[0];
  const oldKey = (
    await pool.query('SELECT storage_key FROM car_ownership_documents WHERE id=$1', [oldDoc.id])
  ).rows[0].storage_key;
  const oldRevision = (await admin('/api/admin/cars/pending')).cars.find(
    (car) => car.id === legacy.id,
  ).ownership_revision;
  assert.equal((await owner(`/api/account/cars/${legacy.id}`, 'PATCH', legacyForm)).status, 200);
  assert.equal((await admin(oldDoc.url, 'GET', undefined, true)).status, 404);
  await assert.rejects(fs.access(path.join(uploads, oldKey)));
  assert.equal(
    (
      await admin(`/api/admin/cars/${legacy.id}/approve`, 'PATCH', {
        ownership_verified: true,
        ownership_revision: oldRevision,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin(`/api/admin/cars/${legacy.id}/approve`, 'PATCH', {
        ownership_verified: true,
        ownership_revision: oldRevision + 1,
      })
    ).status,
    200,
  );
  await pool.query("DELETE FROM user_roles WHERE user_id=$1 AND role='admin'", [ids[2]]);
  assert.equal((await admin(doc.url, 'GET', undefined, true)).status, 403);
  const obligations = await pool.query(
    'SELECT w.user_id FROM wallets w WHERE w.balance < COALESCE((SELECT sum(amount) FROM wallet_holds h WHERE h.user_id=w.user_id),0)',
  );
  assert.equal(obligations.rowCount, 0);
});
