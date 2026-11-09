/**
 * اختبار صور JPEG وPNG وWebP على ويندوز؛ المعالجة والخصوصية والاستبدال وتنظيف المستندات القديمة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const application = require('./helpers/application');

test('JPEG, PNG and WebP ownership uploads can be saved, sanitized, replaced and removed on Windows', async (t) => {
  const { pool, client, uploads } = await application(t);
  const owner = client();
  const admin = client();
  for (const [index, request] of [owner, admin].entries()) {
    const registered = await request('/api/register', 'POST', {
      full_name: 'Upload fixture ' + index,
      phone: '090444440' + index,
      password: 'UploadsTest2026!',
    });
    assert.equal(registered.status, 201);
  }
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [
    (await admin('/api/me')).user.id,
  ]);
  const formats = [
    ['jpeg', 'image/jpeg', 'document.jpeg'],
    ['png', 'image/png', 'document.png'],
    ['webp', 'image/webp', 'document.webp'],
  ];
  const images = await Promise.all(
    formats.map(async ([format, mime, name]) => ({
      mime,
      name,
      bytes: await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: '#dddde4' },
      })
        .withMetadata({ orientation: 6 })
        .toFormat(format)
        .toBuffer(),
    })),
  );
  function form(documents, carPhoto = null) {
    const body = new FormData();
    Object.entries({
      vin: '1HGCM82633A009999',
      make: 'Hyundai',
      model: 'Azera',
      year: 2022,
      condition: 'good',
      location: 'Tripoli',
    }).forEach(([key, value]) => body.append(key, String(value)));
    if (carPhoto)
      body.append('images', new Blob([carPhoto.bytes], { type: carPhoto.mime }), 'car.jpg');
    for (const doc of documents)
      body.append('ownership_documents', new Blob([doc.bytes], { type: doc.mime }), doc.name);
    return body;
  }
  const created = await owner('/api/cars', 'POST', form(images, images[0]));
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.car.id;
  const first = await admin(`/api/admin/cars/${id}/ownership`);
  assert.equal(first.documents.length, 3);
  for (const doc of first.documents) {
    assert.equal((await owner(doc.url, 'GET', undefined, true)).status, 403);
    const response = await admin(doc.url, 'GET', undefined, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), doc.mime_type);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert(Math.max(metadata.width, metadata.height) <= 2400);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
  }
  const invalid = { mime: 'image/jpeg', name: 'broken.jpg', bytes: Buffer.from('invalid') };
  assert.equal((await owner(`/api/account/cars/${id}`, 'PATCH', form([invalid]))).status, 400);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'ownership'))).length, 3);
  const replaced = await owner(`/api/account/cars/${id}`, 'PATCH', form([images[2]]));
  assert.equal(replaced.status, 200, JSON.stringify(replaced));
  const latest = await admin(`/api/admin/cars/${id}/ownership`);
  assert.equal(latest.documents.length, 1);
  assert.equal(latest.documents[0].mime_type, 'image/webp');
  for (const doc of first.documents)
    assert.equal((await admin(doc.url, 'GET', undefined, true)).status, 404);
  assert.equal((await fs.readdir(path.join(uploads, 'private', 'ownership'))).length, 1);
});
