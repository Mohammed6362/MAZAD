/**
 * بناء بيئة اختبار API مع مخطط PostgreSQL ومجلد صور مؤقتين وجلسات منفصلة، ثم تنظيفها بعد الحالة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const registration = require('./registration');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = async function application(t) {
  const schema = `mazad_sale_test_${process.pid}_${Date.now()}`;
  process.env.NODE_ENV = 'test';
  const control = new Pool(require('../../src/databaseOptions')({ options: undefined }));
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'mazad-sale-test-'));
  let pool, server;
  t.after(async () => {
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    if (pool) await pool.end();
    assertFixtureSchema(schema);
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
    if (
      !path.resolve(uploads).startsWith(path.resolve(os.tmpdir()) + path.sep + 'mazad-sale-test-')
    )
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(uploads, { recursive: true, force: true });
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  const setup = await control.connect();
  try {
    await setup.query(`SET search_path TO ${schema}`);
    await setup.query(
      await fs.readFile(path.resolve(__dirname, '../../database/schema.sql'), 'utf8'),
    );
    const dir = path.resolve(__dirname, '../../database/migrations');
    for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.sql')).sort())
      await setup.query(await fs.readFile(path.join(dir, file), 'utf8'));
    // Legacy lifecycle scenarios explicitly waive listing fees; fee tests opt in.
    await setup.query('UPDATE platform_settings SET listing_fee=0 WHERE id=1');
  } finally {
    setup.release();
  }
  process.env.NODE_ENV = 'test';
  process.env.DB_OPTIONS = `-c search_path=${schema}`;
  process.env.UPLOADS_DIR = uploads;
  const app = require('../../src/app');
  pool = require('../../src/db');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (url, method = 'GET', body, raw = false) => {
      if (url === '/api/register' && body) body = registration(body);
      const multipart = body instanceof FormData;
      const response = await fetch(base + url, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
      });
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (raw) return response;
      return { status: response.status, ...(await response.json()) };
    };
  }
  return { pool, client, uploads, base };
};
function assertFixtureSchema(schema) {
  if (!/^mazad_sale_test_\d+_\d+$/.test(schema)) throw new Error('Invalid fixture schema');
}
