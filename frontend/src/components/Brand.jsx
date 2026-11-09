/**
 * شعار مزاد ليبيا ورابط الصفحة الرئيسية؛ يدعم العرض فوق الخلفيات الفاتحة والداكنة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Link } from 'react-router-dom';

export default function Brand({ light = false }) {
  return (
    <Link
      className={`brand ${light ? 'brand-light' : ''}`}
      to="/"
      aria-label="مزاد ليبيا، الرئيسية"
    >
      <span className="brand-mark">م</span>
      <span className="brand-name">
        مزاد ليبيا<span>سوق السيارات الليبي</span>
      </span>
    </Link>
  );
}
