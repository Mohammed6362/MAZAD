/**
 * مراجعة السيارة وصورها وأوراقها الاختيارية؛ يتطلب الاعتماد قرار المدير ونسخة الطلب الحالية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect, useState } from 'react';
import ActionLink from '../../../components/ActionLink.jsx';
import { api, carName, money, dateTime } from '../../../api.js';
import { EmptyState, Loading, Notice } from '../../../components/Feedback.jsx';
import { routes } from '../../../routes.js';
import AdminDeleteListingButton from '../AdminDeleteListingButton.jsx';
export default function AdminReviewPage() {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [notes, setNotes] = useState({});
  const [documents, setDocuments] = useState({});
  const [history, setHistory] = useState({});
  const [verified, setVerified] = useState({});
  const [transferConfirmed, setTransferConfirmed] = useState({});
  const [policy, setPolicy] = useState(null);
  // يفتح المستندات الخاصة للسيارة ويعيد إقرار الفحص إلى غير محدد عند تبديل الطلب.
  async function openDetails(car) {
    setError('');
    if (expanded === car.id) return setExpanded(null);
    try {
      const [result, vehicleHistory] = await Promise.all([
        api(`/api/admin/cars/${car.id}/ownership`),
        api(`/api/admin/cars/${car.id}/history`),
      ]);
      setHistory((current) => ({ ...current, [car.id]: vehicleHistory.history }));
      setVerified((current) => ({ ...current, [car.id]: false }));
      setTransferConfirmed((current) => ({ ...current, [car.id]: false }));
      setDocuments((current) => ({ ...current, [car.id]: result.documents }));
      setExpanded(car.id);
    } catch (err) {
      setError(err.message);
    }
  }
  // يجلب طلبات المراجعة وسياسة الرسوم ويفرغ أي مستندات أو إقرارات مرتبطة بالقائمة السابقة.
  async function load() {
    setLoading(true);
    setError('');
    try {
      const [data, listingPolicy] = await Promise.all([
        api('/api/admin/cars/pending'),
        api('/api/listing-policy'),
      ]);
      setPolicy(listingPolicy);
      setCars(data.cars);
      setDocuments({});
      setHistory({});
      setVerified({});
      setTransferConfirmed({});
      setExpanded(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  // يرسل الاعتماد أو الرفض مع الملاحظات ورقم نسخة المستندات لمنع اعتماد طلب تغيّر منذ فتحه.
  async function review(id, action) {
    setBusy(id);
    setError('');
    if (action === 'reject' && !notes[id]?.trim()) {
      setError('اكتب سبب الرفض حتى يتمكن البائع من معالجة الطلب.');
      setExpanded(id);
      setBusy(null);
      return;
    }
    try {
      await api('/api/admin/cars/' + id + '/' + action, {
        method: 'PATCH',
        body: JSON.stringify({
          review_notes: notes[id] || '',
          ownership_verified: verified[id] === true,
          ownership_revision: cars.find((car) => car.id === id)?.ownership_revision,
          ownership_transfer_confirmed: transferConfirmed[id] === true,
          expected_owner_id: cars.find((car) => car.id === id)?.current_owner_id,
        }),
      });
      setCars((current) => current.filter((car) => car.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">إدارة المنصة</span>
          <h1>مراجعة السيارات</h1>
          <p>راجع معلومات السيارة وصورها قبل اعتمادها.</p>
        </div>
        <button className="button button-quiet" onClick={load}>
          تحديث
        </button>
      </div>
      <p className="muted-note">
        بعد الاعتماد، انتقل إلى{' '}
        <ActionLink to={routes.adminAuctions} className="text-link">
          إدارة المزادات
        </ActionLink>{' '}
        لتحديد الموعد والسعر. لإدارة وحذف أي سيارة، افتح{' '}
        <ActionLink to={routes.adminListings} className="text-link">
          السيارات والحذف
        </ActionLink>
        .
      </p>
      {error && <Notice>{error}</Notice>}
      {policy && (
        <p className="wallet-bid-note">
          يخصم أول اعتماد للسيارة رسوم عرض قدرها {money(policy.listing_fee)} من رصيد العارض المتاح.
          لا تتكرر عند إعادة الاعتماد بعد التعديل.
        </p>
      )}
      {loading ? (
        <Loading />
      ) : cars.length ? (
        <div className="record-list">
          {cars.map((car) => (
            <article className="record-card" key={car.id}>
              <div className="record-heading">
                <h2>{carName(car)}</h2>
                <span className="status-tag">قيد المراجعة</span>
              </div>
              <p>
                {car.location} · {car.mileage_km ?? '—'} كم
              </p>
              <p>
                البائع: {car.seller_name} · {car.seller_phone}
              </p>
              {car.image_url && (
                <img className="review-cover" src={car.image_url} alt={carName(car)} />
              )}
              <div className="heading-actions">
                <button
                  className="button button-quiet"
                  onClick={() => openDetails(car)}
                  aria-expanded={expanded === car.id}
                >
                  التفاصيل والصور وأوراق الملكية
                </button>
                <button
                  disabled={
                    busy !== null ||
                    !verified[car.id] ||
                    (car.current_owner_id &&
                      String(car.current_owner_id) !== String(car.seller_id) &&
                      !transferConfirmed[car.id])
                  }
                  className="button button-approve"
                  onClick={() => review(car.id, 'approve')}
                >
                  اعتماد السيارة
                </button>
                <button
                  disabled={busy !== null}
                  className="button button-reject"
                  onClick={() => review(car.id, 'reject')}
                >
                  رفض الطلب
                </button>
                <AdminDeleteListingButton
                  car={car}
                  onDeleted={(id) => setCars((current) => current.filter((item) => item.id !== id))}
                />
              </div>
              {expanded === car.id && (
                <div className="review-details">
                  <h3>أوراق الملكية — تظهر في المزاد بعد الاعتماد</h3>
                  <div className="car-gallery ownership-gallery">
                    {documents[car.id]?.map((doc) => (
                      <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer">
                        <img src={doc.url} alt={`مستند الملكية ${doc.id}`} />
                        <span>فتح المستند</span>
                      </a>
                    ))}
                  </div>
                  {!documents[car.id]?.length && (
                    <Notice>
                      لم تُرفق أوراق ملكية. يمكنك اعتماد الملكية دون مرفقات أو رفض الطلب مع توضيح
                      السبب.
                    </Notice>
                  )}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!verified[car.id]}
                      onChange={(event) =>
                        setVerified({ ...verified, [car.id]: event.target.checked })
                      }
                    />
                    {documents[car.id]?.length
                      ? 'راجعت أوراق الملكية وطابقت بيانات السيارة والبائع وأوافق على اعتماد الملكية.'
                      : 'راجعت بيانات السيارة والبائع وأوافق على اعتماد الملكية دون أوراق مرفقة.'}
                  </label>
                  <p>رقم الهيكل: {car.vin}</p>
                  <p>عدد المبيعات المكتملة السابقة: {car.previous_sale_count}</p>
                  {history[car.id]?.length > 0 && (
                    <div>
                      <h3>سجل الملكية والمبيعات السابقة</h3>
                      <ul>
                        {history[car.id].map((event) => (
                          <li key={event.id}>
                            {dateTime(event.created_at)} · {event.from_owner_name || 'تسجيل أول'} ←{' '}
                            {event.to_owner_name}
                            {' · '}
                            {event.source === 'completed_sale'
                              ? 'بيع مكتمل'
                              : event.source === 'legacy'
                                ? 'سجل سابق'
                                : 'مراجعة مستندات'}
                            {event.invoice_number && <> · {event.invoice_number}</>}
                            {event.auction_id && (
                              <>
                                {' '}
                                ·{' '}
                                <ActionLink to={'/auctions/' + event.auction_id}>
                                  المزاد السابق
                                </ActionLink>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {car.current_owner_id &&
                    String(car.current_owner_id) !== String(car.seller_id) && (
                      <div className="wallet-bid-note">
                        <p>
                          المالك المسجل: {car.current_owner_name}. العارض الحالي شخص آخر؛ تحقق من
                          مستند انتقال الملكية خارج المنصة.
                        </p>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!transferConfirmed[car.id]}
                            onChange={(event) =>
                              setTransferConfirmed({
                                ...transferConfirmed,
                                [car.id]: event.target.checked,
                              })
                            }
                          />
                          تحققت من انتقال الملكية إلى العارض وأوافق على تحديث المالك المسجل.
                        </label>
                      </div>
                    )}
                  <p>
                    ناقل الحركة:{' '}
                    {car.transmission === 'automatic'
                      ? 'أوتوماتيك'
                      : car.transmission === 'manual'
                        ? 'يدوي'
                        : 'غير محدد'}
                  </p>
                  <p>
                    الحالة:{' '}
                    {
                      {
                        excellent: 'ممتازة',
                        good: 'جيدة',
                        fair: 'مقبولة',
                        needs_repair: 'تحتاج صيانة',
                      }[car.condition]
                    }
                  </p>
                  <p>الملاحظات: {car.defects_notes || 'لا توجد'}</p>
                  <div className="car-gallery">
                    {car.images?.map((image) => (
                      <a key={image.url} href={image.url} target="_blank" rel="noreferrer">
                        <img src={image.url} alt="صورة السيارة للمراجعة" />
                      </a>
                    ))}
                  </div>
                  <label className="field-label">
                    ملاحظات المراجعة / سبب الرفض
                    <textarea
                      maxLength={1000}
                      value={notes[car.id] || ''}
                      onChange={(e) => setNotes({ ...notes, [car.id]: e.target.value })}
                      rows={3}
                    />
                  </label>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <EmptyState
            title="لا توجد طلبات معلّقة"
            description="ستظهر هنا السيارات الجديدة فور إرسالها من البائعين."
          />
        )
      )}
    </>
  );
}
