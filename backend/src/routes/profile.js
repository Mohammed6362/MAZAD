/**
 * تعديل الملف وكلمة المرور وإدارة الإشعارات؛ يطلب كلمة المرور الحالية لتغيير بيانات التواصل.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireUser, requireRole, loginRateLimit } = require('../middleware/auth');
const { respondError, trimField, sessionOperation } = require('../utils/http');

module.exports = function registerProfileRoutes(app) {
  // تحديث الملف بعد تنظيف البيانات؛ تعديل الهاتف أو البريد يحتاج كلمة المرور الحالية.
  app.patch('/api/account/profile', requireUser, async (req, res, next) => {
    const name = trimField(req.body?.full_name, 120);
    const phone = trimField(req.body?.phone, 20).replace(/[\s-]/g, '');
    const email = trimField(req.body?.email, 255).toLowerCase() || null;
    if (
      name.length < 2 ||
      !/^\+?\d{8,15}$/.test(phone) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      return respondError(res, 400, 'تحقق من الاسم والهاتف والبريد الإلكتروني.');
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const {
        rows: [user],
      } = await client.query('SELECT phone,email,password_hash FROM users WHERE id=$1 FOR UPDATE', [
        req.session.userId,
      ]);
      const changed = phone !== user.phone || email !== (user.email?.toLowerCase() || null);
      if (
        changed &&
        !(
          typeof req.body?.current_password === 'string' &&
          (await bcrypt.compare(req.body.current_password, user.password_hash))
        )
      ) {
        await client.query('ROLLBACK');
        return respondError(res, 400, 'أدخل كلمة المرور الحالية لتعديل بيانات التواصل.');
      }
      await client.query(
        'UPDATE users SET full_name=$2,phone=$3::text,email=$4,is_verified=CASE WHEN phone<>$3::text THEN FALSE ELSE is_verified END WHERE id=$1',
        [req.session.userId, name, phone, email],
      );
      await client.query('COMMIT');
      res.json({ success: true, message: 'تم تحديث بيانات الحساب.' });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      if (error.code === '23505')
        return respondError(res, 409, 'الهاتف أو البريد مسجّل لحساب آخر.');
      next(error);
    } finally {
      client?.release();
    }
  });

  // تغيير كلمة المرور بعد التحقق من الحالية ثم إبطال الجلسات القديمة وتجديد جلسة الطلب.
  app.post('/api/account/password', requireUser, loginRateLimit, async (req, res, next) => {
    const password = req.body?.new_password;
    const current = req.body?.current_password;
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72 ||
      typeof current !== 'string'
    )
      return respondError(
        res,
        400,
        'أدخل كلمة المرور الحالية وكلمة جديدة من 8 أحرف على الأقل وبحد أقصى 72 بايت.',
      );
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const {
        rows: [user],
      } = await client.query(
        'SELECT password_hash,auth_version FROM users WHERE id=$1 FOR UPDATE',
        [req.session.userId],
      );
      if (!(await bcrypt.compare(current, user.password_hash))) {
        await client.query('ROLLBACK');
        return respondError(res, 400, 'كلمة المرور الحالية غير صحيحة.');
      }
      const hash = await bcrypt.hash(password, 12);
      const {
        rows: [updated],
      } = await client.query(
        'UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1 RETURNING auth_version',
        [req.session.userId, hash],
      );
      await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [
        String(req.session.userId),
      ]);
      await client.query('COMMIT');
      const userId = req.session.userId;
      const role = req.session.role;
      await sessionOperation(req, 'regenerate');
      Object.assign(req.session, { userId, role, authVersion: updated.auth_version });
      await sessionOperation(req, 'save');
      res.json({ success: true, message: 'تم تغيير كلمة المرور وإنهاء جلسات الدخول الأخرى.' });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      next(error);
    } finally {
      client?.release();
    }
  });

  // آخر إشعارات الحساب وعدد غير المقروء مع منع الاطلاع على إشعارات مستخدم آخر.
  function notificationAudience(req) {
    return /^\/api\/admin\//i.test(req.path) ? 'admin' : 'user';
  }
  const notificationPaths = ['/api/notifications', '/api/admin/notifications'];
  const notificationAccess = (req, res, next) =>
    (notificationAudience(req) === 'admin' ? requireRole('admin') : requireUser)(req, res, next);
  app.get(notificationPaths, notificationAccess, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id,title,body,link,created_at,read_at FROM notifications WHERE user_id=$1 AND audience=$2 ORDER BY created_at DESC,id DESC LIMIT 100',
        [req.session.userId, notificationAudience(req)],
      );
      const {
        rows: [count],
      } = await pool.query(
        'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id=$1 AND audience=$2 AND read_at IS NULL',
        [req.session.userId, notificationAudience(req)],
      );
      res.json({ success: true, notifications: rows, unread: count.unread });
    } catch (error) {
      next(error);
    }
  });
  // تعليم جميع إشعارات الحساب الحالي كمقروءة.
  app.post(
    notificationPaths.map((path) => path + '/read'),
    notificationAccess,
    async (req, res, next) => {
      try {
        await pool.query(
          'UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND audience=$2 AND read_at IS NULL',
          [req.session.userId, notificationAudience(req)],
        );
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    },
  );
  // تعليم إشعار محدد فقط إذا كان مملوكًا لصاحب الجلسة.
  app.post(
    notificationPaths.map((path) => path + '/:id/read'),
    notificationAccess,
    async (req, res, next) => {
      try {
        const result = await pool.query(
          'UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1 AND id=$2 AND audience=$3 RETURNING id',
          [req.session.userId, req.params.id, notificationAudience(req)],
        );
        if (!result.rowCount) return respondError(res, 404, 'الإشعار غير موجود.');
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    },
  );
};
