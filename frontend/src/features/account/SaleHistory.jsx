/**
 * تحميل سجل أحداث الفاتورة عند الطلب؛ يربط السجل بنسخة بيانات المعاملة حتى لا يعرض أحداثًا قديمة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useState } from 'react';
import { api, dateTime } from '../../api.js';
import { Notice } from '../../components/Feedback.jsx';
export default function SaleHistory({ invoiceId, revision }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(null);
  // يحمّل أحداث الفاتورة عند الطلب ويربط النتيجة بمراجعة البيانات الحالية.
  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await api(`/api/invoices/${invoiceId}/events`);
      setEvents(result.events);
      setLoadedRevision(revision);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sale-history no-print">
      <button type="button" className="text-link" disabled={busy} onClick={load}>
        {busy ? 'جارٍ تحميل السجل…' : 'عرض / تحديث سجل المعاملة'}
      </button>
      {error && <Notice>{error}</Notice>}
      {events && loadedRevision === revision && (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <time>{dateTime(event.created_at)}</time>
              <p>{event.note}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
