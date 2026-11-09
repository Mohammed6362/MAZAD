/**
 * يقرأ معرّف المزاد من الرابط ويركب لوحة المزايدة، مع إعادة ضبطها عند الانتقال لمزاد آخر.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useParams } from 'react-router-dom';
import BidPanel from './BidPanel.jsx';
export default function AuctionPage() {
  const { id } = useParams();
  return (
    <main className="page-main auction-page">
      <BidPanel key={id} auctionId={id} />
    </main>
  );
}
