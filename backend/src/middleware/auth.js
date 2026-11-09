/**
 * فحص الجلسة والأدوار وصلاحيات العرض والمزايدة من قاعدة البيانات، وحد محاولات الدخول والتسجيل.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { isProduction } = require('../config');
const { respondError, sessionOperation } = require('../utils/http');
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
// يعد محاولات عنوان الاتصال ضمن نافذة زمنية؛ عند تجاوز الحد يرجع 429 ومدة الانتظار.
function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    attempt = { count: 0, resetAt: now + loginWindowMs };
    loginAttempts.set(key, attempt);
  }
  if (attempt.count >= 10) {
    res.setHeader('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
    return res.status(429).json({ success: false, message: 'محاولات كثيرة. حاول بعد قليل.' });
  }
  attempt.count += 1;
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of loginAttempts) if (item.resetAt <= now) loginAttempts.delete(key);
}, loginWindowMs).unref();

// ينشئ حارسًا يفحص نشاط الحساب وإصدار الجلسة والدور والصلاحية المطلوبة قبل تنفيذ المسار.
function requireRole(role, permission) {
  return async (req, res, next) => {
    if (!req.session.userId) return respondError(res, 401, 'سجّل الدخول للمتابعة.');
    try {
      const result = await pool.query(
        `SELECT u.status,u.auth_version,u.can_list,u.can_bid,EXISTS(SELECT 1 FROM platform_settings p WHERE p.id=1 AND p.primary_admin_id=u.id) AS is_primary_admin,ARRAY(SELECT role::text FROM user_roles WHERE user_id=u.id) AS roles FROM users u WHERE u.id=$1`,
        [req.session.userId],
      );
      const user = result.rows[0];
      if (
        !user ||
        user.status !== 'active' ||
        user.auth_version !== (req.session.authVersion || 1) ||
        !user.roles.length
      ) {
        await sessionOperation(req, 'destroy').catch(() => {});
        res.clearCookie('mazad.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
        return respondError(res, 401, 'انتهت الجلسة أو تغيرت صلاحيات الحساب. سجّل الدخول مجددًا.');
      }
      if (role && !user.roles.includes(role))
        return respondError(res, 403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
      if (permission && !user[permission])
        return respondError(
          res,
          403,
          permission === 'is_primary_admin'
            ? 'منح الصلاحيات وإدارة الحسابات متاحان للمدير الرئيسي فقط.'
            : permission === 'can_list'
              ? 'أوقفت الإدارة صلاحية عرض السيارات لهذا الحساب.'
              : 'أوقفت الإدارة صلاحية المزايدة لهذا الحساب.',
        );
      req.auth = {
        id: req.session.userId,
        roles: user.roles,
        is_primary_admin: user.is_primary_admin,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  requireRole,
  requireUser: requireRole(),
  requirePrimaryAdmin: requireRole('admin', 'is_primary_admin'),
  loginRateLimit,
  loginAttempts,
};
