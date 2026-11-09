/**
 * عرض رصيد المحفظة والمتاح والمحجوز والضمان، مع الشحن وسجل الحركات ورسوم عرض السيارات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { paymentReference } from './paymentReference.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import ActionLink from '../../components/ActionLink.jsx';
import { api, money, dateTime, carName } from '../../api.js';
import { Loading, Notice, EmptyState } from '../../components/Feedback.jsx';
import { routes } from '../../routes.js';
const labels = {
  listing_fee: 'رسوم عرض سيارة',
  demo_top_up: 'شحن المحفظة',
  auction_payment: 'سداد فاتورة تجريبي',
  sale_credit: 'حصيلة بيع تجريبية',
  auction_refund: 'استرداد ضمان معاملة ملغاة',
};
export default function WalletPage() {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('50000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef(null);
  // يجدد ملخص المحفظة والحجوزات والحركات ويمسح خطأ الاتصال السابق بعد التعافي.
  const load = useCallback(async () => {
    const value = await api('/api/account/wallet');
    setData(value);
    setError('');
  }, []);
  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);
  // يثبت مرجع الشحن عند إعادة المحاولة بالمبلغ نفسه ثم يحدث المحفظة بعد نجاح العملية.
  async function topUp(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    if (!pending.current || pending.current.amount !== amount)
      pending.current = { amount, key: paymentReference() };
    try {
      const result = await api('/api/account/wallet/top-up', {
        method: 'POST',
        body: JSON.stringify({ amount, request_key: pending.current.key }),
      });
      pending.current = null;
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-main">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">رصيد بالدينار الليبي LYD</span>
          <h1>محفظتي التجريبية</h1>
          <p>رصيد تجريبي لا يمثل أموالًا حقيقية، ولا يرتبط ببطاقة أو حساب مصرفي.</p>
        </div>
        <button
          className="button button-quiet"
          onClick={() => load().catch((err) => setError(err.message))}
        >
          تحديث
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="stats-grid wallet-stats">
            {[
              ['إجمالي الرصيد', data.wallet.balance],
              ['المتاح للمزايدة', data.wallet.available],
              ['المحجوز للعروض والفواتير', data.wallet.reserved],
              ['مدفوعاتك في ضمان المعاملات', data.wallet.escrowed_payments],
              ['حصيلة بيع تنتظر تأكيد الاستلام', data.wallet.pending_proceeds],
            ].map(([label, value]) => (
              <div className="record-card stat-card" key={label}>
                <span>{label}</span>
                <strong>{money(value)}</strong>
              </div>
            ))}
          </div>
          <section className="form-card">
            <h2>إضافة رصيد</h2>
            <form className="form-stack wallet-topup" onSubmit={topUp}>
              <label className="field-label">
                المبلغ بالدينار الليبي
                <input
                  type="number"
                  min="0.001"
                  max="1000000"
                  step="0.001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <button className="button button-dark" disabled={busy}>
                {busy ? 'جارٍ الشحن…' : 'شحن تجريبي — بدون دفع حقيقي'}
              </button>
            </form>
            <p className="muted-note">
              يمكنك إضافة حتى مليون دينار في العملية. حجز العرض لا يخصم الرصيد؛ يفك عند تجاوزه، أو
              يستخدم عند سداد فاتورة الفوز.
            </p>
          </section>
          <section className="auction-management">
            <div className="record-heading">
              <h2>المبالغ المحجوزة</h2>
              <ActionLink to={routes.invoices} className="text-link">
                الفواتير والدفع
              </ActionLink>
            </div>
            {data.holds.length ? (
              <div className="record-list">
                {data.holds.map((hold) => (
                  <article className="record-card" key={hold.auction_id}>
                    <div className="record-heading">
                      <h3>{carName(hold)}</h3>
                      <strong>{money(hold.amount)}</strong>
                    </div>
                    <p>
                      {hold.invoice_id
                        ? 'محجوز لسداد فاتورة الفوز'
                        : 'محجوز لأن عرضك الأعلى حاليًا'}
                    </p>
                    <ActionLink
                      className="text-link"
                      to={hold.invoice_id ? routes.invoices : routes.auction(hold.auction_id)}
                    >
                      {hold.invoice_id ? 'سداد الفاتورة تجريبيًا' : 'عرض المزاد'}
                    </ActionLink>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-note">لا توجد مبالغ محجوزة.</p>
            )}
          </section>
          <section className="auction-management">
            <h2>سجل المحفظة</h2>
            <p className="muted-note">آخر 100 حركة مالية تجريبية. الحجوزات تظهر في القسم السابق.</p>
            {data.transactions.length ? (
              <div className="record-list">
                {data.transactions.map((transaction) => (
                  <article className="record-card" key={transaction.id}>
                    <div className="record-heading">
                      <strong>{labels[transaction.kind]}</strong>
                      <strong
                        className={
                          Number(transaction.amount) < 0 ? 'wallet-debit' : 'wallet-credit'
                        }
                      >
                        {money(transaction.amount)}
                      </strong>
                    </div>
                    <p>{dateTime(transaction.created_at)}</p>
                    <p>
                      الرصيد قبل الحركة: <strong>{money(transaction.balance_before)}</strong>
                    </p>
                    <p>
                      الرصيد بعد الحركة: <strong>{money(transaction.balance_after)}</strong>
                    </p>
                    {transaction.invoice_id && (
                      <ActionLink className="text-link" to={routes.invoices}>
                        عرض الفاتورة
                      </ActionLink>
                    )}
                    {transaction.car_id && (
                      <ActionLink className="text-link" to={routes.cars}>
                        السيارة رقم {transaction.car_id}
                      </ActionLink>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="لا توجد حركات بعد"
                description="أضف رصيدًا إلى محفظتك وابدأ تجربة المزاد."
              />
            )}
          </section>
        </>
      )}
      <ActionLink className="text-link back-link" to={routes.auctionRules}>
        كيف يعمل المزاد والمحفظة؟
      </ActionLink>
    </main>
  );
}
