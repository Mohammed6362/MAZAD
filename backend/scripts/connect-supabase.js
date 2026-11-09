require('../src/config');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const databaseOptions = require('../src/databaseOptions');
const { getSupabase } = require('../src/services/supabase');
const { location } = require('../src/services/fileStorage');
const { uploadsRoot } = require('../src/config');

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
  if (process.env.DB_SCHEMA !== 'mazad') throw new Error('Set DB_SCHEMA=mazad in backend/.env.');
  const client = getSupabase();
  if (!client) throw new Error('Set SUPABASE_URL and a Supabase server secret key.');
  const url = new URL(process.env.SUPABASE_URL);
  const pool = new Pool(databaseOptions({ options: '-c search_path=mazad' }));
  try {
    const { rows: tables } = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='mazad' ORDER BY tablename",
    );
    if (tables.length < 20)
      throw new Error('Migrate the application database into schema mazad first.');
    const { rows: project } = await pool.query(
      "SELECT current_setting('app.settings.project_ref',true) AS ref",
    );
    if (project[0].ref && url.hostname !== project[0].ref + '.supabase.co')
      throw new Error('Database and Storage must belong to the same Supabase project.');
    for (const name of ['mazad-cars', 'mazad-documents']) {
      const options = {
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      };
      const existing = await client.storage.getBucket(name);
      const result = existing.data
        ? await client.storage.updateBucket(name, options)
        : await client.storage.createBucket(name, options);
      if (result.error)
        throw new Error('Could not configure bucket ' + name, { cause: result.error });
    }
    const { rows: files } = await pool.query(
      `SELECT storage_key FROM car_images WHERE storage_key IS NOT NULL
       UNION SELECT storage_key FROM user_passports
       UNION SELECT storage_key FROM car_ownership_documents`,
    );
    for (const { storage_key: storageKey } of files) {
      const { bucket, key } = location(storageKey);
      const bytes = await fs.readFile(path.join(uploadsRoot, storageKey));
      const contentType = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }[path.extname(key)];
      const uploaded = await client.storage
        .from(bucket)
        .upload(key, bytes, { contentType, upsert: true });
      if (uploaded.error) throw new Error('File transfer failed.', { cause: uploaded.error });
      const downloaded = await client.storage.from(bucket).download(key);
      if (downloaded.error)
        throw new Error('File verification failed.', { cause: downloaded.error });
      const saved = Buffer.from(await downloaded.data.arrayBuffer());
      if (crypto.hash('sha256', bytes) !== crypto.hash('sha256', saved))
        throw new Error('Transferred file checksum mismatch.');
    }
    const channel = client.channel('mazad:market', { config: { private: true } });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Realtime verification timed out.')),
          15000,
        );
        channel.on('broadcast', { event: 'refresh' }, () => {
          clearTimeout(timeout);
          resolve();
        });
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED')
            pool
              .query("SELECT realtime.send('{}'::jsonb,'refresh','mazad:market',true)")
              .catch((error) => {
                clearTimeout(timeout);
                reject(error);
              });
        });
      });
    } finally {
      await client.removeChannel(channel);
    }
    console.log(
      `Verified PostgreSQL, two private Storage buckets, ${files.length} files and Realtime.`,
    );
    console.log('Restart the application to use the verified connection.');
  } finally {
    client.realtime.disconnect();
    await pool.end();
  }
}

connect().catch((error) => {
  console.error('Supabase connection failed:', error.message);
  process.exitCode = 1;
});
