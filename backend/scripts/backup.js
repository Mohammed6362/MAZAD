/**
 * نسخ قاعدة البيانات بصيغة pg_dump وملفات uploads وبيان الاستعادة؛ لا ينسخ أسرار ملف البيئة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
require('../src/config');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { uploadsRoot } = require('../src/config');
const databaseOptions = require('../src/databaseOptions')();
const databaseUrl = databaseOptions.connectionString
  ? new URL(databaseOptions.connectionString)
  : null;
// يستخدم مسار pg_dump المحدد أو يبحث عن تثبيت PostgreSQL على ويندوز قبل الاعتماد على PATH.
async function findDump() {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === 'win32') {
    const parent = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    for (const version of (await fs.readdir(parent).catch(() => [])).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    )) {
      const candidate = path.join(parent, version, 'bin', 'pg_dump.exe');
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  }
  return 'pg_dump';
}
// يكتب النسخة في مجلد مؤقت ثم ينسخه إلى اسم نهائي بعد اكتمال قاعدة البيانات وملفات الصور والبيان.
async function backup() {
  const root = path.resolve(process.env.BACKUP_DIR || path.resolve(__dirname, '../../backups'));
  await fs.mkdir(root, { recursive: true });
  const pending = await fs.mkdtemp(path.join(root, '.pending-'));
  try {
    const dump = await findDump();
    await new Promise((resolve, reject) => {
      const child = spawn(
        dump,
        [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--enable-row-security',
          '--schema=' + (process.env.DB_SCHEMA || 'public'),
          '--file',
          path.join(pending, 'database.dump'),
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            PGHOST: databaseUrl?.hostname || process.env.DB_HOST,
            PGPORT: databaseUrl?.port || process.env.DB_PORT || '5432',
            PGDATABASE: databaseUrl
              ? decodeURIComponent(databaseUrl.pathname.slice(1))
              : process.env.DB_NAME,
            PGUSER: databaseUrl ? decodeURIComponent(databaseUrl.username) : process.env.DB_USER,
            PGPASSWORD: databaseUrl
              ? decodeURIComponent(databaseUrl.password)
              : process.env.DB_PASSWORD,
            PGOPTIONS: databaseOptions.options,
            PGSSLMODE: databaseOptions.ssl ? 'verify-full' : 'prefer',
            ...(databaseOptions.ssl
              ? {
                  PGSSLROOTCERT: process.env.DB_SSL_CA_PATH
                    ? path.resolve(__dirname, '..', process.env.DB_SSL_CA_PATH)
                    : 'system',
                }
              : {}),
          },
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', () =>
        reject(
          new Error(
            'pg_dump is unavailable. Set PG_DUMP_PATH to the PostgreSQL pg_dump executable.',
          ),
        ),
      );
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('Database backup failed: ' + stderr.trim())),
      );
    });
    await fs.cp(uploadsRoot, path.join(pending, 'uploads'), { recursive: true });
    await fs.writeFile(
      path.join(pending, 'manifest.json'),
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          format: 'pg_dump-custom',
          database: 'database.dump',
          uploads: 'uploads',
          note: 'Restore into a new empty database, then restore uploads. Environment secrets are not included.',
        },
        null,
        2,
      ),
    );
    const destination = path.join(
      root,
      'mazad-' +
        new Date().toISOString().replace(/[:.]/g, '-') +
        '-' +
        path.basename(pending).slice(-6),
    );
    await fs.rename(pending, destination);
    console.log('Backup created: ' + destination);
  } catch (error) {
    console.error('Incomplete backup retained at: ' + pending);
    throw error;
  }
}
backup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
