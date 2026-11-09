/**
 * إحصائيات الإدارة وقوائم الحسابات وتعديل صلاحياتها وحالتها، وإلغاء المزادات المستقبلية دون عروض.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { requireRole, requirePrimaryAdmin } = require('../middleware/auth');
const { respondError } = require('../utils/http');

module.exports = function registerAdminUserRoutes(app) {
  // تجميع إحصائيات المهام والمبالغ والضمان ورسوم العرض لصفحة الإدارة الرئيسية.
  app.get('/api/admin/summary', requireRole('admin'), async (_req, res, next) => {
    try {
      const {
        rows: [summary],
      } = await pool.query(`SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM cars WHERE status='pending_review') AS pending_cars,
        (SELECT COUNT(*)::int FROM cars WHERE status='sold') AS sold_cars,
        (SELECT COUNT(*)::int FROM auctions WHERE status IN ('scheduled','active') AND start_time<=NOW() AND end_time>NOW()) AS active_auctions,
        (SELECT COUNT(*)::int FROM auctions WHERE status IN ('scheduled','active') AND end_time<=NOW()) AS ended_auctions,
        (SELECT COUNT(*)::int FROM invoices WHERE status='pending') AS pending_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE sale_status='disputed') AS disputed_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE sale_status IN ('awaiting_handover','handed_over')) AS awaiting_delivery,
        (SELECT COALESCE(SUM(amount),0) FROM invoice_escrows) AS escrow_total,
        (SELECT COALESCE(-SUM(amount),0) FROM wallet_transactions WHERE kind='listing_fee') AS listing_fee_total,
        (SELECT COALESCE(SUM(winning_amount),0) FROM invoices WHERE status='paid') AS paid_total`);
      res.json({ success: true, summary });
    } catch (error) {
      next(error);
    }
  });
  // قراءة الحسابات على صفحات محدودة مع الصلاحيات وحالة وجود الجواز، دون كلمة المرور أو مسار الصورة.
  app.get('/api/admin/users', requirePrimaryAdmin, async (req, res, next) => {
    try {
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
        return respondError(res, 400, 'رقم الصفحة غير صالح.');
      const { rows } = await pool.query(
        `SELECT u.id,u.full_name,u.phone,u.email,u.status,u.created_at,u.can_list,u.can_bid,EXISTS(SELECT 1 FROM platform_settings p WHERE p.id=1 AND p.primary_admin_id=u.id) AS is_primary_admin,EXISTS(SELECT 1 FROM user_passports p WHERE p.user_id=u.id) AS has_passport,
        ARRAY(SELECT role::text FROM user_roles WHERE user_id=u.id) AS roles
        FROM users u ORDER BY u.created_at DESC,u.id DESC LIMIT 101 OFFSET $1`,
        [(page - 1) * 100],
      );
      res.json({
        success: true,
        users: rows.slice(0, 100),
        next_page: rows.length > 100 ? page + 1 : null,
      });
    } catch (error) {
      next(error);
    }
  });
  // تغيير صلاحيات حساب آخر مع مراجعة صلاحية المنفذ داخل القفل، وإبطال الجلسات وحفظ سجل القرار.
  app.patch('/api/admin/users/:id/permissions', requirePrimaryAdmin, async (req, res, next) => {
    const { can_list, can_bid, admin } = req.body || {};
    if ([can_list, can_bid, admin].some((value) => typeof value !== 'boolean'))
      return respondError(res, 400, 'حدّد صلاحيات العرض والمزايدة والإدارة.');
    if (String(req.params.id) === String(req.session.userId))
      return respondError(res, 409, 'حساب المدير الرئيسي محمي من تعديل صلاحياته عبر هذه الصفحة.');
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Serialize role changes and recheck the actor after waiting for another admin.
      await client.query('SELECT pg_advisory_xact_lock(130013)');
      const {
        rows: [settings],
      } = await client.query(
        'SELECT primary_admin_id FROM platform_settings WHERE id=1 FOR UPDATE',
      );
      if (String(settings?.primary_admin_id) !== String(req.session.userId)) {
        await client.query('ROLLBACK');
        return respondError(res, 403, 'منح الصلاحيات متاح للمدير الرئيسي فقط.');
      }
      const actor = await client.query(
        "SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.id=$1 AND r.role='admin' AND u.status='active' AND u.auth_version=$2",
        [req.session.userId, req.session.authVersion || 1],
      );
      if (!actor.rowCount) {
        await client.query('ROLLBACK');
        return respondError(res, 403, 'تغيّرت صلاحياتك. سجّل الدخول مجددًا.');
      }
      const {
        rows: [user],
      } = await client.query(
        "SELECT u.id,u.status,u.can_list,u.can_bid,EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='admin') AS admin FROM users u WHERE u.id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!user) {
        await client.query('ROLLBACK');
        return respondError(res, 404, 'الحساب غير موجود.');
      }
      if (admin && !user.admin && user.status !== 'active') {
        await client.query('ROLLBACK');
        return respondError(res, 409, 'فعّل الحساب قبل منحه صلاحية الإدارة.');
      }
      if (user.admin && !admin) {
        const count = await client.query(
          "SELECT count(*)::int AS count FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='admin' AND u.status='active'",
        );
        if (count.rows[0].count <= 1) {
          await client.query('ROLLBACK');
          return respondError(res, 409, 'لا يمكن إزالة آخر مدير نشط.');
        }
      }
      // يسجل الفرق فقط عند تغير فعلي؛ إعادة حفظ الاختيارات نفسها لا تبطل الجلسات بلا داعٍ.
      const previous = { can_list: user.can_list, can_bid: user.can_bid, admin: user.admin };
      if (can_list !== user.can_list || can_bid !== user.can_bid || admin !== user.admin) {
        await client.query(
          'UPDATE users SET can_list=$2,can_bid=$3,auth_version=auth_version+1 WHERE id=$1',
          [user.id, can_list, can_bid],
        );
        if (admin)
          await client.query(
            "INSERT INTO user_roles(user_id,role) VALUES($1,'admin') ON CONFLICT DO NOTHING",
            [user.id],
          );
        else
          await client.query("DELETE FROM user_roles WHERE user_id=$1 AND role='admin'", [user.id]);
        await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [String(user.id)]);
        // سجل القرار جزء من معاملة الصلاحيات؛ يحفظ الفاعل والقيم السابقة والجديدة ولا يقبل التعديل لاحقًا.
        await client.query(
          'INSERT INTO user_permission_events(user_id,actor_id,previous_permissions,permissions) VALUES($1,$2,$3,$4)',
          [user.id, req.session.userId, previous, { can_list, can_bid, admin }],
        );
      }
      await client.query('COMMIT');
      res.json({
        success: true,
        message: 'حُفظت الصلاحيات. يلزم المستخدم تسجيل الدخول مجددًا عند تغييرها.',
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client?.release();
    }
  });
  // إيقاف مستخدم غير إداري أو إعادة تفعيله؛ الإيقاف يغير إصدار المصادقة وينهي جلساته.
  app.patch('/api/admin/users/:id/status', requirePrimaryAdmin, async (req, res, next) => {
    const status = req.body?.status;
    if (!['active', 'suspended'].includes(status))
      return respondError(res, 400, 'حالة الحساب غير صالحة.');
    if (String(req.params.id) === String(req.session.userId))
      return respondError(res, 409, 'لا يمكن إيقاف حسابك من هذه الصفحة.');
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const {
        rows: [user],
      } = await client.query('SELECT id,status FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!user) {
        await client.query('ROLLBACK');
        return respondError(res, 404, 'الحساب غير موجود.');
      }
      const admin = await client.query(
        "SELECT 1 FROM user_roles WHERE user_id=$1 AND role='admin'",
        [user.id],
      );
      if (admin.rowCount) {
        await client.query('ROLLBACK');
        return respondError(res, 409, 'حسابات الإدارة محمية من الإيقاف عبر هذه الصفحة.');
      }
      if (user.status !== status) {
        await client.query('UPDATE users SET status=$2,auth_version=auth_version+1 WHERE id=$1', [
          user.id,
          status,
        ]);
        await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [String(user.id)]);
      }
      await client.query('COMMIT');
      res.json({
        success: true,
        message: status === 'active' ? 'تم تفعيل الحساب.' : 'تم إيقاف الحساب وإنهاء جلساته.',
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      next(error);
    } finally {
      client?.release();
    }
  });
  // إلغاء موعد مستقبلي لم يبدأ ولم يقبل عروضًا، مع إشعار العارض وإتاحة جدولة جديدة.
  app.post('/api/admin/auctions/:id/cancel', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `WITH cancelled AS (
        UPDATE auctions SET status='cancelled' WHERE id=$1 AND status='scheduled' AND start_time>NOW() AND bid_count=0 RETURNING id,car_id
      ), notified AS (
        INSERT INTO notifications(user_id,title,body,link)
        SELECT c.seller_id,'تم إلغاء موعد المزاد','ألغت الإدارة المزاد قبل بدايته. يمكن جدولة موعد جديد.','/seller/cars'
        FROM cancelled a JOIN cars c ON c.id=a.car_id RETURNING id
      ) SELECT id FROM cancelled`,
        [req.params.id],
      );
      if (!result.rowCount)
        return respondError(res, 409, 'يمكن إلغاء مزاد مجدول لم يبدأ ولم تصله مزايدات فقط.');
      res.json({ success: true, message: 'تم إلغاء موعد المزاد. السيارة متاحة لجدولة موعد جديد.' });
    } catch (error) {
      next(error);
    }
  });
};
