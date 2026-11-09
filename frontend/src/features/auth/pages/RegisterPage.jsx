/**
 * إنشاء حساب موحد مع صورة جواز إلزامية؛ يرسل البيانات والمرفق عبر multipart ثم يفتح الحساب.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Brand from '../../../components/Brand.jsx';
import ThemeSwitcher from '../../../components/ThemeSwitcher.jsx';
import { Notice } from '../../../components/Feedback.jsx';
import { api } from '../../../api.js';
import { useAuth } from '../AuthContext.jsx';
import { routes, safeReturnTo } from '../../../routes.js';

export default function RegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    password: '',
  });
  const [confirm, setConfirm] = useState('');
  const [passport, setPassport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  // يفحص تطابق كلمتي المرور ووجود الجواز، ثم يرسل النموذج والمرفق ويجدد جلسة المستخدم.
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.password !== confirm) return setError('كلمتا المرور غير متطابقتين.');
    if (!passport) return setError('أرفق صورة واضحة لجواز السفر.');
    setBusy(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append('passport_image', passport);
      await api('/api/register', { method: 'POST', body });
      await refresh();
      navigate(safeReturnTo(location.state?.returnTo, routes.account), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-side">
        <div className="auth-side-bg" />
        <Brand light />
        <div className="auth-promo">
          <h1>
            ابدأ رحلتك
            <br />
            مع <em>مزاد ليبيا.</em>
          </h1>
          <p>حساب واحد لعرض سياراتك والمزايدة على سيارات الآخرين.</p>
        </div>
      </div>
      <section className="auth-content">
        <ThemeSwitcher />
        <Link to={routes.home} className="back-link">
          الرئيسية
        </Link>
        <div className="auth-form-wrap">
          <h2>إنشاء حساب</h2>
          {error && <Notice>{error}</Notice>}
          <form className="form-stack" onSubmit={submit}>
            <label className="field-label">
              الاسم الكامل
              <input
                name="full_name"
                value={form.full_name}
                onChange={update}
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>
            <label className="field-label">
              رقم الهاتف
              <input
                name="phone"
                value={form.phone}
                onChange={update}
                type="tel"
                autoComplete="tel"
                maxLength={20}
                required
              />
            </label>
            <label className="field-label">
              البريد الإلكتروني (اختياري)
              <input
                name="email"
                value={form.email}
                onChange={update}
                type="email"
                autoComplete="email"
                maxLength={255}
              />
            </label>
            <label className="field-label">
              كلمة المرور (8 أحرف على الأقل)
              <input
                name="password"
                value={form.password}
                onChange={update}
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <label className="field-label">
              تأكيد كلمة المرور
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <label className="field-label">
              صورة جواز السفر *
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (
                    file &&
                    (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                      file.size > 5 * 1024 * 1024)
                  ) {
                    event.target.value = '';
                    setPassport(null);
                    setError('اختر صورة JPG أو PNG أو WebP لا تتجاوز 5MB.');
                    return;
                  }
                  setPassport(file || null);
                  setError('');
                }}
              />
              <small className="muted-note">
                صورة واضحة بحد أقصى 5MB. تحفظ بشكل خاص ولا يفتحها إلا المدير.
              </small>
            </label>
            <button className="button button-dark full-button" disabled={busy}>
              {busy ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}
            </button>
          </form>
          <p className="auth-bottom">
            لديك حساب؟{' '}
            <Link className="text-link" to={routes.login}>
              تسجيل الدخول
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
