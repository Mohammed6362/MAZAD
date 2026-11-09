/**
 * تذييل الموقع؛ يجمع روابط الحساب والمساعدة وقواعد المزاد ومعلومات المنصة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import ActionLink from './ActionLink.jsx';
import { Globe2, MapPin, Phone } from 'lucide-react';
import Brand from './Brand.jsx';
import { routes } from '../routes.js';
import { useAuth } from '../features/auth/AuthContext.jsx';

export default function Footer() {
  const { user } = useAuth();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <Brand />
          <p>منصة تجمع البائعين والمشترين في تجربة مزاد أوضح وأسهل.</p>
        </div>
        <div className="footer-links">
          <strong>روابط سريعة</strong>
          <ActionLink to={routes.auctionRules}>آلية المزاد والمحفظة</ActionLink>
          <a href="/#cars">تصفح السيارات</a>
          <ActionLink to="/account/cars/new">أضف سيارتك</ActionLink>
          <ActionLink to="/account/bids">مزايداتي</ActionLink>
          {user?.roles.includes('admin') && (
            <ActionLink to={routes.adminDashboard}>لوحة الإدارة</ActionLink>
          )}
        </div>
        <div className="footer-links">
          <strong>تواصل معنا</strong>
          <span>
            <MapPin size={15} /> ليبيا
          </span>
          <span>
            <Phone size={15} /> دعم العملاء
          </span>
          <span>
            <Globe2 size={15} /> مزاد ليبيا
          </span>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 مزاد ليبيا</span>
        <span>صُنع بعناية في ليبيا</span>
      </div>
    </footer>
  );
}
