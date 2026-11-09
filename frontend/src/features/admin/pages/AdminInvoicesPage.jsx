/**
 * معالجة الفواتير إداريًا؛ السداد اليدوي وقرارات الاعتراض والإلغاء والاسترداد وسجل الإجراءات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect, useState } from 'react';
import { api, carName, dateTime, money, statusLabels } from '../../../api.js';
import { EmptyState, Loading, Notice } from '../../../components/Feedback.jsx';
import { saleLabels, settlementLabels } from '../../account/saleLabels.js';
import SaleHistory from '../../account/SaleHistory.jsx';
export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState('cancel');
  const [reason, setReason] = useState('');
  const [manualRefund, setManualRefund] = useState(false);
  // يجلب الفواتير وحالات الضمان والتسليم والاعتراض للإدارة.
  async function load() {
    const data = await api('/api/admin/invoices');
    setInvoices(data.invoices);
  }
  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  // يسجل تأكيد الإدارة للسداد اليدوي فقط؛ لا ينفذ شحنًا أو تحويلًا في المحفظة.
  async function pay(invoice) {
    if (!window.confirm(`هل تؤكد استلام سداد الفاتورة ${invoice.invoice_number}؟`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/invoices/${invoice.id}/pay`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // يرسل قرار الإلغاء أو استكمال الاعتراض مع السبب وإقرار رد السداد اليدوي عند الحاجة.
  async function decide(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/admin/invoices/${selected}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason, manual_refund_confirmed: manualRefund }),
      });
      setMessage(result.message);
      setSelected(null);
      setReason('');
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
          <h1>فواتير المزادات</h1>
          <p>تابع السداد ومهلته وضمان المعاملات والتسليم، وعالج الاعتراضات وقرارات الإلغاء.</p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      <button
        className="button button-quiet"
        disabled={busy}
        onClick={() => load().catch((err) => setError(err.message))}
      >
        تحديث المعاملات
      </button>
      {loading ? (
        <Loading />
      ) : invoices.length ? (
        <div className="record-list">
          {invoices.map((invoice) => (
            <article className="record-card" key={invoice.id}>
              <div className="record-heading">
                <h2>{carName(invoice)}</h2>
                <span className={`status-tag sale-${invoice.sale_status}`}>
                  {saleLabels[invoice.sale_status] || statusLabels[invoice.status]}
                </span>
              </div>
              <p>رقم الفاتورة: {invoice.invoice_number}</p>
              <p>
                المشتري: {invoice.buyer_name} · البائع: {invoice.seller_name}
              </p>
              <p>
                القيمة: {money(invoice.winning_amount)} · الإصدار: {dateTime(invoice.issued_at)}
              </p>
              {invoice.paid_at && <p>تم السداد: {dateTime(invoice.paid_at)}</p>}
              <p>{settlementLabels[invoice.settlement_state]}</p>
              {invoice.sale_status === 'awaiting_payment' && (
                <p>مهلة السداد: {dateTime(invoice.due_at)}</p>
              )}
              {invoice.dispute_reason && <p>سبب الاعتراض: {invoice.dispute_reason}</p>}
              {invoice.sale_status === 'awaiting_payment' &&
                invoice.payment_mode !== 'demo_wallet' && (
                  <button
                    className="button button-dark"
                    disabled={busy}
                    onClick={() => pay(invoice)}
                  >
                    تسجيل استلام السداد
                  </button>
                )}
              <div className="heading-actions">
                {!['completed', 'cancelled', 'expired'].includes(invoice.sale_status) && (
                  <button
                    className="button button-reject"
                    disabled={busy}
                    onClick={() => {
                      setSelected(invoice.id);
                      setAction('cancel');
                      setReason('');
                      setManualRefund(false);
                    }}
                  >
                    إلغاء المعاملة ومعالجة الرصيد
                  </button>
                )}
                {invoice.sale_status === 'disputed' && invoice.paid_at && (
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() => {
                      setSelected(invoice.id);
                      setAction('resume');
                      setReason('');
                      setManualRefund(false);
                    }}
                  >
                    معالجة الاعتراض واستكمال البيع
                  </button>
                )}
              </div>
              {selected === invoice.id && (
                <form className="form-stack sale-action-form" onSubmit={decide}>
                  <h3>
                    {action === 'cancel' ? 'إلغاء المعاملة' : 'استكمال المعاملة بعد الاعتراض'}
                  </h3>
                  <label className="field-label">
                    سبب القرار (يظهر للطرفين)
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={3}
                    />
                  </label>
                  {action === 'cancel' && (
                    <p className="muted-note">
                      قبل الدفع يُفك حجز العرض. بعد الدفع التجريبي يرجع ضمان المعاملة للمشتري. تعود
                      السيارة للمراجعة ولا يُفتح مزاد جديد تلقائيًا.
                    </p>
                  )}
                  {action === 'cancel' && invoice.settlement_state === 'manual' && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={manualRefund}
                        onChange={(event) => setManualRefund(event.target.checked)}
                        required
                      />
                      أؤكد معالجة رد السداد اليدوي خارج المنصة؛ لا يتم إضافة رصيد للمحفظة مقابله.
                    </label>
                  )}
                  <div className="heading-actions">
                    <button className="button button-dark" disabled={busy}>
                      تأكيد القرار
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => setSelected(null)}
                    >
                      تراجع
                    </button>
                  </div>
                </form>
              )}
              <SaleHistory
                invoiceId={invoice.id}
                revision={`${invoice.sale_status}-${invoice.settlement_state}`}
              />
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <EmptyState
            title="لا توجد فواتير"
            description="تُنشأ فاتورة البيع عند إغلاق مزاد له فائز."
          />
        )
      )}
    </>
  );
}
