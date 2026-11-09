/**
 * اختبار الجواز الخاص ورسوم الاعتماد المتزامن والتعديل والصلاحيات وإبطال الجلسات وحماية سجل القرارات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const application = require('./helpers/application');

test('private registration passport, one-time approval fee, owner edits and administrator permissions', async (t) => {
  const { pool, client, uploads } = await application(t);
  await pool.query('UPDATE platform_settings SET listing_fee=10 WHERE id=1');
  const owner = client(),
    admin = client(),
    other = client(),
    guest = client();
  const password = 'PoliciesTest2026!';
  const photo = await fs.readFile(path.resolve(__dirname, '../fixtures/car.png'));
  const identity = (index) => ({
    full_name: 'Policy User ' + index,
    phone: '090555550' + index,
    password,
  });
  // المرحلة الأولى: رفض حساب بلا جواز أو بصورة فاسدة وتنظيف المرفقات قبل أي إنشاء ناجح.
  const missing = new FormData();
  Object.entries(identity(9)).forEach(([key, value]) => missing.append(key, value));
  assert.equal((await guest('/api/register', 'POST', missing)).status, 400);
  missing.append('passport_image', new Blob(['bad image'], { type: 'image/jpeg' }), 'bad.jpg');
  assert.equal((await guest('/api/register', 'POST', missing)).status, 400);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'passports'))).length, 0);
  for (const [index, request] of [owner, admin, other].entries())
    assert.equal((await request('/api/register', 'POST', identity(index))).status, 201);
  const ownerId = (await owner('/api/me')).user.id;
  const adminId = (await admin('/api/me')).user.id;
  const otherId = (await other('/api/me')).user.id;
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [adminId]);
  await pool.query('UPDATE platform_settings SET primary_admin_id=$1 WHERE id=1', [adminId]);
  const me = (await owner('/api/me')).user;
  assert.equal(me.has_passport, true);
  assert.equal(me.can_list, true);
  assert.equal(me.can_bid, true);
  assert(!JSON.stringify(me).includes('storage_key'));
  assert.equal((await guest('/api/register', 'POST', identity(0))).status, 409);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'passports'))).length, 3);
  const passportUrl = `/api/admin/users/${ownerId}/passport`;
  assert.equal((await guest(passportUrl)).status, 401);
  assert.equal((await owner(passportUrl)).status, 403);
  const opened = await admin(passportUrl, 'GET', undefined, true);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get('cache-control'), /private, no-store/);
  await opened.arrayBuffer();
  const stored = (
    await pool.query('SELECT storage_key FROM user_passports WHERE user_id=$1', [ownerId])
  ).rows[0].storage_key;
  assert.equal((await guest('/uploads/' + stored)).status, 404);
  const publicPolicy = await guest('/api/listing-policy');
  assert.equal(publicPolicy.listing_fee, '10.000');
  const carData = {
    vin: '1HGCM82633A008888',
    make: 'Hyundai',
    model: 'Azera',
    year: 2022,
    condition: 'good',
    location: 'Tripoli',
  };
  function carForm() {
    const form = new FormData();
    Object.entries(carData).forEach(([key, value]) => form.append(key, String(value)));
    form.append('images', new Blob([photo], { type: 'image/png' }), 'car.png');
    form.append('ownership_documents', new Blob([photo], { type: 'image/png' }), 'ownership.png');
    return form;
  }
  const created = await owner('/api/cars', 'POST', carForm());
  assert.equal(created.status, 201);
  const id = created.car.id;
  async function approve() {
    const car = (await owner(`/api/account/cars/${id}`)).car;
    return admin(`/api/admin/cars/${id}/approve`, 'PATCH', {
      ownership_verified: true,
      ownership_revision: car.ownership_revision,
    });
  }
  assert.equal((await approve()).status, 409);
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '0.000');
  assert.equal((await owner(`/api/account/cars/${id}`)).car.status, 'pending_review');
  await owner('/api/account/wallet/top-up', 'POST', { amount: 20, request_key: randomUUID() });
  // A funded bid on another seller's car leaves only 5 available of the 20 balance.
  const otherCar = (
    await pool.query(
      "INSERT INTO cars(seller_id,vin,make,model,year,condition,location,status) VALUES($1,'1HGCM82633A008889','Kia','Rio',2022,'good','Tripoli','approved') RETURNING id",
      [otherId],
    )
  ).rows[0].id;
  const auction = (
    await pool.query(
      "INSERT INTO auctions(car_id,starting_price,min_increment,start_time,end_time,status,created_by) VALUES($1,15,1,NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 day','active',$2) RETURNING id",
      [otherCar, adminId],
    )
  ).rows[0].id;
  assert.equal((await owner(`/api/auctions/${auction}/bids`, 'POST', { amount: 15 })).status, 201);
  assert.equal((await approve()).status, 409);
  await admin('/api/account/wallet/top-up', 'POST', { amount: 30, request_key: randomUUID() });
  assert.equal((await admin(`/api/auctions/${auction}/bids`, 'POST', { amount: 16 })).status, 201);
  // المرحلة المالية: طلبات اعتماد متنافسة يجب أن تنتج نجاحًا واحدًا وحركة رسوم واحدة فقط.
  const approvals = await Promise.all(Array.from({ length: 6 }, () => approve()));
  assert.equal(approvals.filter((r) => r.status === 200).length, 1);
  assert(approvals.every((r) => [200, 409].includes(r.status)));
  const wallet = await owner('/api/account/wallet');
  assert.equal(wallet.wallet.balance, '10.000');
  assert.equal(wallet.transactions.filter((tx) => tx.kind === 'listing_fee').length, 1);
  assert.equal((await other(`/api/account/cars/${id}`, 'PATCH', carData)).status, 409);
  const edited = await owner(`/api/account/cars/${id}`, 'PATCH', {
    ...carData,
    location: 'Misrata',
  });
  assert.equal(edited.status, 200);
  assert.equal((await guest(`/api/cars/${id}`)).status, 404);
  assert.equal((await approve()).status, 200);
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '10.000');
  const scheduled = await admin(`/api/admin/cars/${id}/auction`, 'POST', {
    starting_price: 1000,
    min_increment: 100,
    start_time: new Date(Date.now() + 60000),
    end_time: new Date(Date.now() + 600000),
  });
  assert.equal(scheduled.status, 201);
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', carData)).status, 409);
  assert.equal(
    (await admin(`/api/admin/auctions/${scheduled.auction.id}/cancel`, 'POST')).status,
    200,
  );
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', carData)).status, 200);
  assert.equal(
    (await admin(`/api/admin/cars/${id}/reject`, 'PATCH', { reason: 'Fixture rejection' })).status,
    200,
  );
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '10.000');
  // مرحلة الصلاحيات: كل تغيير يوقف الجلسة القديمة ثم نعيد الدخول للتحقق من الحظر من API نفسه.
  const permissions = { can_list: false, can_bid: false, admin: false };
  assert.equal(
    (await owner(`/api/admin/users/${ownerId}/permissions`, 'PATCH', permissions)).status,
    403,
  );
  assert.equal(
    (await admin(`/api/admin/users/${adminId}/permissions`, 'PATCH', permissions)).status,
    409,
  );
  assert.equal(
    (await admin(`/api/admin/users/${ownerId}/permissions`, 'PATCH', permissions)).status,
    200,
  );
  assert.equal((await owner('/api/me')).status, 401);
  assert.equal(
    (await owner('/api/login', 'POST', { phone: identity(0).phone, password })).status,
    200,
  );
  assert.equal((await owner('/api/cars', 'POST', carForm())).status, 403);
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', carData)).status, 403);
  assert.equal((await owner(`/api/auctions/${auction}/bids`, 'POST', { amount: 17 })).status, 403);
  // Financial settlement and wallet access remain available after bidding is disabled.
  assert.equal((await owner('/api/account/wallet')).status, 200);
  assert.equal(
    (
      await admin(`/api/admin/users/${ownerId}/permissions`, 'PATCH', {
        can_list: true,
        can_bid: true,
        admin: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await owner('/api/login', 'POST', { phone: identity(0).phone, password, role: 'admin' }))
      .status,
    200,
  );
  assert.equal((await owner('/api/admin/summary')).status, 200);
  assert.equal((await owner('/api/admin/users')).status, 403);
  assert.equal(
    (
      await owner(`/api/admin/users/${otherId}/permissions`, 'PATCH', {
        can_list: true,
        can_bid: true,
        admin: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/admin/users/${ownerId}/permissions`, 'PATCH', {
        can_list: true,
        can_bid: true,
        admin: false,
      })
    ).status,
    200,
  );
  assert.equal((await owner(passportUrl)).status, 401);
  assert.equal(
    (await owner('/api/login', 'POST', { phone: identity(0).phone, password })).status,
    200,
  );
  assert.equal((await owner(passportUrl)).status, 403);
  const events = await pool.query('SELECT id FROM user_permission_events WHERE user_id=$1', [
    ownerId,
  ]);
  assert.equal(events.rowCount, 3);
  await assert.rejects(
    pool.query('DELETE FROM user_permission_events WHERE user_id=$1', [ownerId]),
  );
  // Reapplying migrations preserves paid fees, passport data and permission decisions.
  // إعادة التحديثات تتحقق من أن الترحيل لا يعيد خصم رسوم أو يفقد الجوازات وقرارات الصلاحيات.
  const directory = path.resolve(__dirname, '../database/migrations');
  for (const name of ['012_sale_lifecycle.sql', '013_passports_permissions_listing_fees.sql'])
    await pool.query(await fs.readFile(path.join(directory, name), 'utf8'));
  assert.equal((await owner('/api/account/wallet')).wallet.balance, '10.000');
  assert.equal(
    (await owner('/api/account/wallet')).transactions.filter((tx) => tx.kind === 'listing_fee')
      .length,
    1,
  );
  assert.equal((await admin(`/api/admin/users?page=0`)).status, 400);
  assert.equal(
    (await admin(`/api/admin/users/${otherId}/status`, 'PATCH', { status: 'suspended' })).status,
    200,
  );
  assert.equal(
    (
      await admin(`/api/admin/users/${otherId}/permissions`, 'PATCH', {
        can_list: true,
        can_bid: true,
        admin: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (await admin(`/api/admin/users/${otherId}/status`, 'PATCH', { status: 'active' })).status,
    200,
  );
  await pool.query(
    "INSERT INTO users(full_name,phone,password_hash) SELECT 'Pagination '||n,'09066'||lpad(n::text,6,'0'),'fixture-unused-hash' FROM generate_series(1,101) n",
  );
  const firstPage = await admin('/api/admin/users?page=1');
  const secondPage = await admin('/api/admin/users?page=2');
  assert.equal(firstPage.users.length, 100);
  assert.equal(firstPage.next_page, 2);
  assert.equal(secondPage.users.length, 4);
  assert.equal(secondPage.next_page, null);
  assert(!JSON.stringify(firstPage.users).includes('password_hash'));
});
