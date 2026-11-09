/**
 * مدخل وظائف الحساب الموحد؛ يعرض روابط السيارات والمزايدات والمحفظة والفواتير والإعدادات والإدارة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { routes } from '../../routes.js';
import ActionLink from '../../components/ActionLink.jsx';
export default function AccountPage() {
  const { user } = useAuth();
  const links = [
    ...(user.roles.includes('user')
      ? [
          ['سياراتي', 'تابع السيارات التي عرضتها وحالة مراجعتها.', routes.cars],
          ...(user.can_list !== false
            ? [
                [
                  'أضف سيارتك',
                  'أرفق صور السيارة وبياناتها، وأوراق الملكية اختياريًا لاعتماد المدير.',
                  routes.submitCar,
                ],
              ]
            : []),
          ['مزايداتي', 'تابع عروضك ونتائج المزادات التي شاركت فيها.', routes.bids],
          [
            'محفظتي التجريبية',
            'رصيد بالدينار الليبي للشحن والمزايدة وسداد الفواتير.',
            routes.wallet,
          ],
        ]
      : []),
    ['فواتيري', 'السداد والتسليم وتأكيد الاستلام ومتابعة الاعتراضات.', routes.invoices],
    ['الإشعارات', 'تحديثات طلباتك ومزايداتك ونتائجها.', routes.notifications],
    ['إعدادات الحساب', 'حدّث بياناتك وكلمة المرور.', routes.settings],
    ...(user.roles.includes('admin')
      ? [['لوحة الإدارة', 'مراجعة الطلبات وإدارة المزادات والمستخدمين.', routes.adminDashboard]]
      : []),
  ];
  return (
    <main className="page-main">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">حسابك في مزاد ليبيا</span>
          <h1>مرحبًا، {user.full_name}</h1>
          <p>اعرض سياراتك وشارك في مزادات السيارات من حساب واحد.</p>
        </div>
        <Link className="button button-quiet" to="/#cars">
          تصفح السيارات
        </Link>
      </div>
      <div className="stats-grid">
        {links.map(([title, description, to]) => (
          <ActionLink className="record-card account-card" key={to} to={to}>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="text-link">فتح الصفحة ←</span>
          </ActionLink>
        ))}
      </div>
    </main>
  );
}
