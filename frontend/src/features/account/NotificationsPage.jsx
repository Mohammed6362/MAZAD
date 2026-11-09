/**
 * قائمة إشعارات الحساب وروابطها؛ تسمح بتحديد إشعار أو القائمة كمقروءة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useState } from 'react';
import ActionLink from '../../components/ActionLink.jsx';
import { dateTime } from '../../api.js';
import { Notice, EmptyState } from '../../components/Feedback.jsx';
import { useNotifications } from './NotificationsContext.jsx';
export default function NotificationsPage({ audience = 'user' }) {
  const admin = audience === 'admin';
  const { items, unread, error, refresh, read } = useNotifications(audience);
  const Container = admin ? 'div' : 'main';
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // ينفذ تعليم الإشعار كمقروء ويعكس الانتظار أو رسالة الخطأ في الصفحة.
  async function mark(id) {
    setBusy(true);
    try {
      await read(id);
      setMessage('');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Container className={admin ? undefined : 'page-main'}>
      <div className="dashboard-heading">
        <div>
          <h1>{admin ? 'إشعارات الإدارة' : 'الإشعارات'}</h1>
          <p>{unread} إشعار غير مقروء — آخر 100 إشعار</p>
        </div>
        <div className="heading-actions">
          <button className="button button-quiet" onClick={refresh}>
            تحديث
          </button>
          <button className="button button-dark" disabled={busy || !unread} onClick={() => mark()}>
            تحديد الكل كمقروء
          </button>
        </div>
      </div>
      {(error || message) && <Notice>{message || error}</Notice>}
      <div className="record-list">
        {items.map((item) => (
          <article
            className={`record-card ${item.read_at ? '' : 'notification-unread'}`}
            key={item.id}
          >
            <div className="record-heading">
              <h2>{item.title}</h2>
              <time>{dateTime(item.created_at)}</time>
            </div>
            <p>{item.body}</p>
            <div className="heading-actions">
              <ActionLink className="text-link" to={item.link}>
                عرض التفاصيل
              </ActionLink>
              {!item.read_at && (
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() => mark(item.id)}
                >
                  تمت القراءة
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && !error && (
        <EmptyState
          title="لا توجد إشعارات حتى الآن"
          description={
            admin
              ? 'ستظهر هنا طلبات مراجعة السيارات والاعتراضات التي تتطلب إجراءً إداريًا.'
              : 'ستصلك هنا تحديثات مراجعة سياراتك وعروض المزاد ونتائج البيع.'
          }
        />
      )}
    </Container>
  );
}
