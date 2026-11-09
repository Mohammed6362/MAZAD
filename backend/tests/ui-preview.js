/**
 * خادم واجهة اختباري مع حسابات وصور اصطناعية وأوامر تحكم في المهل والرسوم؛ ينظف بياناته عند الإنهاء.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Disposable local UI fixture. It never uses application users or uploads.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const schema = `mazad_preview_${process.pid}_${Date.now()}`;
const stopFile = path.join(os.tmpdir(), `mazad-preview-${process.pid}.stop`);
const control = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
let server,
  pool,
  uploads,
  closing = false;
// يغلق خادم المعاينة ويحذف مخططه ومجلد مرفقاته المؤقت بعد التحقق من اسم المخطط.
async function close() {
  if (closing) return;
  closing = true;
  if (server) {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
  if (pool) await pool.end();
  if (!/^mazad_preview_\d+_\d+$/.test(schema)) throw new Error('Invalid fixture schema');
  await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await control.end();
  if (uploads) await fs.rm(uploads, { recursive: true, force: true });
  await fs.unlink(stopFile).catch(() => {});
  console.log('Preview fixtures removed.');
  process.exit();
}
// ينشئ مخططًا معزولًا وحسابات وصورًا اصطناعية ثم يبدأ خادم المعاينة ويستقبل أوامر الاختبار.
async function main() {
  await control.query(`CREATE SCHEMA ${schema}`);
  const setup = await control.connect();
  try {
    await setup.query(`SET search_path TO ${schema}`);
    await setup.query(await fs.readFile(path.resolve(__dirname, '../database/schema.sql'), 'utf8'));
    const directory = path.resolve(__dirname, '../database/migrations');
    for (const file of (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
      await setup.query(await fs.readFile(path.join(directory, file), 'utf8'));
    await setup.query('UPDATE platform_settings SET listing_fee=0 WHERE id=1');
    const hash = await bcrypt.hash('PreviewOnly2026!', 12);
    await setup.query(
      "INSERT INTO users(full_name,phone,password_hash) VALUES('مدير المعاينة','0900000011',$1),('بائع المعاينة','0900000012',$1),('مشتري المعاينة','0900000013',$1)",
      [hash],
    );
    await setup.query("INSERT INTO user_roles(user_id,role) VALUES(1,'admin')");
    await setup.query('UPDATE platform_settings SET primary_admin_id=1 WHERE id=1');
    await setup.query(
      "INSERT INTO cars(seller_id,vin,make,model,year,condition,location,status) VALUES(2,'1HGCM82633A004351','Toyota','Camry',2022,'good','طرابلس','pending_review'),(2,'1HGCM82633A004352','Kia','Sportage',2023,'excellent','مصراتة','approved')",
    );
    await setup.query(
      "INSERT INTO car_images(car_id,url,storage_key) VALUES(1,'/uploads/cars/fixture.png','cars/fixture.png'),(2,'/uploads/cars/fixture.png','cars/fixture.png')",
    );
    await setup.query(
      "INSERT INTO car_ownership_documents(car_id,storage_key,mime_type) VALUES(1,'private/ownership/11111111-1111-4111-8111-111111111111.png','image/png'),(2,'private/ownership/22222222-2222-4222-8222-222222222222.png','image/png')",
    );
    await setup.query(
      "UPDATE cars SET ownership_status=CASE WHEN id=2 THEN 'verified' ELSE 'pending' END",
    );
    await setup.query(
      "INSERT INTO auctions(car_id,starting_price,min_increment,start_time,end_time,status,created_by) VALUES(2,20000,100,NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 day','active',1)",
    );
  } finally {
    setup.release();
  }
  uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'mazad-preview-'));
  await fs.mkdir(path.join(uploads, 'cars'));
  await fs.copyFile(
    path.resolve(__dirname, '../fixtures/car.png'),
    path.join(uploads, 'cars/fixture.png'),
  );
  await fs.mkdir(path.join(uploads, 'private', 'ownership'), { recursive: true });
  for (const filename of [
    '11111111-1111-4111-8111-111111111111.png',
    '22222222-2222-4222-8222-222222222222.png',
  ])
    await fs.copyFile(
      path.resolve(__dirname, '../fixtures/car.png'),
      path.join(uploads, 'private', 'ownership', filename),
    );
  process.env.DB_OPTIONS = `-c search_path=${schema}`;
  process.env.UPLOADS_DIR = uploads;
  process.env.NODE_ENV = 'test';
  const app = require('../src/app');
  pool = require('../src/db');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  console.log('Preview: http://127.0.0.1:' + server.address().port);
  console.log('Fixture admin 0900000011 | password PreviewOnly2026! | send stop to clean up.');
  console.log('Alternative cleanup: create this empty file: ' + stopFile);
  setInterval(
    () =>
      fs
        .access(stopFile)
        .then(() => close())
        .catch(() => {}),
    500,
  ).unref();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (text) => {
    if (text.trim() === 'stop') return close().catch(console.error);
    if (text.trim() === 'enable-fees') {
      await pool.query('UPDATE platform_settings SET listing_fee=10 WHERE id=1');
      console.log('Listing fee enabled: 10');
      return;
    }
    if (text.trim() === 'finish') {
      try {
        const current = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
        if (current !== schema) throw new Error('Fixture schema mismatch');
        await pool.query(
          "UPDATE auctions SET start_time=LEAST(start_time,clock_timestamp()-INTERVAL '2 minutes'),end_time=clock_timestamp()-INTERVAL '1 second' WHERE status IN ('active','scheduled')",
        );
        const { closeEndedAuctions } = require('../src/jobs/closeAuctions');
        console.log('Closed fixture auctions: ' + (await closeEndedAuctions()));
      } catch (error) {
        console.error(error.message);
      }
    }
    if (text.trim() === 'expire') {
      try {
        const current = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
        if (current !== schema) throw new Error('Fixture schema mismatch');
        await pool.query(
          "UPDATE invoices SET due_at=clock_timestamp()-INTERVAL '1 second' WHERE sale_status='awaiting_payment'",
        );
        console.log(
          'Expired fixture invoices: ' +
            (await require('../src/services/sales').expireUnpaidInvoices()),
        );
      } catch (error) {
        console.error(error.message);
      }
    }
  });
  process.stdin.resume();
}
process.on('SIGINT', () => close().catch(console.error));
process.on('SIGTERM', () => close().catch(console.error));
main().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
  await close();
});
