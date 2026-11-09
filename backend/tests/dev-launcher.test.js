/**
 * يتأكد أن المشغّل يعيد استخدام خدمة المشروع ويحترم التطبيق الآخر ولا يبدأ نسخة خلفية مكررة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { inspectService } = require('../../scripts/dev-services');

async function withServer(t, body) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return server.address().port;
}
test('reuse a running project service without starting a duplicate', async (t) => {
  const port = await withServer(t, { service: 'mazad-libya-frontend' });
  assert.equal(
    await inspectService({ port, statusPath: '/__mazad_dev', service: 'mazad-libya-frontend' }),
    'running',
  );
});
test('do not reuse or terminate an unrelated application on the same port', async (t) => {
  const port = await withServer(t, { service: 'other-project' });
  assert.equal(
    await inspectService({ port, statusPath: '/__mazad_dev', service: 'mazad-libya-frontend' }),
    'occupied',
  );
});

test('backend-only launcher exits successfully when the API is already running', async (t) => {
  const port = await withServer(t, { service: 'mazad-libya-api' });
  const { stdout } = await run(process.execPath, ['../scripts/dev.js', '--backend-only'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    timeout: 10000,
  });
  assert.match(stdout, /API already running/);
  assert.doesNotMatch(stdout, /Frontend:/);
  const response = await fetch(`http://127.0.0.1:${port}/api/dev/status`);
  assert.equal(response.status, 200);
});

test('backend-only launcher leaves an unrelated server running and reports the conflict', async (t) => {
  const port = await withServer(t, { service: 'other-project' });
  await assert.rejects(
    run(process.execPath, ['../scripts/dev.js', '--backend-only'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: String(port) },
      timeout: 10000,
    }),
    (error) => error.code === 1 && error.stderr.includes('used by another application'),
  );
  const response = await fetch(`http://127.0.0.1:${port}/api/dev/status`);
  assert.equal(response.status, 200);
});
