/**
 * مشغّل التطوير المشترك؛ يستخدم الخدمات القائمة أو يبدأ الناقص منها ويوقف فقط العمليات التي أنشأها.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { inspectService } = require('./dev-services');
const backendOnly = process.argv.includes('--backend-only');
const apiPort = backendOnly ? require('../backend/src/config').port : 3000;
const jobs = [];
const watchArgs = ['win32', 'darwin'].includes(process.platform)
  ? ['--watch-path=src', '--watch-path=server.js', '--watch-path=.env']
  : ['--watch'];
const services = [
  {
    name: 'API',
    port: apiPort,
    statusPath: '/api/dev/status',
    service: 'mazad-libya-api',
    cwd: 'backend',
    args: [...watchArgs, 'server.js'],
  },
  {
    name: 'Frontend',
    port: 5173,
    statusPath: '/__mazad_dev',
    service: 'mazad-libya-frontend',
    cwd: 'frontend',
    args: ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--strictPort'],
  },
].filter((service) => !backendOnly || service.name === 'API');
let stopping = false;
// يوقف فقط العمليات التابعة التي بدأها هذا المشغّل؛ الخدمات التي أعاد استخدامها تبقى لدى نافذتها الأصلية.
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const job of jobs) {
    if (!job.pid || job.exitCode !== null) continue;
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill', ['/pid', String(job.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else job.kill('SIGTERM');
    } catch {
      /* The child may already have stopped. */
    }
  }
  process.exitCode = code;
}
// يفحص كل المنافذ قبل بدء أي عملية، ثم يعيد استخدام الخدمة الصحيحة أو يشغل الخدمة الناقصة.
async function main() {
  const states = await Promise.all(services.map(inspectService));
  // Validate all ports before launching either process.
  for (let index = 0; index < services.length; index++) {
    if (states[index] === 'occupied') {
      console.error(
        'Port ' +
          services[index].port +
          ' is used by another application or an older server. Stop its terminal with Ctrl+C, then run npm.cmd run dev again.',
      );
      process.exitCode = 1;
      return;
    }
  }
  for (let index = 0; index < services.length; index++) {
    const service = services[index];
    if (states[index] === 'running') {
      console.log(
        service.name + ' already running at http://localhost:' + service.port + ' (reusing it).',
      );
      continue;
    }
    const job = spawn(process.execPath, service.args, {
      cwd: path.join(root, service.cwd),
      stdio: 'inherit',
    });
    jobs.push(job);
    job.on('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    job.on('exit', (code) => {
      if (!stopping) stop(code || 0);
    });
  }
  console.log(
    services.map((service) => `${service.name}: http://localhost:${service.port}`).join(' | '),
  );
  if (!jobs.length)
    console.log('The project is already running. Open the website; no extra server was started.');
}
main().catch((error) => {
  console.error(error.message);
  stop(1);
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
