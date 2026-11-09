/**
 * فواتير المستخدم كطرف بيع أو شراء؛ السداد والتسليم والاستلام والاعتراض ومتابعة سجل المعاملة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ActionLink from '../../components/ActionLink.jsx';
import { api, carName, dateTime, money, statusLabels } from '../../api.js';
import { EmptyState, Loading, Notice } from '../../components/Feedback.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { routes } from '../../routes.js';
import { saleLabels, settlementLabels } from './saleLabels.js';
import SaleHistory from './SaleHistory.jsx';
export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);
  const [disputeId, setDisputeId] = useState(null);
  const [reason, setReason] = useState('');
  const requestVersion = useRef(0);
  // رقم الطلب يمنع تزامن التحديث الدوري مع إجراء المستخدم من إعادة عرض بيانات فاتورة أقدم.
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const data = await api('/api/invoices');
    if (version === requestVersion.current) {
      setInvoices(data.invoices);
      setError('');
    }
  }, []);
  // تحديث دوري وعند عودة التركيز لالتقاط السداد أو قرار الإدارة أو انتهاء المهلة دون إعادة تحميل يدوي.
  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    const refresh = () => load().catch((err) => setError(err.message));
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => {
      requestVersion.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  // يطلب تأكيد حفظ المبلغ في ضمان المعاملة، ثم يسدد الفاتورة مرة واحدة عبر الخادم ويجدد القائمة.
  async function pay(invoice) {
    if (
      !window.confirm(
        'سداد تجريبي بقيمة ' +
          money(invoice.winning_amount) +
          ' إلى ضمان المعاملة حتى تأكيد الاستلام؟ الرصيد تجريبي ولا تنتقل أموال حقيقية.',
      )
    )
      return;
    setBusy(invoice.id);
    setError('');
    setMessage('');
    try {
      const result = await api('/api/invoices/' + invoice.id + '/pay-wallet', { method: 'POST' });
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  // يجمع تأكيدات التسليم والاستلام أو سبب الاعتراض ويرسل الإجراء المناسب لدورة البيع.
  async function saleAction(invoice, action, body = {}) {
    if (
      action === 'receive' &&
      !window.confirm(
        'هل استلمت السيارة وتحققت منها؟ التأكيد يُتم البيع ويصرف الضمان التجريبي للبائع، ولا يمكن فتح اعتراض من هذه الصفحة بعده.',
      )
    )
      return;
    if (
      action === 'handover' &&
      !window.confirm(
        'هل سلّمت السيارة للمشتري فعلًا؟ يبقى الضمان محفوظًا حتى يؤكد المشتري الاستلام.',
      )
    )
      return;
    setBusy(invoice.id);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/invoices/${invoice.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMessage(result.message);
      setDisputeId(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className="page-main">
      <div className="dashboard-heading">
        <div>
          <h1>فواتيري</h1>
          <p>فواتير بيع وشراء السيارات. الدفع بالمحفظة تجريبي بالدينار الليبي.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-quiet no-print"
            disabled={busy !== null}
            onClick={() => load().catch((err) => setError(err.message))}
          >
            تحديث الفواتير
          </button>
          <ActionLink className="button button-quiet no-print" to={routes.wallet}>
            محفظتي التجريبية
          </ActionLink>
          <button className="button button-quiet no-print" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      {loading ? (
        <Loading />
      ) : invoices.length ? (
        <div className="record-list">
          {invoices.map((invoice) => {
            const demo = invoice.payment_mode === 'demo_wallet';
            const buyer = String(invoice.buyer_id) === String(user.id);
            return (
              <article className="record-card" key={invoice.id} id={'invoice-' + invoice.id}>
                <div className="record-heading">
                  <h2>{carName(invoice)}</h2>
                  <span className={`status-tag sale-${invoice.sale_status}`}>
                    {saleLabels[invoice.sale_status] || statusLabels[invoice.status]}
                  </span>
                </div>
                <p>
                  رقم الفاتورة: <b>{invoice.invoice_number}</b>
                </p>
                <p>
                  {buyer ? 'فاتورة شراء' : 'فاتورة بيع'} ·{' '}
                  {demo ? 'محفظة تجريبية — لا تمثل دفعًا حقيقيًا' : 'دفع يدوي تؤكده الإدارة'}
                </p>
                <p>قيمة السيارة: {money(invoice.winning_amount)}</p>
                <p>العمولة: {money(invoice.commission_amount)}</p>
                <p>تاريخ الإصدار: {dateTime(invoice.issued_at)}</p>
                {invoice.paid_at && <p>تاريخ السداد: {dateTime(invoice.paid_at)}</p>}
                {invoice.sale_status === 'awaiting_payment' && (
                  <p>
                    آخر موعد للسداد: <strong>{dateTime(invoice.due_at)}</strong>. بعد المهلة يُلغى
                    الفوز ويُفك الحجز دون غرامة.
                  </p>
                )}
                <p>{settlementLabels[invoice.settlement_state]}</p>
                {invoice.dispute_reason && <p>سبب الاعتراض المسجل: {invoice.dispute_reason}</p>}
                {invoice.completed_at && <p>تأكيد الاستلام: {dateTime(invoice.completed_at)}</p>}
                <div className="heading-actions no-print">
                  {buyer && demo && invoice.sale_status === 'awaiting_payment' && (
                    <button
                      className="button button-dark"
                      disabled={busy !== null}
                      onClick={() => pay(invoice)}
                    >
                      {busy === invoice.id ? 'جارٍ الدفع…' : 'دفع تجريبي من المحفظة'}
                    </button>
                  )}
                  {!buyer && invoice.sale_status === 'awaiting_handover' && (
                    <button
                      className="button button-dark"
                      disabled={busy !== null}
                      onClick={() => saleAction(invoice, 'handover')}
                    >
                      تسجيل تسليم السيارة
                    </button>
                  )}
                  {buyer && invoice.sale_status === 'handed_over' && (
                    <button
                      className="button button-dark"
                      disabled={busy !== null}
                      onClick={() => saleAction(invoice, 'receive')}
                    >
                      تأكيد الاستلام وإتمام البيع
                    </button>
                  )}
                  {['awaiting_handover', 'handed_over'].includes(invoice.sale_status) && (
                    <button
                      className="button button-reject"
                      disabled={busy !== null}
                      onClick={() => {
                        setDisputeId(invoice.id);
                        setReason('');
                      }}
                    >
                      فتح اعتراض للإدارة
                    </button>
                  )}
                  <ActionLink className="text-link" to={routes.auction(invoice.auction_id)}>
                    تفاصيل المزاد
                  </ActionLink>
                </div>
                {disputeId === invoice.id && (
                  <form
                    className="form-stack sale-action-form no-print"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saleAction(invoice, 'dispute', { reason });
                    }}
                  >
                    <label className="field-label">
                      سبب الاعتراض
                      <textarea
                        required
                        minLength={10}
                        maxLength={2000}
                        rows={3}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <p className="muted-note">
                      يوقف الاعتراض تأكيد الاستلام وصرف الضمان حتى قرار الإدارة.
                    </p>
                    <div className="heading-actions">
                      <button className="button button-reject" disabled={busy !== null}>
                        إرسال الاعتراض
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => setDisputeId(null)}
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
            );
          })}
        </div>
      ) : (
        !error && (
          <EmptyState
            title="لا توجد فواتير بعد"
            description="تظهر الفاتورة عند إغلاق مزاد انتهى ببيع السيارة."
          />
        )
      )}
    </main>
  );
}
