/**
 * تعديل الاسم وبيانات التواصل وكلمة المرور، وعرض صلاحيات الحساب وحالة إرفاق الجواز دون تعديلها.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useState } from 'react';
import { api } from '../../api.js';
import { Notice } from '../../components/Feedback.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
    full_name: user.full_name,
    phone: user.phone,
    email: user.email || '',
    current_password: '',
  });
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  // يحفظ الملف الشخصي مع كلمة المرور الحالية عند تغيير التواصل ثم يعيد جلب بيانات الحساب.
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await api('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      await refresh();
      setForm({ ...form, current_password: '' });
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يفحص التطابق ويرسل كلمة المرور الحالية والجديدة؛ الخادم يبطل الجلسات الأخرى ويجدد الحالية.
  async function changePassword(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (password.new_password !== password.confirm) return setError('كلمتا المرور غير متطابقتين.');
    setBusy(true);
    try {
      const data = await api('/api/account/password', {
        method: 'POST',
        body: JSON.stringify(password),
      });
      await refresh();
      setPassword({ current_password: '', new_password: '', confirm: '' });
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-main">
      <div className="dashboard-heading">
        <div>
          <h1>إعدادات الحساب</h1>
          <p>تحديث بياناتك وتأمين حسابك.</p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      <section className="wallet-bid-note" aria-label="صلاحيات حسابك">
        <h2>صلاحيات حسابك</h2>
        <p>
          عرض وتعديل السيارات: {user.can_list ? 'مسموح' : 'غير مسموح'} · المزايدة:{' '}
          {user.can_bid ? 'مسموح' : 'غير مسموح'}
          {user.roles.includes('admin') && (
            <> · {user.is_primary_admin ? 'المدير الرئيسي' : 'مساعد إداري'}</>
          )}
        </p>
        <p>
          يحدد المدير الرئيسي هذه الصلاحيات. جواز السفر:{' '}
          {user.has_passport ? 'محفوظ بشكل خاص' : 'غير مرفق (حساب سابق)'}.
        </p>
      </section>
      <div className="settings-grid">
        <section className="form-card">
          <h2>البيانات الشخصية</h2>
          <form className="form-stack" onSubmit={save}>
            <label className="field-label">
              الاسم الكامل
              <input
                name="full_name"
                value={form.full_name}
                onChange={update}
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label className="field-label">
              رقم الهاتف
              <input
                name="phone"
                value={form.phone}
                onChange={update}
                required
                type="tel"
                autoComplete="tel"
              />
            </label>
            <label className="field-label">
              البريد الإلكتروني
              <input
                name="email"
                value={form.email}
                onChange={update}
                type="email"
                autoComplete="email"
              />
            </label>
            <label className="field-label">
              كلمة المرور الحالية لتعديل الهاتف أو البريد
              <input
                name="current_password"
                value={form.current_password}
                onChange={update}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <button className="button button-dark" disabled={busy}>
              حفظ البيانات
            </button>
          </form>
        </section>
        <section className="form-card">
          <h2>تغيير كلمة المرور</h2>
          <p className="muted-note">تغييرها ينهي جلسات الدخول الأخرى.</p>
          <form className="form-stack" onSubmit={changePassword}>
            <label className="field-label">
              كلمة المرور الحالية
              <input
                type="password"
                value={password.current_password}
                onChange={(e) => setPassword({ ...password, current_password: e.target.value })}
                required
                autoComplete="current-password"
              />
            </label>
            <label className="field-label">
              كلمة المرور الجديدة
              <input
                type="password"
                value={password.new_password}
                onChange={(e) => setPassword({ ...password, new_password: e.target.value })}
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
            <label className="field-label">
              تأكيد الكلمة الجديدة
              <input
                type="password"
                value={password.confirm}
                onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
                required
                autoComplete="new-password"
              />
            </label>
            <button className="button button-dark" disabled={busy}>
              تغيير كلمة المرور
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
