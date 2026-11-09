const fs = require('node:fs/promises');
const path = require('node:path');
const { uploadsRoot } = require('../config');
const supabase = require('./supabase');

function location(storageKey) {
  if (
    !/^(cars|private\/(ownership|passports))\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(storageKey)
  )
    throw new Error('Invalid storage key.');
  return {
    bucket: storageKey.startsWith('cars/') ? 'mazad-cars' : 'mazad-documents',
    key: storageKey,
  };
}

async function saveFile(storageKey, bytes, contentType) {
  const client = supabase.getSupabase();
  if (!client) return;
  const { bucket, key } = location(storageKey);
  const { error } = await client.storage.from(bucket).upload(key, bytes, {
    contentType,
    upsert: false,
    cacheControl: storageKey.startsWith('cars/') ? '3600' : '0',
  });
  if (error) throw new Error('Cloud file upload failed.', { cause: error });
}

async function removeFile(storageKey) {
  const { bucket, key } = location(storageKey);
  const client = supabase.getSupabase();
  if (client) {
    const { error } = await client.storage.from(bucket).remove([key]);
    if (error) throw new Error('Cloud file removal failed.', { cause: error });
  }
  await fs.unlink(path.join(uploadsRoot, storageKey)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

// المستندات تمر بحارس المسار قبل الوصول لهذه الدالة؛ الحاويات نفسها خاصة.
async function sendFile(res, storageKey) {
  const { bucket, key } = location(storageKey);
  const client = supabase.getSupabase();
  if (client) {
    const { data, error } = await client.storage.from(bucket).download(key);
    if (error) {
      res.status(Number(error.statusCode) === 404 ? 404 : 503).end();
      return;
    }
    res.send(Buffer.from(await data.arrayBuffer()));
    return;
  }
  res.sendFile(path.join(uploadsRoot, storageKey), (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
}

module.exports = { location, saveFile, removeFile, sendFile };
