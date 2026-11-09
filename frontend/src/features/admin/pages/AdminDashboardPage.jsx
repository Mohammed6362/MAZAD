/**
 * ملخص مهام الإدارة والمبالغ؛ الطلبات والمزادات والفواتير والاعتراضات والضمان ورسوم العرض المحصلة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect, useState } from 'react';
import ActionLink from '../../../components/ActionLink.jsx';
import { api, money } from '../../../api.js';
import { Loading, Notice } from '../../../components/Feedback.jsx';
import { routes } from '../../../routes.js';
import { useAuth } from '../../auth/AuthContext.jsx';
export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/admin/summary')
      .then((data) => setSummary(data.summary))
      .catch((err) => setError(err.message));
  }, []);
  if (error) return <Notice>{error}</Notice>;
  if (!summary) return <Loading />;
  const cards = [
    ['طلبات تحتاج مراجعة', summary.pending_cars, routes.adminReview],
    ['مزادات نشطة', summary.active_auctions, routes.adminAuctions],
    ['مزادات انتهت وتحتاج إغلاقًا', summary.ended_auctions, routes.adminAuctions],
    ['فواتير بانتظار السداد', summary.pending_invoices, routes.adminInvoices],
    ['اعتراضات تحتاج معالجة', summary.disputed_invoices, routes.adminInvoices],
    ['معاملات بانتظار التسليم والاستلام', summary.awaiting_delivery, routes.adminInvoices],
    ...(user.is_primary_admin ? [['الحسابات والصلاحيات', summary.users, routes.adminUsers]] : []),
    ['سيارات فاز بها مزايدون', summary.sold_cars, routes.adminInvoices],
  ];
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">إدارة مزاد ليبيا</span>
          <h1>ملخص المنصة</h1>
          <p>تابع الطلبات والمهام التي تحتاج إجراءً.</p>
        </div>
        <ActionLink className="button button-quiet" to={routes.adminListings}>
          السيارات والحذف
        </ActionLink>
      </div>
      <div className="stats-grid">
        {cards.map(([label, value, to]) => (
          <ActionLink className="record-card stat-card" key={label} to={to}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>عرض التفاصيل ←</small>
          </ActionLink>
        ))}
      </div>
      <section className="form-card">
        <h2>قيمة الفواتير المسددة</h2>
        <strong className="stat-total">{money(summary.paid_total)}</strong>
        <p className="muted-note">
          مجموع الفواتير المسددة، بما فيها السداد التجريبي. لا يمثل إيرادًا مصرفيًا.
        </p>
        <p>
          ضمان المعاملات التجريبي المحفوظ: <strong>{money(summary.escrow_total)}</strong>
        </p>
        <p>
          إجمالي رسوم عرض السيارات المحصلة: <strong>{money(summary.listing_fee_total)}</strong>
        </p>
      </section>
    </>
  );
}
