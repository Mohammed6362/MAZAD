/**
 * جدولة المزادات بتوقيت ليبيا وتحديد الأسعار ومهلة السداد، مع متابعة المزادات وإلغاء الموعد أو الإغلاق.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useCallback, useEffect, useState } from 'react';
import ActionLink from '../../../components/ActionLink.jsx';
import { api, carName, dateTime, money, statusLabels } from '../../../api.js';
import { EmptyState, Loading, Notice } from '../../../components/Feedback.jsx';
import { routes } from '../../../routes.js';
import { auctionDateTime, auctionDuration, libyaDate } from '../../auctions/schedule.js';

const initial = {
  car_id: '',
  starting_price: '',
  reserve_price: '',
  min_increment: '100',
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  payment_mode: 'demo_wallet',
  payment_due_hours: 48,
};
export default function AdminAuctionsPage() {
  const [cars, setCars] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  // يجلب السيارات والمزادات معًا لبناء قائمة السيارات المعتمدة التي ليس لديها مزاد مفتوح.
  const load = useCallback(async () => {
    const [c, a] = await Promise.all([api('/api/admin/cars'), api('/api/admin/auctions')]);
    setCars(c.cars);
    setAuctions(a.auctions);
  }, []);
  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);
  const available = cars.filter(
    (car) =>
      car.status === 'approved' && car.ownership_status === 'verified' && !car.open_auction_id,
  );
  async function deleteListing(car) {
    if (
      !window.confirm(
        `هل تريد حذف ${carName(car)}؟ سيُلغى أي مزاد مفتوح ويُفك حجز المزايدة. تبقى الفواتير والمعاملات القائمة محفوظة.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api(`/api/admin/cars/${car.id}`, { method: 'DELETE' });
      if (String(form.car_id) === String(car.id)) setForm({ ...form, car_id: '' });
      setSuccess(data.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const startTime = auctionDateTime(form.start_date, form.start_time);
  const endTime = auctionDateTime(form.end_date, form.end_time);
  const duration = startTime && endTime ? auctionDuration(startTime, endTime) : '';
  // يفحص المستقبل وترتيب الموعدين، ويحوّل وقت ليبيا إلى UTC قبل إرسال الجدولة للخادم.
  async function schedule(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!startTime || !endTime) {
      setError('حدّد تاريخ ووقت بداية ونهاية المزاد بتوقيت ليبيا.');
      return;
    }
    if (new Date(startTime) <= new Date()) {
      setError('موعد بداية المزاد يجب أن يكون في المستقبل.');
      return;
    }
    if (new Date(endTime) <= new Date(startTime)) {
      setError('موعد نهاية المزاد يجب أن يكون بعد موعد البداية.');
      return;
    }
    setBusy(true);
    try {
      const { start_date, end_date, ...details } = form;
      await api(`/api/admin/cars/${form.car_id}/auction`, {
        method: 'POST',
        body: JSON.stringify({
          ...details,
          start_time: startTime,
          end_time: endTime,
        }),
      });
      setForm(initial);
      setSuccess('تمت جدولة المزاد، وسيُفتح للمزايدة تلقائيًا في موعد البداية.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يلغي موعدًا بعد تأكيد المدير؛ الخلفية تسمح بذلك فقط قبل البداية ودون عروض.
  async function cancel(id) {
    if (!window.confirm('هل تريد إلغاء موعد هذا المزاد قبل بدايته؟')) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api('/api/admin/auctions/' + id + '/cancel', { method: 'POST' });
      setSuccess(data.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يطلب إغلاقًا احتياطيًا وتحديد الفائز بعد انتهاء المزاد، ثم يجدد قوائم الإدارة.
  async function close(id) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api(`/api/admin/auctions/${id}/close`, { method: 'POST' });
      setSuccess(data.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">لوحة الإدارة</span>
          <h1>إدارة المزادات</h1>
          <p>جدولة المزادات، متابعة الأسعار، وإصدار فاتورة الفائز بعد الانتهاء.</p>
        </div>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => load().catch((err) => setError(err.message))}
        >
          تحديث
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}
      {loading ? (
        <Loading />
      ) : (
        <>
          <section id="approved-listings" className="form-card" aria-label="جميع السيارات">
            <h2>جميع السيارات</h2>
            <p className="muted-note">
              يمكن للمدير حذف أي سيارة بمختلف حالاتها. يُلغى المزاد المفتوح ويُفك حجز المزايدة،
              وتبقى الفواتير وسجلات المعاملات محفوظة.
            </p>
            {cars.length ? (
              <div className="record-list">
                {cars.map((car) => (
                  <article className="record-card" key={car.id}>
                    <h3>{carName(car)}</h3>
                    <span className="status-tag">{statusLabels[car.status] || car.status}</span>
                    <p>
                      العارض: {car.seller_name} · رقم الهيكل: {car.vin}
                    </p>
                    {car.open_auction_id && (
                      <p className="muted-note">سيُلغى المزاد المفتوح عند حذف السيارة.</p>
                    )}
                    <button
                      type="button"
                      className="button button-reject"
                      disabled={busy}
                      onClick={() => deleteListing(car)}
                    >
                      حذف العرض
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p>لا توجد سيارات.</p>
            )}
          </section>
          <section className="form-card">
            <h2>جدولة مزاد جديد</h2>
            <p className="muted-note">
              المزاد يغلق تلقائيًا، ويُمدد دقيقتين عند وصول عرض في آخر دقيقتين.
            </p>
            <p className="muted-note">
              تظهر هنا السيارات التي اعتمد المدير بياناتها وملكيتها، سواء أُرفقت أوراق الملكية أم لم
              تُرفق.
            </p>
            {available.length ? (
              <form className="form-stack" onSubmit={schedule}>
                <div className="form-grid">
                  <label className="field-label field-full">
                    طريقة التسوية
                    <select name="payment_mode" value={form.payment_mode} onChange={update}>
                      <option value="demo_wallet">محفظة بالدينار الليبي</option>
                      <option value="manual">دفع يدوي تؤكده الإدارة</option>
                    </select>
                  </label>
                  <label className="field-label">
                    مهلة سداد الفائز بعد إغلاق المزاد (ساعات)
                    <input
                      name="payment_due_hours"
                      type="number"
                      min="1"
                      max="168"
                      step="1"
                      required
                      value={form.payment_due_hours}
                      onChange={update}
                    />
                  </label>
                  <label className="field-label field-full">
                    السيارة المعتمدة
                    <select name="car_id" value={form.car_id} onChange={update} required>
                      <option value="">اختر سيارة</option>
                      {available.map((car) => (
                        <option key={car.id} value={car.id}>
                          {carName(car)} — {car.vin}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    السعر الابتدائي (د.ل)
                    <input
                      name="starting_price"
                      type="number"
                      min="0.001"
                      max="99999999999"
                      step="0.001"
                      value={form.starting_price}
                      onChange={update}
                      required
                    />
                  </label>
                  <label className="field-label">
                    أقل زيادة (د.ل)
                    <input
                      name="min_increment"
                      type="number"
                      min="0.001"
                      max="99999999999"
                      step="0.001"
                      value={form.min_increment}
                      onChange={update}
                      required
                    />
                  </label>
                  <label className="field-label">
                    الحد الأدنى للبيع (اختياري)
                    <input
                      name="reserve_price"
                      type="number"
                      min={form.starting_price || '0.001'}
                      step="0.001"
                      value={form.reserve_price}
                      onChange={update}
                    />
                  </label>
                  <p className="muted-note">
                    الحد الأدنى للبيع لا يظهر للمزايدين. لا يتم البيع إذا لم يصل أعلى عرض إليه.
                  </p>
                  <label className="field-label">
                    تاريخ بداية المزايدة
                    <input
                      name="start_date"
                      type="date"
                      min={libyaDate()}
                      value={form.start_date}
                      onChange={update}
                      required
                    />
                  </label>
                  <label className="field-label">
                    وقت بداية المزايدة
                    <input
                      name="start_time"
                      type="time"
                      step="60"
                      value={form.start_time}
                      onChange={update}
                      required
                    />
                  </label>
                  <label className="field-label">
                    تاريخ نهاية المزايدة
                    <input
                      name="end_date"
                      type="date"
                      min={form.start_date || libyaDate()}
                      value={form.end_date}
                      onChange={update}
                      required
                    />
                  </label>
                  <label className="field-label">
                    وقت نهاية المزايدة
                    <input
                      name="end_time"
                      type="time"
                      step="60"
                      value={form.end_time}
                      onChange={update}
                      required
                    />
                  </label>
                </div>
                <p className="muted-note">
                  جميع المواعيد بتوقيت ليبيا (طرابلس، UTC+02:00)، حتى لو كان جهازك على توقيت آخر.
                </p>
                {duration && (
                  <section
                    className="wallet-bid-note"
                    aria-label="ملخص موعد المزاد"
                    aria-live="polite"
                  >
                    <strong>موعد المزايدة بتوقيت ليبيا</strong>
                    <p>البداية: {dateTime(startTime)}</p>
                    <p>النهاية: {dateTime(endTime)}</p>
                    <p>مدة المزاد: {duration}</p>
                  </section>
                )}
                <button disabled={busy} className="button button-dark">
                  {busy ? 'جارٍ الحفظ…' : 'جدولة المزاد'}
                </button>
              </form>
            ) : (
              <p>
                لا توجد سيارة جاهزة للجدولة.{' '}
                <ActionLink className="text-link" to={routes.adminReview}>
                  راجع طلبات السيارات
                </ActionLink>
              </p>
            )}
          </section>
          <section className="auction-management">
            <h2>جميع المزادات</h2>
            {auctions.length ? (
              <div className="record-list">
                {auctions.map((auction) => {
                  const open = ['active', 'scheduled'].includes(auction.status);
                  const expired = new Date(auction.end_time) <= new Date();
                  const label = open
                    ? expired
                      ? 'بانتظار الإغلاق وتحديد الفائز'
                      : new Date(auction.start_time) > new Date()
                        ? 'مجدول'
                        : 'نشط'
                    : statusLabels[auction.status];
                  return (
                    <article className="record-card" key={auction.id}>
                      <div className="record-heading">
                        <h3>{carName(auction)}</h3>
                        <span className="status-tag">{label}</span>
                      </div>
                      <p>
                        السعر: {money(auction.current_price || auction.starting_price)} ·{' '}
                        {auction.bid_count} مزايدة
                      </p>
                      <p>
                        التسوية: {auction.payment_mode === 'demo_wallet' ? 'محفظة' : 'دفع يدوي'}
                      </p>
                      <p>البداية: {dateTime(auction.start_time)}</p>
                      <p>النهاية: {dateTime(auction.end_time)}</p>
                      {auction.invoice_number && <p>فاتورة الفائز: {auction.invoice_number}</p>}
                      {auction.status === 'closed' && !auction.winner_id && <p>أُغلق دون بيع.</p>}
                      <div className="heading-actions">
                        {auction.car_status === 'deleted' ? (
                          <span className="muted-note">حُذف عرض السيارة</span>
                        ) : (
                          <ActionLink
                            className="button button-quiet"
                            to={routes.auction(auction.id)}
                          >
                            عرض المزاد
                          </ActionLink>
                        )}
                        {auction.status === 'scheduled' &&
                          new Date(auction.start_time) > new Date() &&
                          Number(auction.bid_count) === 0 && (
                            <button
                              className="button button-reject"
                              disabled={busy}
                              onClick={() => cancel(auction.id)}
                            >
                              إلغاء الموعد
                            </button>
                          )}
                        {open && expired && (
                          <button
                            className="button button-dark"
                            disabled={busy}
                            onClick={() => close(auction.id)}
                          >
                            إغلاق وتحديد الفائز
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="لا توجد مزادات" description="اعتمد سيارة ثم حدّد موعد مزادها." />
            )}
          </section>
        </>
      )}
    </>
  );
}
