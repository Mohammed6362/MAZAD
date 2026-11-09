/**
 * اختبار ذري للشحن والحجوزات والرصيد المتاح والتمديد والإغلاق والتسوية دون تكرار مالي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const registration = require('./helpers/registration');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
test('demo LYD wallet reserves, releases, extends, closes and settles exactly once under concurrency', async (t) => {
  const schema = `mazad_wallet_${process.pid}_${Date.now()}`;
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'mazad-wallet-test-'));
  process.env.NODE_ENV = 'test';
  const control = new Pool(require('../src/databaseOptions')({ options: undefined }));
  let server, pool;
  t.after(async () => {
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    if (pool) await pool.end();
    assert.match(schema, /^mazad_wallet_\d+_\d+$/);
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
    if (
      !path.resolve(uploads).startsWith(path.resolve(os.tmpdir()) + path.sep + 'mazad-wallet-test-')
    )
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(uploads, { recursive: true, force: true });
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const setup = await control.connect();
  try {
    await setup.query(`SET search_path TO ${schema}`);
    await setup.query(await fs.readFile(path.resolve(__dirname, '../database/schema.sql'), 'utf8'));
    const dir = path.resolve(__dirname, '../database/migrations');
    for (const file of (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort())
      await setup.query(await fs.readFile(path.join(dir, file), 'utf8'));
  } finally {
    setup.release();
  }
  process.env.DB_OPTIONS = `-c search_path=${schema}`;
  process.env.UPLOADS_DIR = uploads;
  process.env.NODE_ENV = 'test';
  const app = require('../src/app');
  pool = require('../src/db');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  function client() {
    let cookie = '';
    return async (url, method = 'GET', body) => {
      if (url === '/api/register' && body) body = registration(body);
      const multipart = body instanceof FormData;
      const response = await fetch(base + url, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
      });
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: response.status, ...(await response.json()) };
    };
  }
  const owner = client(),
    a = client(),
    b = client(),
    admin = client(),
    guest = client();
  const password = 'WalletTest2026!';
  for (const [index, request] of [owner, a, b, admin].entries())
    assert.equal(
      (
        await request('/api/register', 'POST', {
          full_name: 'Wallet User ' + index,
          phone: '090222220' + index,
          password,
        })
      ).status,
      201,
    );
  const ownerId = (await owner('/api/me')).user.id;
  const aId = (await a('/api/me')).user.id;
  const bId = (await b('/api/me')).user.id;
  const adminId = (await admin('/api/me')).user.id;
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [adminId]);
  assert.equal((await guest('/api/account/wallet')).status, 401);
  const key = randomUUID();
  const initialDeposits = await Promise.all([
    a('/api/account/wallet/top-up', 'POST', { amount: '2000', request_key: key }),
    a('/api/account/wallet/top-up', 'POST', { amount: '2000', request_key: key }),
  ]);
  assert(initialDeposits.every((result) => result.status === 200));
  assert.equal(initialDeposits.filter((result) => result.already_completed).length, 1);
  const repeated = await Promise.all([
    a('/api/account/wallet/top-up', 'POST', { amount: '2000.000', request_key: key }),
    a('/api/account/wallet/top-up', 'POST', { amount: 2000, request_key: key }),
  ]);
  assert(repeated.every((result) => result.status === 200 && result.already_completed));
  assert.equal((await a('/api/account/wallet')).wallet.balance, '2000.000');
  assert.equal((await a('/api/account/wallet')).transactions.length, 1);
  assert.equal(
    (await a('/api/account/wallet/top-up', 'POST', { amount: '2001', request_key: key })).status,
    409,
  );
  for (const amount of ['0', '-1', '1.0001', '1000001', 'NaN'])
    assert.equal(
      (await a('/api/account/wallet/top-up', 'POST', { amount, request_key: randomUUID() })).status,
      400,
    );
  assert.equal(
    (await b('/api/account/wallet/top-up', 'POST', { amount: 3000, request_key: randomUUID() }))
      .status,
    200,
  );
  async function createAuction(index) {
    const {
      rows: [car],
    } = await pool.query(
      "INSERT INTO cars(seller_id,vin,make,model,year,condition,location,status) VALUES($1,$2,'Hyundai','Azera',2022,'good','Tripoli','approved') RETURNING id",
      [ownerId, '1HGCM82633A00435' + index],
    );
    const {
      rows: [auction],
    } = await pool.query(
      "INSERT INTO auctions(car_id,starting_price,min_increment,start_time,end_time,status,created_by) VALUES($1,1000,100,clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '30 minutes','active',$2) RETURNING *",
      [car.id, adminId],
    );
    return auction;
  }
  const first = await createAuction(1),
    second = await createAuction(2),
    third = await createAuction(3);
  assert.equal(first.payment_mode, 'demo_wallet');
  assert.equal(
    (await owner('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1000 })).status,
    403,
  );
  assert.equal(
    (await admin('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1000 })).status,
    409,
  );
  await pool.query(
    "UPDATE auctions SET end_time=clock_timestamp()+INTERVAL '60 seconds' WHERE id=$1",
    [first.id],
  );
  assert.equal(
    (await a('/api/auctions/' + first.id + '/bids', 'POST', { amount: '1000.0001' })).status,
    400,
  );
  assert.equal(
    (await a('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1000 })).status,
    201,
  );
  const extended = (await a('/api/auctions/' + first.id)).auction;
  assert(extended.soft_close_seconds === 120);
  const remaining = new Date(extended.end_time) - new Date(extended.server_time);
  assert(remaining > 115000 && remaining <= 120000);
  await assert.rejects(
    pool.query('UPDATE wallets SET balance=0 WHERE user_id=$1', [aId]),
    /balance cannot be below/,
  );
  await assert.rejects(
    pool.query('UPDATE wallet_transactions SET amount=1 WHERE user_id=$1', [aId]),
    /cannot be updated/,
  );
  assert.equal((await a('/api/account/wallet')).wallet.reserved, '1000.000');
  assert.equal((await a('/api/account/wallet')).wallet.available, '1000.000');
  assert.equal(
    (await b('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1100 })).status,
    201,
  );
  assert.equal((await a('/api/account/wallet')).wallet.reserved, '0.000');
  assert.equal(
    (await b('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1200 })).status,
    201,
  );
  assert.equal((await b('/api/account/wallet')).wallet.reserved, '1200.000');
  assert.equal(
    (await a('/api/auctions/' + first.id + '/bids', 'POST', { amount: 1300 })).status,
    201,
  );
  assert.equal((await b('/api/account/wallet')).wallet.available, '3000.000');
  const concurrent = await Promise.all([
    b('/api/auctions/' + second.id + '/bids', 'POST', { amount: 2000 }),
    b('/api/auctions/' + third.id + '/bids', 'POST', { amount: 2000 }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
  const reservedAuction = concurrent.find((result) => result.status === 201).bid.auction_id;
  const manualAuction = String(reservedAuction) === String(second.id) ? third.id : second.id;
  await pool.query("UPDATE auctions SET payment_mode='manual' WHERE id=$1", [manualAuction]);
  await pool.query(
    await fs.readFile(
      path.resolve(__dirname, '../database/migrations/008_demo_wallet.sql'),
      'utf8',
    ),
  );
  assert.equal(
    (await pool.query('SELECT payment_mode FROM auctions WHERE id=$1', [manualAuction])).rows[0]
      .payment_mode,
    'manual',
  );
  const bWallet = (await b('/api/account/wallet')).wallet;
  assert.equal(bWallet.reserved, '2000.000');
  assert.equal(bWallet.available, '1000.000');
  await pool.query('UPDATE auctions SET reserve_price=5000 WHERE id=$1', [reservedAuction]);
  await pool.query(
    "UPDATE auctions SET end_time=clock_timestamp()-INTERVAL '1 second' WHERE id=ANY($1::bigint[])",
    [[first.id, reservedAuction]],
  );
  const { closeEndedAuctions } = require('../src/jobs/closeAuctions');
  assert.equal(await closeEndedAuctions(), 2);
  assert.equal(await closeEndedAuctions(), 0);
  assert.equal((await b('/api/account/wallet')).wallet.reserved, '0.000');
  assert.equal((await b('/api/invoices')).invoices.length, 0);
  const invoice = (await a('/api/invoices')).invoices[0];
  assert(invoice);
  assert.equal(invoice.payment_mode, 'demo_wallet');
  assert.equal(invoice.winning_amount, '1300.000');
  assert.equal((await a('/api/account/wallet')).wallet.reserved, '1300.000');
  assert.equal((await admin('/api/admin/invoices/' + invoice.id + '/pay', 'POST')).status, 409);
  assert.equal((await b('/api/invoices/' + invoice.id + '/pay-wallet', 'POST')).status, 404);
  const payments = await Promise.all([
    a('/api/invoices/' + invoice.id + '/pay-wallet', 'POST'),
    a('/api/invoices/' + invoice.id + '/pay-wallet', 'POST'),
  ]);
  assert(payments.every((result) => result.status === 200));
  assert.equal(payments.filter((result) => result.already_paid).length, 1);
  const after = await a('/api/account/wallet');
  assert.equal(after.wallet.balance, '700.000');
  assert.equal(after.wallet.reserved, '0.000');
  assert.equal(after.wallet.available, '700.000');
  assert.equal(after.transactions.filter((tx) => tx.kind === 'auction_payment').length, 1);
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '0.000');
  assert.equal((await owner('/api/account/wallet')).wallet.pending_proceeds, '1300.000');
  assert.equal((await a('/api/account/wallet')).wallet.escrowed_payments, '1300.000');
  assert.equal((await a('/api/invoices/' + invoice.id + '/receive', 'POST')).status, 409);
  assert.equal((await owner('/api/invoices/' + invoice.id + '/handover', 'POST')).status, 200);
  const receipts = await Promise.all([
    a('/api/invoices/' + invoice.id + '/receive', 'POST'),
    a('/api/invoices/' + invoice.id + '/receive', 'POST'),
  ]);
  assert(receipts.every((result) => result.status === 200));
  const sellerWallet = await owner('/api/account/wallet');
  assert.equal(sellerWallet.wallet.balance, '1300.000');
  assert.equal(sellerWallet.transactions.filter((tx) => tx.kind === 'sale_credit').length, 1);
  assert.equal((await a('/api/invoices')).invoices[0].payment_method, 'demo_wallet');
  assert.equal(
    (await pool.query('SELECT SUM(balance)::text AS total FROM wallets')).rows[0].total,
    '5000.000',
  );
  assert.equal((await a('/api/account/wallet?summary=1')).wallet.balance, '700.000');
  assert(
    (await a('/api/notifications')).notifications.some(
      (notification) => notification.title === 'سداد تجريبي محفوظ حتى تأكيد الاستلام',
    ),
  );
});
