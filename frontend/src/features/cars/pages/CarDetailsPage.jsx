/**
 * تفاصيل السيارة وصورها ومعلومات المزاد وأوراق الملكية المعتمدة المرتبطة به.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Gauge,
  MapPin,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, carName, money, statusLabels } from '../../../api.js';
import { EmptyState, Loading, Notice } from '../../../components/Feedback.jsx';
import OwnershipDocuments from '../../auctions/OwnershipDocuments.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import AdminDeleteListingButton from '../../admin/AdminDeleteListingButton.jsx';
import { routes } from '../../../routes.js';
import ActionLink from '../../../components/ActionLink.jsx';

const fallback =
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1400&q=85';

export default function CarDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [car, setCar] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  // يتكرر التحميل عند تغير معرّف السيارة، ويتجاهل الرد المتأخر الخاص بالصفحة السابقة.
  useEffect(() => {
    let alive = true;
    let pending = false;
    setState('loading');
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const data = await api(`/api/cars/${id}`);
        if (!alive) return;
        setCar(data.car || null);
        setState('ready');
      } catch (err) {
        if (!alive) return;
        setCar(null);
        setError(err.message);
        setState('error');
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [id]);

  if (state === 'loading')
    return (
      <main className="page-main">
        <Loading />
      </main>
    );
  if (state === 'error')
    return (
      <main className="page-main">
        <Notice>{error}</Notice>
      </main>
    );
  if (!car)
    return (
      <main className="page-main">
        <EmptyState
          title="السيارة غير متاحة"
          description="قد تكون أزيلت من المزاد أو لم تُعتمد بعد."
        />
        <Link className="text-link back-link" to="/">
          العودة إلى السيارات <ArrowRight size={16} />
        </Link>
      </main>
    );

  return (
    <main className="detail-page">
      <Link to="/" className="back-link">
        <ArrowRight size={17} /> العودة للسيارات
      </Link>
      {user?.roles.includes('admin') && car.status !== 'deleted' && (
        <section className="form-card" aria-label="إجراءات المدير على العرض">
          <h2>إجراءات المدير</h2>
          <div className="heading-actions">
            <AdminDeleteListingButton car={car} />
            <ActionLink className="button button-quiet" to={routes.adminListings}>
              السيارات والحذف
            </ActionLink>
          </div>
        </section>
      )}
      <div className="detail-layout">
        <div className="detail-main">
          <div className="detail-cover">
            <img src={car.image_url || fallback} alt={carName(car)} />
            <span className="auction-pill pill-active">
              <i />
              {statusLabels[car.auction_status] || 'معتمدة للمزاد'}
            </span>
          </div>
          <div className="detail-title-row">
            <div>
              <span className="section-kicker">تفاصيل المركبة</span>
              <h1>{carName(car)}</h1>
            </div>
            <span className="verified-chip">
              <BadgeCheck size={16} /> سيارة معتمدة
            </span>
          </div>
          <div className="spec-grid">
            <div>
              <CalendarDays />
              <small>سنة الصنع</small>
              <strong>{car.year || '—'}</strong>
            </div>
            <div>
              <Gauge />
              <small>المسافة المقطوعة</small>
              <strong>
                {car.mileage_km == null
                  ? 'غير محددة'
                  : `${new Intl.NumberFormat('ar-LY').format(car.mileage_km)} كم`}
              </strong>
            </div>
            <div>
              <MapPin />
              <small>الموقع</small>
              <strong>{car.location || 'ليبيا'}</strong>
            </div>
            <div>
              <ShieldCheck />
              <small>الحالة</small>
              <strong>
                {{ excellent: 'ممتازة', good: 'جيدة', fair: 'مقبولة', needs_repair: 'تحتاج صيانة' }[
                  car.condition
                ] || 'غير محددة'}
              </strong>
            </div>
          </div>
          {car.defects_notes && (
            <section className="detail-notes">
              <h2>ملاحظات البائع</h2>
              <p>{car.defects_notes}</p>
            </section>
          )}
          <div className="car-gallery">
            {car.images?.map((image) => (
              <a key={image.url} href={image.url} target="_blank" rel="noreferrer">
                <img src={image.url} alt={carName(car)} />
              </a>
            ))}
          </div>
          {car.auction_id && <OwnershipDocuments key={car.auction_id} auctionId={car.auction_id} />}
        </div>
        <aside className="auction-summary">
          <span className="section-kicker">معلومات المزاد</span>
          <h2>{statusLabels[car.auction_status] || 'بانتظار تحديد المزاد'}</h2>
          <div className="summary-price">
            <small>{car.current_price ? 'السعر الحالي' : 'السعر الابتدائي'}</small>
            <strong>{money(car.current_price || car.starting_price)}</strong>
          </div>
          <div className="summary-line">
            <span>
              <Zap size={16} /> عدد المزايدات
            </span>
            <strong>{car.bid_count || 0}</strong>
          </div>
          <div className="summary-line">
            <span>
              <Timer size={16} /> حالة المزاد
            </span>
            <strong>{statusLabels[car.auction_status] || 'لم يُحدد بعد'}</strong>
          </div>
          {car.auction_id ? (
            <ActionLink
              className="button button-dark full-button"
              to={`/auctions/${car.auction_id}`}
            >
              عرض المزاد والمزايدة
            </ActionLink>
          ) : (
            <p className="summary-hint">لم يتم تحديد موعد المزاد بعد.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
