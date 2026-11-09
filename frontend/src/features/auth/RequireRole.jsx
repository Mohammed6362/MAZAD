/**
 * حراسة صفحات الواجهة؛ تنتظر فحص الجلسة ثم تعيد الزائر للدخول أو تعرض سبب منع الوصول.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { Loading, Notice } from '../../components/Feedback.jsx';
import { loginPath } from '../../routes.js';
import { useAuth } from './AuthContext.jsx';

export default function RequireRole({ role, permission, children }) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <main className="page-main">
        <Loading label="نتحقق من جلسة الدخول…" />
      </main>
    );
  if (error)
    return (
      <main className="page-main">
        <Notice>{error}</Notice>
        <button className="button button-dark" onClick={() => refresh().catch(() => {})}>
          إعادة الاتصال
        </button>
      </main>
    );
  if (!user)
    return (
      <Navigate
        to={loginPath[role] || loginPath.user}
        state={{ returnTo: location.pathname }}
        replace
      />
    );
  // هذا منع تنقل لتحسين التجربة؛ حماية البيانات الفعلية تظل في requireRole داخل الخلفية.
  if (role && !user.roles.includes(role))
    return (
      <main className="page-main">
        <Notice>حسابك لا يملك صلاحية دخول هذه الصفحة.</Notice>
      </main>
    );
  if (permission && !user[permission])
    return (
      <main className="page-main">
        <Notice>هذه الصفحة متاحة للمدير الرئيسي فقط.</Notice>
      </main>
    );
  return children;
}
