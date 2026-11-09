/**
 * طلبات المزايدة مجمعة هنا: قراءة المزاد والعروض وإرسال عرض جديد إلى الخادم.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { api } from '../../api.js';

// Auction-specific API calls live here so bidding can evolve independently.
export const getAuction = (id) => api(`/api/auctions/${id}`);
export const getAuctionBids = (id) => api(`/api/auctions/${id}/bids`);
export const placeAuctionBid = (id, amount) =>
  api(`/api/auctions/${id}/bids`, {
    method: 'POST',
    body: JSON.stringify({ amount: Number(amount) }),
  });
