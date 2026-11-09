/**
 * تجميع Express؛ رؤوس الحماية والجلسات والملفات العامة ومسارات API وواجهة الإنتاج ومعالجة الأخطاء.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { isProduction, sessionSecret, sessionTtl, uploadsRoot, frontendDist } = require('./config');
const PostgresSessionStore = require('./sessionStore');
const { respondError } = require('./utils/http');
if (!sessionSecret || sessionSecret.length < 32)
  throw new Error('Set SESSION_SECRET to at least 32 random characters.');
const app = express();
// سجل الطلبات يسبق المسارات حتى تحمل الأخطاء والنجاحات معرّف تتبع واحدًا.
app.use(require('./middleware/requestLog'));
if (isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  // Account balances and private records must never be reused from a browser cache.
  res.setHeader('Cache-Control', 'no-store');
  next();
});
if (!isProduction)
  // هوية خدمة الخلفية أثناء التطوير؛ يستخدمها المشغّل لتمييزها عن برنامج آخر على المنفذ نفسه.
  app.get('/api/dev/status', (_req, res) => res.json({ service: 'mazad-libya-api' }));
// رؤوس الحماية تطبق على الاستجابات؛ سياسات HTTPS وCSP الأشد تُفعل في الإنتاج فقط.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProduction) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});
// حد جسم JSON لا ينطبق على ملفات multipart؛ أحجام الصور تُضبط في middleware الرفع.
app.use(express.json({ limit: '32kb' }));
// صور السيارات وحدها ملفات ثابتة؛ أوراق الملكية تمر بمسار الإدارة أو مسار المزاد المعتمد.
app.use(
  '/uploads/cars',
  express.static(path.join(uploadsRoot, 'cars'), { dotfiles: 'deny', index: false }),
);
app.use('/uploads', (_req, res) => respondError(res, 404, 'الملف غير متاح.'));
// ملف الارتباط يحمل معرّف الجلسة؛ محتواها محفوظ في PostgreSQL، ولا تُنشأ جلسة فارغة لكل زائر.
app.use(
  session({
    name: 'mazad.sid',
    secret: sessionSecret,
    store: new PostgresSessionStore(pool),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: sessionTtl },
  }),
);
// يرفض معرفات الروابط غير الرقمية أو غير الموجبة قبل وصولها إلى استعلامات المسارات.
app.param('id', (req, res, next, id) =>
  /^\d{1,18}$/.test(id) && Number(id) > 0 ? next() : respondError(res, 400, 'معرّف غير صالح.'),
);
// فحص جاهزية API عبر استعلام بسيط لقاعدة البيانات، ويستخدمه التشغيل ومراقبة الخدمة.
app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
// تركيب ملفات المسارات بعد الجلسة يجعل هوية صاحب الطلب متاحة لكل حارس صلاحيات.
for (const route of [
  'auth',
  'cars',
  'admin',
  'auctions',
  'account',
  'profile',
  'admin-users',
  'wallet',
  'sales',
  'ownership',
])
  require('./routes/' + route)(app);
app.use('/api', (_req, res) => respondError(res, 404, 'المسار المطلوب غير موجود.'));
// Serve the built React application on the same origin as the API.
app.use(express.static(frontendDist));
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/uploads/')) return respondError(res, 404, 'الصورة غير موجودة.');
  if (fs.existsSync(path.join(frontendDist, 'index.html')))
    return res.sendFile(path.join(frontendDist, 'index.html'));
  return res
    .status(503)
    .send(
      'Build the frontend with npm.cmd run build, or use http://localhost:5173 during development.',
    );
});
// الحد الأخير للأخطاء: يعرض أخطاء الإدخال المعروفة ويخفي تفاصيل الأعطال الداخلية عن المستخدم.
app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (
    error.publicMessage &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
  )
    return respondError(res, error.status, error.message);
  if (error.type === 'entity.parse.failed') return respondError(res, 400, 'صيغة الطلب غير صالحة.');
  if (error.type === 'entity.too.large')
    return respondError(res, 413, 'حجم الطلب أكبر من المسموح.');
  if (['22P02', '22003', '22007', '22008'].includes(error.code))
    return respondError(res, 400, 'تحقق من الأرقام والمواعيد المدخلة.');
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'حجم الصورة الواحدة يجب ألا يتجاوز 5 ميغابايت.'
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'يمكن رفع 10 صور كحد أقصى.'
          : 'تعذّر معالجة الصور المرفقة.';
    return respondError(res, 400, message);
  }
  if (error.message?.startsWith('ارفع صور') || error.message?.includes('صورة صالحة'))
    return respondError(res, 400, error.message);
  console.error(
    JSON.stringify({
      event: 'request_error',
      request_id: _req.requestId,
      code: error.code || error.name,
    }),
  );
  return respondError(res, 500, 'حدث خطأ في الخادم. حاول مرة أخرى لاحقًا.');
});

module.exports = app;
