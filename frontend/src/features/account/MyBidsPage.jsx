/**
 * المزادات التي شارك فيها الحساب؛ يوضح موقع العرض والفوز وحالة الفاتورة بعد الإغلاق.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionLink from '../../components/ActionLink.jsx';
import { api, carName, dateTime, money } from '../../api.js';
import { EmptyState, Loading, Notice } from '../../components/Feedback.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { routes } from '../../routes.js';
import { saleLabels } from './saleLabels.js';
export default function MyBidsPage() {
  const [bids, setBids] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const load = useCallback(async () => {
    const data = await api('/api/account/bids');
    setBids(data.bids);
    setError('');
  }, []);
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);
  return (
    <main className="page-main">
      <div className="dashboard-heading">
        <div>
          <h1>مزايداتي</h1>
          <p>تابع عروضك ونتائج المزادات.</p>
        </div>
        <button
          className="button button-quiet"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          تحديث
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <Loading />
      ) : bids.length ? (
        <div className="record-list">
          {bids.map((bid) => {
            const won = String(bid.winner_id) === String(user.id);
            const ended = new Date(bid.end_time) <= new Date();
            const label = won
              ? bid.sale_status === 'expired'
                ? 'أُلغي الفوز لانتهاء مهلة السداد'
                : saleLabels[bid.sale_status] || 'فزت بالمزاد'
              : bid.status === 'closed'
                ? 'المزاد مغلق'
                : ended
                  ? 'بانتظار النتيجة'
                  : bid.leading
                    ? 'عرضك الأعلى حاليًا'
                    : 'يوجد عرض أعلى';
            return (
              <article className="record-card" key={bid.auction_id}>
                <div className="record-heading">
                  <h2>{carName(bid)}</h2>
                  <span className="status-tag">{label}</span>
                </div>
                <p>أعلى عرض لك: {money(bid.my_amount)}</p>
                <p>السعر الحالي: {money(bid.current_price)}</p>
                <p>ينتهي: {dateTime(bid.end_time)}</p>
                <div className="heading-actions">
                  {bid.car_status === 'deleted' && (
                    <p className="muted-note">حذفت الإدارة عرض السيارة.</p>
                  )}
                  {bid.car_status !== 'deleted' &&
                    (bid.car_status !== 'sold' || won || user.roles.includes('admin')) && (
                      <ActionLink
                        to={routes.auction(bid.auction_id)}
                        className="button button-dark"
                      >
                        {bid.car_status === 'sold' ? 'سجل المزاد المباع' : 'عرض المزاد'}
                      </ActionLink>
                    )}
                  {won && (
                    <ActionLink to={routes.invoices} className="button button-quiet">
                      متابعة معاملة الفوز
                    </ActionLink>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        !error && (
          <EmptyState
            title="لم تشارك في مزاد بعد"
            description="تصفح السيارات وافتح المزاد لتقديم عرضك."
          />
        )
      )}
      <Link to="/#cars" className="text-link back-link">
        تصفح السيارات
      </Link>
    </main>
  );
}
