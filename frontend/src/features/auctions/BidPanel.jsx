/**
 * لوحة المزاد التفاعلية؛ تحدّث السعر والعروض والمحفظة دوريًا وترسل العرض وتعرض المهلة وحالة المزاد.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ActionLink from '../../components/ActionLink.jsx';
import { api, carName, dateTime, money, statusLabels } from '../../api.js';
import { Loading, Notice } from '../../components/Feedback.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { routes } from '../../routes.js';
import { getAuction, getAuctionBids, placeAuctionBid } from './api.js';
import Countdown from './Countdown.jsx';
import OwnershipDocuments from './OwnershipDocuments.jsx';

export default function BidPanel({ auctionId }) {
  const [auction, setAuction] = useState(null);
  const [bids, setBids] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const location = useLocation();
  const alive = useRef(false);
  const fetching = useRef(false);
  // يحدث المزاد والعروض وملخص المحفظة معًا؛ يمنع تداخل طلبات التحديث ويتجاهل الرد بعد مغادرة الصفحة.
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const [a, b, w] = await Promise.all([
        getAuction(auctionId),
        getAuctionBids(auctionId),
        user?.roles.includes('user')
          ? api('/api/account/wallet?summary=1').catch(() => null)
          : Promise.resolve(null),
      ]);
      if (alive.current) {
        setAuction(a.auction);
        setWallet(w?.wallet || null);
        setBids(b.bids || []);
        setError('');
      }
    } catch (err) {
      if (alive.current) {
        setError(err.message);
        if (err.status === 404) {
          setAuction(null);
          setBids([]);
          setWallet(null);
        }
      }
    } finally {
      fetching.current = false;
      if (alive.current) setLoading(false);
    }
  }, [auctionId, user?.id]);
  useEffect(() => {
    alive.current = true;
    refresh();
    window.addEventListener('mazad:market', refresh);
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('mazad:market', refresh);
    };
  }, [refresh]);
  const current = Number(auction?.current_price ?? auction?.starting_price ?? 0);
  // الحد المحسوب يساعد الإدخال فقط؛ قاعدة البيانات تعيد فحصه لأن عرضًا منافسًا قد يصل في اللحظة نفسها.
  const minimum =
    Number(auction?.bid_count) > 0
      ? Number((current + Number(auction.min_increment)).toFixed(3))
      : Number(auction?.starting_price || 0);
  // يرسل قيمة العرض ثم يجدد الحالة من الخادم، حتى عند الرفض بسبب منافس سبق المستخدم.
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await placeAuctionBid(auctionId, amount);
      setAmount('');
      await refresh();
      setSuccess('تم تسجيل مزايدتك بنجاح.');
    } catch (err) {
      await refresh();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading label="جارٍ تحميل المزاد…" />;
  if (!auction)
    return (
      <>
        <Notice>{error || 'المزاد غير متاح.'}</Notice>
        <Link to={routes.home} className="text-link">
          الرئيسية
        </Link>
      </>
    );
  // حالة الواجهة تحدد إتاحة النموذج؛ الخادم يراجع الوقت والحالة والصلاحية عند كل عرض فعلي.
  const open =
    auction.status === 'active' &&
    new Date(auction.end_time) > new Date() &&
    user?.can_bid !== false;
  return (
    <section className="bid-panel form-card">
      <Link to={routes.car(auction.car_id)} className="back-link">
        تفاصيل السيارة
      </Link>
      <div className="record-heading">
        <div>
          <span className="section-kicker">مزاد رقم {auction.id}</span>
          <h1>{carName(auction)}</h1>
        </div>
        <span className="status-tag">{statusLabels[auction.status]}</span>
      </div>
      <div className="auction-facts">
        <div>
          <small>السعر الحالي</small>
          <strong>{money(current)}</strong>
        </div>
        <div>
          <small>عدد المزايدات</small>
          <strong>{auction.bid_count}</strong>
        </div>
      </div>
      <p>البداية: {dateTime(auction.start_time)}</p>
      <p>النهاية: {dateTime(auction.end_time)}</p>
      <p className="muted-note">جميع المواعيد بتوقيت ليبيا.</p>
      <OwnershipDocuments key={auction.id} auctionId={auction.id} />
      {user?.can_bid === false && <Notice>أوقفت الإدارة صلاحية المزايدة لهذا الحساب.</Notice>}
      {['scheduled', 'active'].includes(auction.status) && (
        <Countdown
          target={auction.status === 'scheduled' ? auction.start_time : auction.end_time}
          serverTime={auction.server_time}
          label={auction.status === 'scheduled' ? 'يبدأ بعد' : 'الوقت المتبقي'}
        />
      )}
      <p>
        {auction.has_reserve
          ? auction.reserve_met
            ? 'تم الوصول إلى حد البيع'
            : 'حد البيع لم يتحقق بعد'
          : 'مزاد دون حد بيع إضافي'}
      </p>
      <p className="muted-note">
        مهلة سداد الفائز بعد الإغلاق: {auction.payment_due_hours} ساعة. عدم السداد يلغي الفوز ويفك
        الحجز دون غرامة.
      </p>
      {auction.payment_mode === 'demo_wallet' ? (
        <div className="wallet-bid-note">
          <strong>محفظة تجريبية بالدينار الليبي — لا توجد أموال حقيقية</strong>
          <p>
            يُحجز كامل العرض الأعلى ويُفك عند تجاوزه. لا توجد عمولة إضافية على المزايدة أو قيمة
            البيع.
          </p>
          {wallet && (
            <p>
              رصيدك المتاح: {money(wallet.available)} · المحجوز لهذا المزاد:{' '}
              {money(auction.my_held_amount)}
            </p>
          )}
          <ActionLink className="text-link" to={routes.wallet}>
            شحن وعرض محفظتي التجريبية
          </ActionLink>
        </div>
      ) : (
        <p className="summary-hint">هذا المزاد يستخدم الدفع اليدوي السابق.</p>
      )}
      <p className="muted-note">
        أي عرض في آخر {auction.soft_close_seconds || 0} ثانية يعيد الوقت المتبقي لهذه المدة. يغلق
        المزاد تلقائيًا بعد انتهاء الوقت.
      </p>
      <ActionLink className="text-link" to={routes.auctionRules}>
        آلية المزايدة والفوز والدفع
      </ActionLink>
      {error && <Notice>{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}
      {open &&
        (auction.is_owner ? (
          <p className="summary-hint">
            هذه سيارتك؛ يمكنك متابعة العروض عليها، والمزايدة على سيارات الآخرين.
          </p>
        ) : user?.roles.includes('user') ? (
          <form className="bid-form form-stack" onSubmit={submit}>
            <label className="field-label">
              أقل عرض مسموح: {money(minimum)}
              <input
                type="number"
                min={minimum}
                max="99999999999"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(minimum)}
                required
              />
            </label>
            <button
              className="button button-dark"
              disabled={busy || !amount || Number(amount) < minimum}
            >
              {busy ? 'جارٍ الإرسال…' : 'تأكيد المزايدة'}
            </button>
            <small>تأكيد المزايدة يسجّل عرضك على السيارة.</small>
          </form>
        ) : (
          <p>
            <Link className="text-link" to={routes.login} state={{ returnTo: location.pathname }}>
              سجّل الدخول للمزايدة أو أنشئ حسابًا
            </Link>
          </p>
        ))}
      {!open && (
        <p className="summary-hint">
          {auction.status === 'scheduled'
            ? 'يمكن تقديم العروض بعد بدء المزاد.'
            : auction.status === 'ended'
              ? 'انتهى الوقت. جارٍ تثبيت النتيجة تلقائيًا؛ يُحدّث العرض خلال ثوانٍ.'
              : 'المزاد مغلق للمزايدة.'}
        </p>
      )}
      <div className="record-heading">
        <h2>آخر المزايدات</h2>
        <button className="button button-quiet" onClick={refresh}>
          تحديث
        </button>
      </div>
      <p className="muted-note">تُحدّث العروض تلقائيًا كل 5 ثوانٍ.</p>
      <div className="bid-list">
        {bids.slice(0, 15).map((bid) => (
          <div key={bid.id}>
            <time>{dateTime(bid.placed_at)}</time>
            <strong>{money(bid.amount)}</strong>
          </div>
        ))}
        {!bids.length && <p>لا توجد مزايدات حتى الآن.</p>}
      </div>
      {user?.roles.includes('user') && (
        <ActionLink className="text-link" to={routes.bids}>
          متابعة مزايداتي ونتائجها
        </ActionLink>
      )}
    </section>
  );
}
