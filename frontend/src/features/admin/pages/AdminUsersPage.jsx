/**
 * إدارة الحسابات على صفحات؛ البحث في المحمل وفتح الجواز الخاص وحفظ الصلاحيات وإيقاف الحساب أو تفعيله.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect, useState } from 'react';
import { api, dateTime } from '../../../api.js';
import { Loading, Notice, EmptyState } from '../../../components/Feedback.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

// نموذج مستقل لكل حساب؛ يجهز صلاحيات العرض والمزايدة والإدارة ويمنع تعديل المدير لحسابه من نفسه.
function UserPermissions({ user, self, busy, save }) {
  const [permissions, setPermissions] = useState({
    can_list: user.can_list,
    can_bid: user.can_bid,
    admin: user.roles.includes('admin'),
  });
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        save(user, permissions);
      }}
    >
      <fieldset disabled={busy || self} className="permission-fields">
        <legend>صلاحيات الحساب</legend>
        {[
          ['can_list', 'عرض وتعديل السيارات'],
          ['can_bid', 'المزايدة'],
          ['admin', 'مساعد إداري (دون منح الصلاحيات)'],
        ].map(([key, label]) => (
          <label className="checkbox-label" key={key}>
            <input
              type="checkbox"
              checked={permissions[key]}
              onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <button className="button button-quiet" disabled={busy || self}>
        حفظ الصلاحيات
      </button>
      {self && <small>هذا حساب المدير الرئيسي؛ صلاحياته محمية من التعديل والإيقاف.</small>}
    </form>
  );
}
export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [nextPage, setNextPage] = useState(null);
  // يجلب صفحة حسابات؛ يستبدل القائمة عند الصفحة الأولى أو يلحق صفحة أخرى عند تحميل المزيد.
  async function load(page = 1) {
    const data = await api('/api/admin/users?page=' + page);
    setUsers((current) => (page === 1 ? data.users : [...current, ...data.users]));
    setNextPage(data.next_page);
  }
  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  // يحفظ اختيارات الصلاحيات في الخلفية ثم يعيد قراءة الحسابات بدل الاكتفاء بتغيير محلي.
  async function savePermissions(user, permissions) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/admin/users/${user.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify(permissions),
      });
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يطلب تأكيد إيقاف الحساب أو إعادة تفعيله ثم ينفذ القرار ويجدد القائمة.
  async function toggle(user) {
    const status = user.status === 'active' ? 'suspended' : 'active';
    if (
      !window.confirm(
        status === 'suspended'
          ? 'هل تريد إيقاف هذا الحساب وإنهاء جلساته؟'
          : 'هل تريد إعادة تفعيل الحساب؟',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const visible = users.filter((user) =>
    [user.full_name, user.phone, user.email].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>الحسابات والصلاحيات</h1>
          <p>
            المدير الرئيسي وحده يمنح ويسحب صلاحيات العرض والمزايدة والمساعدة الإدارية. المساعدون لا
            يمنحون الصلاحيات. تغيير الصلاحيات ينهي جلسات الحساب.
          </p>
        </div>
      </div>
      <label className="field-label">
        بحث ضمن الحسابات المحملة بالاسم أو الهاتف أو البريد
        <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" />
      </label>
      {error && <Notice>{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      {loading ? (
        <Loading />
      ) : (
        <div className="record-list">
          {visible.map((user) => (
            <article className="record-card" key={user.id}>
              <div className="record-heading">
                <h2>{user.full_name}</h2>
                <span className="status-tag">{user.status === 'active' ? 'نشط' : 'موقوف'}</span>
              </div>
              <p>
                {user.phone} · {user.email || 'بدون بريد'}
              </p>
              <p>
                نوع الحساب:{' '}
                {user.is_primary_admin
                  ? 'المدير الرئيسي'
                  : user.roles.includes('admin')
                    ? 'مساعد إداري'
                    : 'حساب عادي'}
              </p>
              <p>تاريخ التسجيل: {dateTime(user.created_at)}</p>
              <p>
                جواز السفر:{' '}
                {user.has_passport ? (
                  <a
                    className="text-link"
                    href={`/api/admin/users/${user.id}/passport`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    فتح الصورة الخاصة
                  </a>
                ) : (
                  'غير مرفق (حساب سابق)'
                )}
              </p>
              <UserPermissions
                key={`${user.id}-${user.can_list}-${user.can_bid}-${user.roles.join(',')}`}
                user={user}
                self={String(user.id) === String(currentUser.id)}
                busy={busy}
                save={savePermissions}
              />
              {!user.roles.includes('admin') && (
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() => toggle(user)}
                >
                  {user.status === 'active' ? 'إيقاف الحساب' : 'إعادة التفعيل'}
                </button>
              )}
            </article>
          ))}
          {!visible.length && !error && (
            <EmptyState title="لا توجد نتائج" description="جرّب اسمًا أو رقمًا مختلفًا." />
          )}
          {nextPage && (
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => load(nextPage).catch((err) => setError(err.message))}
            >
              تحميل المزيد من الحسابات
            </button>
          )}
        </div>
      )}
    </>
  );
}
