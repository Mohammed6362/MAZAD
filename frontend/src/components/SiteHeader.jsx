/**
 * التنقل الرئيسي والقائمة على الهاتف؛ يظهر روابط الحساب والإدارة وفق الجلسة ويعالج تسجيل الخروج.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import Brand from './Brand.jsx';
import ActionLink from './ActionLink.jsx';
import ThemeSwitcher from './ThemeSwitcher.jsx';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { useNotifications } from '../features/account/NotificationsContext.jsx';
import { routes } from '../routes.js';
export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const { unread: adminUnread } = useNotifications('admin');
  const navigate = useNavigate();
  const close = () => setOpen(false);
  const member = user?.roles.includes('user');
  // ينهي جلسة الحساب ويغلق قائمة الهاتف وينقل المستخدم إلى الصفحة الرئيسية بعد النجاح.
  async function exit() {
    setError('');
    setBusy(true);
    try {
      await logout();
      close();
      navigate(routes.home);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <button
          className="mobile-menu-button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="القائمة"
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'main-nav nav-open' : 'main-nav'} aria-label="التنقل الرئيسي">
          <NavLink to={routes.home} end onClick={close}>
            الرئيسية
          </NavLink>
          <Link to="/#cars" onClick={close}>
            السيارات
          </Link>
          {user ? (
            <>
              {member && (
                <>
                  <ActionLink as={NavLink} to={routes.cars} onClick={close}>
                    سياراتي
                  </ActionLink>
                  <ActionLink as={NavLink} to={routes.bids} onClick={close}>
                    مزايداتي
                  </ActionLink>
                </>
              )}
              <ActionLink as={NavLink} to={routes.account} end onClick={close}>
                حسابي
              </ActionLink>
              <ActionLink as={NavLink} to={routes.wallet} onClick={close}>
                محفظتي
              </ActionLink>
              <ActionLink as={NavLink} to={routes.notifications} onClick={close}>
                الإشعارات{' '}
                {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
              </ActionLink>
              {user.roles.includes('admin') && (
                <ActionLink as={NavLink} to={routes.adminDashboard} onClick={close}>
                  الإدارة
                  {adminUnread > 0 && (
                    <span className="unread-badge">{adminUnread > 99 ? '99+' : adminUnread}</span>
                  )}
                </ActionLink>
              )}
            </>
          ) : (
            <>
              <ActionLink as={NavLink} to={routes.login} onClick={close}>
                تسجيل الدخول
              </ActionLink>
              <ActionLink to={routes.submitCar} onClick={close}>
                اعرض سيارتك
              </ActionLink>
            </>
          )}
        </nav>
        <div className="header-actions account-actions">
          <ThemeSwitcher />
          {user ? (
            <>
              {member && user.can_list !== false && (
                <ActionLink className="button button-dark" to={routes.submitCar} onClick={close}>
                  أضف سيارتك
                </ActionLink>
              )}
              <button className="button button-quiet" disabled={busy} onClick={exit}>
                خروج
              </button>
            </>
          ) : (
            <ActionLink className="button button-dark" to={routes.register}>
              إنشاء حساب
            </ActionLink>
          )}
        </div>
      </div>
      {error && (
        <p className="header-error" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
