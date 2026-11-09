/**
 * مسارات الدخول والتسجيل بالجواز والجلسة الحالية والخروج؛ تحفظ كلمة المرور مشفرة وتمنع طلب الإدارة عند التسجيل.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { normalizeRole, primaryRole } = require('../utils/roles');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { isProduction } = require('../config');
const { loginRateLimit, loginAttempts, requireUser } = require('../middleware/auth');
const { trimField, respondError, sessionOperation } = require('../utils/http');
const { passportUpload, validateImage, removeFiles } = require('../middleware/uploads');
module.exports = function registerRoutes(app) {
  // دخول الحساب: فحص الهوية وكلمة المرور والدور ثم تجديد معرّف الجلسة لمنع إعادة استخدام جلسة سابقة.
  app.post('/api/login', loginRateLimit, async (req, res, next) => {
    try {
      const rawIdentity = trimField(req.body?.phone || req.body?.email, 255);
      const identity = rawIdentity.includes('@') ? rawIdentity : rawIdentity.replace(/[\s-]/g, '');
      const password = req.body?.password;
      const requestedRole = req.body?.role === undefined ? null : normalizeRole(req.body.role);
      if (
        !identity ||
        typeof password !== 'string' ||
        !password ||
        (req.body?.role !== undefined && !requestedRole)
      ) {
        return respondError(res, 400, 'أدخل بيانات الدخول الصحيحة.');
      }
      const result = await pool.query(
        `SELECT u.id, u.password_hash, u.status, u.auth_version,
              ARRAY(SELECT role::text FROM user_roles ur WHERE ur.user_id=u.id) AS roles
       FROM users u WHERE u.phone = $1 OR lower(u.email) = lower($1) LIMIT 1`,
        [identity],
      );
      const user = result.rows[0];
      const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
      if (
        !user ||
        user.status !== 'active' ||
        !user.roles.length ||
        (requestedRole && !user.roles.includes(requestedRole)) ||
        !matches
      ) {
        return respondError(res, 401, 'بيانات الدخول غير صحيحة.');
      }
      const role = primaryRole(user.roles);
      // تجديد معرّف الجلسة بعد إثبات الهوية يمنع ربط الحساب بجلسة قديمة أنشأها طرف آخر.
      await sessionOperation(req, 'regenerate');
      req.session.userId = String(user.id);
      req.session.authVersion = user.auth_version;
      req.session.role = role;
      await sessionOperation(req, 'save');
      loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
      return res.json({ success: true, message: 'تم تسجيل الدخول بنجاح.', role });
    } catch (error) {
      next(error);
    }
  });

  // إنشاء حساب جديد بصورته الخاصة؛ بيانات الحساب والجواز تحفظان معًا ثم تُنشأ جلسة للمستخدم.
  app.post('/api/register', loginRateLimit, passportUpload, async (req, res, next) => {
    const files = req.file ? [req.file] : [];
    const fullName = trimField(req.body?.full_name, 120);
    const phone = trimField(req.body?.phone, 20).replace(/[\s-]/g, '');
    const email = trimField(req.body?.email, 255) || null;
    const password = req.body?.password;
    const role = normalizeRole(req.body?.role);
    if (
      role !== 'user' ||
      fullName.length < 2 ||
      !/^\+?[0-9]{8,15}$/.test(phone) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72 ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      await removeFiles(files);
      return respondError(
        res,
        400,
        'تحقق من الاسم ورقم الهاتف والبريد، واجعل كلمة المرور 8 أحرف على الأقل.',
      );
    }
    if (!req.file) return respondError(res, 400, 'أرفق صورة واضحة لجواز السفر لإنشاء الحساب.');
    let client;
    // بعد اعتماد إنشاء الحساب تبقى صورته محفوظة حتى لو تعذر إنشاء الجلسة؛ يمكن للمستخدم الدخول لاحقًا.
    let committed = false;
    try {
      // يُفحص الجواز قبل إنشاء الحساب، فلا يُحفظ مستخدم جديد بمرفق لا يمكن قراءته.
      await validateImage(req.file);
      const passwordHash = await bcrypt.hash(password, 12);
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (full_name, phone, email, password_hash) VALUES ($1,$2,$3,$4)
       RETURNING id, auth_version`,
        [fullName, phone.replace(/[\s-]/g, ''), email, passwordHash],
      );
      const userId = result.rows[0].id;
      await client.query(
        'INSERT INTO user_passports(user_id,storage_key,mime_type) VALUES($1,$2,$3)',
        [userId, 'private/passports/' + req.file.filename, req.file.mimetype],
      );
      // إنشاء الحساب وربط صورة الجواز يثبتان في قاعدة البيانات معًا قبل فتح جلسة الدخول.
      await client.query('COMMIT');
      committed = true;
      await sessionOperation(req, 'regenerate');
      req.session.userId = String(userId);
      req.session.authVersion = result.rows[0].auth_version;
      req.session.role = role;
      await sessionOperation(req, 'save');
      return res.status(201).json({ success: true, message: 'تم إنشاء الحساب.', role });
    } catch (error) {
      if (client && !committed) await client.query('ROLLBACK').catch(() => {});
      if (!committed) await removeFiles(files);
      if (error.code === '23505')
        return respondError(res, 409, 'رقم الهاتف أو البريد مسجل مسبقًا.');
      return next(error);
    } finally {
      client?.release();
    }
  });

  // قراءة الحساب الحالي وصلاحياته من قاعدة البيانات؛ يُبطل الجلسة إذا لم تعد صالحة.
  app.get('/api/me', async (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ success: false, authenticated: false });
    try {
      const result = await pool.query(
        `SELECT u.id, u.full_name, u.phone, u.email,u.can_list,u.can_bid,EXISTS(SELECT 1 FROM platform_settings p JOIN user_roles r ON r.user_id=u.id AND r.role='admin' WHERE p.id=1 AND p.primary_admin_id=u.id) AS is_primary_admin,EXISTS(SELECT 1 FROM user_passports p WHERE p.user_id=u.id) AS has_passport, ARRAY(SELECT role::text FROM user_roles WHERE user_id=u.id ORDER BY role) AS roles FROM users u
       WHERE u.id = $1 AND u.status = 'active' AND u.auth_version=$2 LIMIT 1`,
        [req.session.userId, req.session.authVersion || 1],
      );
      if (!result.rowCount || !result.rows[0].roles.length) {
        await sessionOperation(req, 'destroy').catch(() => {});
        res.clearCookie('mazad.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
        return res.status(401).json({ success: false, authenticated: false });
      }
      return res.json({
        success: true,
        authenticated: true,
        user: { ...result.rows[0], role: primaryRole(result.rows[0].roles) },
      });
    } catch (error) {
      next(error);
    }
  });

  // مسار توافق للواجهة القديمة؛ لا يمنح دورًا جديدًا بل يسمح فقط بالدور المسند فعليًا للحساب.
  app.post('/api/session/role', requireUser, async (req, res, next) => {
    if (!req.session.userId) return respondError(res, 401, 'سجّل الدخول للمتابعة.');
    res.setHeader('Deprecation', 'true');
    const role = normalizeRole(req.body?.role);
    if (!role) return respondError(res, 400, 'نوع الحساب غير صالح.');
    try {
      const allowed = await pool.query(
        "SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE u.id=$1 AND u.status='active' AND ur.role=$2",
        [req.session.userId, role],
      );
      if (!allowed.rowCount) return respondError(res, 403, 'الحساب لا يملك هذه الصلاحية.');
      req.session.role = role;
      await sessionOperation(req, 'save');
      res.json({ success: true, role });
    } catch (error) {
      next(error);
    }
  });

  // إزالة الجلسة من المخزن ومسح ملف ارتباطها في المتصفح.
  app.post('/api/logout', async (req, res, next) => {
    try {
      if (req.session) await sessionOperation(req, 'destroy');
      res.clearCookie('mazad.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
      return res.json({ success: true, message: 'تم تسجيل الخروج.' });
    } catch (error) {
      next(error);
    }
  });
};
