/**
 * الإطار المشترك لصفحات الإدارة وروابطها؛ حراسة صلاحية الدخول موجودة في الموجّه والخلفية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { NavLink } from 'react-router-dom';
import ActionLink from '../components/ActionLink.jsx';
import { routes } from '../routes.js';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { useNotifications } from '../features/account/NotificationsContext.jsx';
export default function AdminLayout({ children }) {
  const { user } = useAuth();
  const { unread } = useNotifications('admin');
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <h2>لوحة الإدارة</h2>
        <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminNotifications}>
          إشعارات الإدارة{' '}
          {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
        </ActionLink>
        <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminDashboard}>
          الملخص
        </ActionLink>
        <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminReview}>
          مراجعة السيارات
        </ActionLink>
        <ActionLink className="admin-sidebar-link" to={routes.adminListings}>
          السيارات والحذف
        </ActionLink>
        <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminAuctions}>
          إدارة المزادات
        </ActionLink>
        <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminInvoices}>
          فواتير المزادات
        </ActionLink>
        {user.is_primary_admin && (
          <ActionLink as={NavLink} className="admin-sidebar-link" to={routes.adminUsers}>
            الحسابات والصلاحيات
          </ActionLink>
        )}
      </aside>
      <main className="admin-content">{children}</main>
    </div>
  );
}
