/**
 * طلبات سيارات المستخدم وحالتها؛ يظهر التعديل قبل وجود مزاد مفتوح والرسوم المسددة وروابط المزادات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { ArrowRight, CarFront, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import ActionLink from '../../components/ActionLink.jsx';
import { api, carName, statusLabels, money } from '../../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, Loading, Notice } from '../../components/Feedback.jsx';
import AdminDeleteListingButton from '../admin/AdminDeleteListingButton.jsx';

export default function MyCarsPage() {
  const { user } = useAuth();
  const [cars, setCars] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  // يجلب طلبات الحساب الحالي فقط ويحدث حالات الانتظار والنجاح والفشل للقائمة.
  async function load() {
    setState('loading');
    setError('');
    try {
      const [data, owned] = await Promise.all([
        api('/api/account/cars'),
        api('/api/account/vehicles'),
      ]);
      setCars(data.cars || []);
      setVehicles(owned.vehicles || []);
      setState('ready');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <main className="seller-page">
      <ActionLink
        to={user.can_list === false ? '/account' : '/account/cars/new'}
        className="back-link"
      >
        <ArrowRight size={16} /> {user.can_list === false ? 'حسابي' : 'تقديم سيارة'}
      </ActionLink>
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">مساحة حسابك</span>
          <h1>سياراتي المقدّمة</h1>
          <p>تابع حالة كل سيارة قدّمتها للمراجعة.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-quiet" onClick={load}>
            <RefreshCw size={16} /> تحديث
          </button>
          {user.can_list !== false && (
            <ActionLink to="/account/cars/new" className="button button-dark">
              <Plus size={17} /> سيارة جديدة
            </ActionLink>
          )}
        </div>
      </div>
      {state === 'loading' && <Loading label="جارٍ تحميل سياراتك…" />}
      {state === 'error' && <Notice>{error}</Notice>}
      {state === 'ready' && vehicles.length > 0 && (
        <section className="form-card">
          <h2>سيارات انتقلت ملكيتها إليك</h2>
          <p>يمكنك إعادة عرضها بطلب جديد وصور وأوراق ملكية حديثة. يبقى سجل البيع السابق محفوظًا.</p>
          <div className="record-list">
            {vehicles.map((vehicle) => (
              <article key={vehicle.id} className="record-card">
                <h3>{carName(vehicle)}</h3>
                <p>رقم الهيكل: {vehicle.vin}</p>
                {vehicle.has_live_listing ? (
                  <p>يوجد طلب أو إعلان قائم لهذه السيارة.</p>
                ) : (
                  user.can_list !== false && (
                    <ActionLink
                      className="button button-dark"
                      to={'/account/cars/new?vehicle=' + vehicle.id}
                    >
                      إعادة عرض السيارة
                    </ActionLink>
                  )
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {state === 'ready' &&
        (cars.length ? (
          <div className="submission-list">
            {cars.map((car) => (
              <article className="submission-row" key={car.id}>
                <div className="submission-car-icon">
                  <CarFront size={23} />
                </div>
                <div className="submission-car">
                  <strong>{carName(car)}</strong>
                  <span>
                    {car.location || 'ليبيا'} · {car.year}
                  </span>
                </div>
                <span className={`status-tag status-${car.status}`}>
                  {statusLabels[car.status] || car.status}
                </span>
                <time>
                  {car.created_at ? new Date(car.created_at).toLocaleDateString('ar-LY') : ''}
                </time>
                {car.rejection_reason && (
                  <p>
                    {car.status === 'rejected' ? 'سبب الرفض: ' : 'ملاحظات الإدارة: '}
                    {car.rejection_reason}
                  </p>
                )}
                {user.can_list !== false &&
                  ['pending_review', 'rejected', 'approved'].includes(car.status) &&
                  car.no_open_auction && (
                    <ActionLink
                      className={car.status === 'rejected' ? 'button button-dark' : 'text-link'}
                      to={'/account/cars/' + car.id + '/edit'}
                    >
                      {car.status === 'rejected'
                        ? 'تعديل العرض وإعادة إرساله'
                        : car.ownership_status === 'missing'
                          ? 'تعديل العرض وإعادة المراجعة'
                          : 'تعديل بيانات السيارة'}
                    </ActionLink>
                  )}
                {car.listing_fee_amount != null && (
                  <p>رسوم العرض المسددة: {money(car.listing_fee_amount)}</p>
                )}
                <AdminDeleteListingButton
                  car={car}
                  onDeleted={(id) => setCars((current) => current.filter((item) => item.id !== id))}
                />
                {car.auction_id && (
                  <ActionLink className="text-link" to={'/auctions/' + car.auction_id}>
                    {car.status === 'sold' ? 'سجل المزاد المباع' : 'عرض المزاد'}
                  </ActionLink>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="لم تقدّم أي سيارة بعد"
            description="أضف بيانات سيارتك وصورها لبدء عملية المراجعة."
          />
        ))}
    </main>
  );
}
