/**
 * نموذج الدخول للحساب أو للإدارة؛ يحفظ وجهة العودة ويزامن بيانات الجلسة بعد نجاح الدخول.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Brand from '../../../components/Brand.jsx';
import ThemeSwitcher from '../../../components/ThemeSwitcher.jsx';
import { Notice } from '../../../components/Feedback.jsx';
import { useAuth } from '../AuthContext.jsx';
import { routes, safeReturnTo } from '../../../routes.js';

export default function LoginPage() {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  function destinationFor(account) {
    const admin = account?.roles.includes('admin');
    const destination = safeReturnTo(
      location.state?.returnTo,
      admin ? routes.adminDashboard : routes.account,
    );
    return !admin && destination.startsWith('/admin') ? routes.account : destination;
  }
  // يرسل الهوية وكلمة المرور؛ تحدد صلاحيات الحساب الفعلية وجهته بعد الدخول.
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const account = await login({ phone: identity, password });
      navigate(destinationFor(account), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يتابع إلى الوجهة المناسبة للحساب الذي يملك جلسة حالية بعد مزامنتها.
  async function resume() {
    setBusy(true);
    setError('');
    try {
      navigate(destinationFor(user), { replace: true });
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
          <span className="eyebrow">مزاد ليبيا</span>
          <h1>
            كل خطواتك
            <br />
            في مكان <em>واحد.</em>
          </h1>
          <p>اعرض سيارتك، تابع المزادات، وأكمل معاملاتك من حسابك.</p>
        </div>
      </div>
      <section className="auth-content">
        <ThemeSwitcher />
        <Link className="back-link" to={routes.home}>
          العودة للرئيسية
        </Link>
        <div className="auth-form-wrap">
          <span className="section-kicker">مرحبًا بعودتك</span>
          <h2>تسجيل الدخول</h2>
          {error && <Notice>{error}</Notice>}
          {user && (
            <button
              type="button"
              className="button button-quiet full-button"
              disabled={busy}
              onClick={resume}
            >
              المتابعة بحساب {user.full_name}
            </button>
          )}
          <form className="form-stack" onSubmit={submit}>
            <label className="field-label">
              الهاتف أو البريد الإلكتروني
              <input
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field-label">
              كلمة المرور
              <input
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              إظهار كلمة المرور
            </label>
            <button className="button button-dark full-button" disabled={busy}>
              {busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
            </button>
          </form>
          {!user && (
            <p className="auth-bottom">
              ليس لديك حساب؟{' '}
              <Link
                to={routes.register}
                state={{ returnTo: destinationFor(null) }}
                className="text-link"
              >
                إنشاء حساب
              </Link>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
