import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Loading, Notice } from '../../components/Feedback.jsx';

export default function OwnershipDocuments({ auctionId }) {
  const [state, setState] = useState({ loading: true, documents: [], error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, documents: [], error: '' });
    api(`/api/auctions/${auctionId}/ownership`)
      .then((result) => {
        if (active) setState({ loading: false, documents: result.documents, error: '' });
      })
      .catch((error) => {
        if (active) setState({ loading: false, documents: [], error: error.message });
      });
    return () => {
      active = false;
    };
  }, [auctionId, retry]);
  return (
    <section className="auction-ownership" aria-label="أوراق ملكية السيارة">
      <h2>أوراق ملكية السيارة</h2>
      <p className="muted-note">
        صور أوراق الملكية التي راجعتها الإدارة. اضغط على الصورة لفتحها بالحجم الكامل.
      </p>
      {state.loading ? (
        <Loading label="جارٍ تحميل أوراق الملكية…" />
      ) : state.error ? (
        <>
          <Notice>{state.error}</Notice>
          <button type="button" className="button button-quiet" onClick={() => setRetry(retry + 1)}>
            إعادة المحاولة
          </button>
        </>
      ) : state.documents.length ? (
        <div className="car-gallery ownership-gallery">
          {state.documents.map((doc, index) => (
            <a href={doc.url} key={doc.id} target="_blank" rel="noreferrer">
              <img src={doc.url} alt={`ورقة ملكية السيارة ${index + 1}`} loading="lazy" />
              <span>ورقة الملكية {index + 1} — فتح الصورة</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="muted-note">لا توجد صور أوراق ملكية متاحة لهذا المزاد.</p>
      )}
    </section>
  );
}
