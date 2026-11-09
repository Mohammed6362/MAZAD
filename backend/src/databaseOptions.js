const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

// جميع أدوات التشغيل تستخدم الاتصال نفسه، مع مخطط مستقل لبيانات المزاد في Supabase.
module.exports = function databaseOptions(overrides = {}) {
  const schema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA.');
  let connectionString;
  let hostname = process.env.DB_HOST || 'localhost';
  let sslMode;
  const databaseUrl =
    process.env.NODE_ENV === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (databaseUrl) {
    let url;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
      throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
    hostname = url.hostname;
    sslMode = url.searchParams.get('sslmode');
    // pg يعيد تفسير إعدادات SSL في URI؛ تبقى شهادة الجذر والتحقق تحت إعداد واحد.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    connectionString = url.toString();
  }
  const useSsl =
    process.env.DB_SSL === 'true' ||
    (process.env.DB_SSL !== 'false' &&
      (['require', 'verify-ca', 'verify-full'].includes(sslMode) ||
        /\.(supabase\.co|pooler\.supabase\.com)$/.test(hostname)));
  const ssl = useSsl ? { rejectUnauthorized: true } : undefined;
  if (useSsl && process.env.DB_SSL_CA_PATH)
    ssl.ca = fs.readFileSync(path.resolve(__dirname, '..', process.env.DB_SSL_CA_PATH), 'utf8');
  return {
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 5432),
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
        }),
    options: process.env.DB_OPTIONS || `-c search_path=${schema}`,
    ssl,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...overrides,
  };
};
