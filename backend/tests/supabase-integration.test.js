const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const databaseOptions = require('../src/databaseOptions');
const supabase = require('../src/services/supabase');
const application = require('./helpers/application');

test('DATABASE_URL and a private schema use verified TLS while retaining fixture overrides', (t) => {
  const original = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  });
  process.env.DATABASE_URL =
    'postgresql://postgres.ref:example@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require';
  process.env.NODE_ENV = 'development';
  process.env.DB_SCHEMA = 'mazad';
  delete process.env.DB_OPTIONS;
  delete process.env.DB_SSL;
  delete process.env.DB_SSL_CA_PATH;
  const options = databaseOptions();
  assert.equal(options.options, '-c search_path=mazad');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert(!options.connectionString.includes('sslmode'));
  assert.equal(options.host, undefined);
  assert.equal(databaseOptions({ options: undefined }).options, undefined);
  process.env.DB_SCHEMA = 'mazad; DROP SCHEMA public';
  assert.throws(() => databaseOptions(), /Invalid DB_SCHEMA/);
});

test('failed cloud upload rolls back account creation and cleans temporary and remote files', async (t) => {
  const { pool, client, uploads } = await application(t);
  const removed = [];
  t.mock.method(supabase, 'getSupabase', () => ({
    storage: {
      from: (bucket) => ({
        upload: async () => ({ error: { message: 'Simulated cloud failure' } }),
        remove: async (keys) => {
          removed.push({ bucket, keys });
          return { error: null };
        },
      }),
    },
  }));
  const result = await client()('/api/register', 'POST', {
    full_name: 'Cloud fixture',
    phone: '0907777777',
    password: 'CloudFixture2026!',
  });
  assert.equal(result.status, 500);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'passports'))).length, 0);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].bucket, 'mazad-documents');
  const storage = require('../src/services/fileStorage');
  assert.throws(() => storage.location('../passport.png'), /Invalid storage key/);
  assert.throws(() => storage.location('cars/../passport.png'), /Invalid storage key/);
});

test('Realtime relays only a refresh signal and closes streams on shutdown', async (t) => {
  let broadcast;
  let unsubscribed = false;
  const channel = {
    on(_type, _filter, callback) {
      broadcast = callback;
      return this;
    },
    subscribe(callback) {
      setImmediate(() => callback('SUBSCRIBED'));
      return this;
    },
  };
  t.mock.method(supabase, 'getSupabase', () => ({
    channel(name, options) {
      assert.equal(name, 'mazad:market');
      assert.equal(options.config.private, true);
      return channel;
    },
    async removeChannel() {
      unsubscribed = true;
    },
  }));
  const app = express();
  require('../src/routes/realtime')(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.stopRealtime();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/realtime/events`);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  broadcast({ payload: { password: 'sensitive', user_id: 'private' } });
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('event: market')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += Buffer.from(chunk.value).toString();
  }
  assert(text.includes('data: {}'));
  assert(!text.includes('sensitive'));
  assert(!text.includes('user_id'));
  await reader.cancel();
  await app.locals.stopRealtime();
  assert(unsubscribed);
});
