/**
 * استقبال صور السيارات والملكية والجواز في مسارات منفصلة؛ فحص نوع الصورة ومعالجتها وتنظيف الملفات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const pool = require('../db');
const { uploadsRoot } = require('../config');
const fileStorage = require('../services/fileStorage');
const uploadsDir = path.join(uploadsRoot, 'cars');
fs.mkdirSync(uploadsDir, { recursive: true });
const ownershipDir = path.join(uploadsRoot, 'private', 'ownership');
fs.mkdirSync(ownershipDir, { recursive: true });
const passportDir = path.join(uploadsRoot, 'private', 'passports');
fs.mkdirSync(passportDir, { recursive: true });
// مطابقة الامتداد ونوع MIME خطوة أولى فقط؛ validateImage يفحص التوقيع وفك الترميز أيضًا.
const imageRules = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
};
// اسم UUID يمنع الثقة باسم المستخدم، ونوع الحقل يحدد إن كان الملف عامًا أم خاصًا.
const storage = multer.diskStorage({
  destination: (_req, file, callback) =>
    callback(
      null,
      file.fieldname === 'passport_image'
        ? passportDir
        : file.fieldname === 'ownership_documents'
          ? ownershipDir
          : uploadsDir,
    ),
  filename: (_req, file, callback) =>
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 15, fields: 20, fieldSize: 5000 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!imageRules[file.mimetype]?.has(ext))
      return callback(new Error('ارفع صور JPG أو PNG أو WebP فقط.'));
    callback(null, true);
  },
});

// يحذف الملفات الجديدة عند فشل الطلب؛ يتسامح مع ملف سبق حذفه أثناء التنظيف.
function removeFiles(files = []) {
  return Promise.all(
    files.map(async (file) => {
      const key = path.relative(uploadsRoot, file.path).split(path.sep).join('/');
      try {
        await fileStorage.removeFile(key);
      } catch (error) {
        console.error('File cleanup failed:', error.code || error.message);
      }
    }),
  );
}
// يفحص توقيع الصورة وفك ترميزها، ويصحح الاستدارة ويصغر الأبعاد ويزيل البيانات الوصفية قبل الحفظ.
async function validateImage(file) {
  // قراءة البيانات في الذاكرة تفصل معالجة Sharp عن مقبض الملف، فتسمح بإعادة الحفظ على ويندوز.
  const input = await fs.promises.readFile(file.path);
  const data = input.subarray(0, 12);
  const valid =
    file.mimetype === 'image/jpeg'
      ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : file.mimetype === 'image/png'
        ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : file.mimetype === 'image/webp'
          ? data.length >= 12 &&
            data.toString('ascii', 0, 4) === 'RIFF' &&
            data.toString('ascii', 8, 12) === 'WEBP'
          : false;
  if (!valid) throw new Error('أحد الملفات ليس صورة صالحة من النوع المحدد.');
  let buffer;
  try {
    const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[
      file.mimetype
    ];
    // Buffer input prevents libvips from caching a Windows file handle that blocks
    // rewriting or deleting the uploaded JPEG/WebP after image processing.
    buffer = await sharp(input, { limitInputPixels: 40000000, failOn: 'warning' })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .toFormat(format)
      .toBuffer();
  } catch {
    throw new Error('أحد الملفات ليس صورة صالحة أو يتجاوز حجم الأبعاد المسموح.');
  }
  await fs.promises.writeFile(file.path, buffer);
  const key = path.relative(uploadsRoot, file.path).split(path.sep).join('/');
  await fileStorage.saveFile(key, buffer, file.mimetype);
}

// يحذف صورة قديمة من القرص فقط عندما لا يبقى سجل يستخدمها، مع تقييد مفتاح التخزين للمجلد العام.
async function removeStoredImages(images) {
  for (const image of images) {
    if (
      !image.storage_key ||
      !/^cars\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(image.storage_key)
    )
      continue;
    try {
      const remaining = await pool.query(
        'SELECT 1 FROM car_images WHERE storage_key=$1 OR url=$2 LIMIT 1',
        [image.storage_key, image.url],
      );
      if (remaining.rowCount) continue;
      await fileStorage.removeFile(image.storage_key);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Image cleanup failed:', error.code || 'unknown');
    }
  }
}
// يفصل طلب السيارة بين صور الإعلان العامة وأوراق الملكية الخاصة، مع حد مستقل لكل مجموعة.
const carUpload = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'ownership_documents', maxCount: 5 },
]);
const passportUpload = upload.single('passport_image');
module.exports = {
  upload,
  carUpload,
  passportUpload,
  validateImage,
  removeFiles,
  removeStoredImages,
};
