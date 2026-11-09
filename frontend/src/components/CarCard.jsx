/**
 * بطاقة إعلان السيارة؛ تعرض الصورة والسعر وحالة المزاد والروابط إلى التفاصيل والمزايدة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { ArrowUpLeft, Gauge, MapPin, Timer, Zap } from 'lucide-react';
import ActionLink from './ActionLink.jsx';
import { carName, money, statusLabels } from '../api.js';
import { normalizeMake } from '../data/carMakes.js';
import Countdown from '../features/auctions/Countdown.jsx';

const fallback =
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1000&q=85';

export default function CarCard({ car }) {
  const auctionStatus = car.auction_status || car.auctionStatus || 'awaiting';
  const hasCountdown =
    ['active', 'scheduled', 'ended'].includes(auctionStatus) &&
    Number.isFinite(Date.parse(car.end_time));
  return (
    <article className="car-card">
      <ActionLink
        className="car-card-image"
        to={`/cars/${car.id}`}
        aria-label={`تفاصيل ${carName(car)}`}
      >
        <img src={car.image_url || car.imageUrl || fallback} alt={carName(car)} loading="lazy" />
        <span className={`auction-pill ${auctionStatus === 'active' ? 'pill-active' : ''}`}>
          <i />
          {statusLabels[auctionStatus] || 'بانتظار المزاد'}
        </span>
        <span className="image-count">
          {car.image_count ? `+${car.image_count}` : 'صور السيارة'}
        </span>
      </ActionLink>
      <div className="car-card-body">
        <div className="car-card-heading">
          <div>
            <span className="car-make">{normalizeMake(car.make) || 'سيارة مميزة'}</span>
            <h3>{carName(car)}</h3>
          </div>
          <ActionLink className="round-arrow" to={`/cars/${car.id}`} aria-label="عرض التفاصيل">
            <ArrowUpLeft size={18} />
          </ActionLink>
        </div>
        <div className="car-specs">
          <span>
            <Gauge size={15} />
            {car.mileage_km == null
              ? 'المسافة غير محددة'
              : `${new Intl.NumberFormat('ar-LY').format(car.mileage_km)} كم`}
          </span>
          <span>
            <MapPin size={15} />
            {car.location || 'ليبيا'}
          </span>
        </div>
        <div className="car-card-bottom">
          <div>
            <small>{auctionStatus === 'active' ? 'السعر الحالي' : 'السعر الابتدائي'}</small>
            <strong>
              {car.current_price || car.starting_price
                ? money(car.current_price || car.starting_price)
                : 'يُحدد قريبًا'}
            </strong>
          </div>
          <span className="bid-count">
            <Zap size={14} />
            {car.bid_count || 0} مزايدة
          </span>
        </div>
        <div className="car-card-timer" aria-label="وقت المزاد">
          <Timer size={18} aria-hidden="true" />
          {hasCountdown ? (
            <Countdown
              target={car.end_time}
              startTime={car.start_time}
              serverTime={car.server_time}
              label="متبقي على نهاية المزاد"
              expiredLabel="انتهى المزاد"
              className="car-card-countdown"
            />
          ) : (
            <p>
              {auctionStatus === 'cancelled'
                ? 'المزاد ملغي'
                : auctionStatus === 'closed'
                  ? 'انتهى المزاد'
                  : 'بانتظار تحديد موعد المزاد'}
            </p>
          )}
        </div>
        <ActionLink className="car-card-cta" to={`/cars/${car.id}`}>
          تفاصيل السيارة <ArrowUpLeft size={18} />
        </ActionLink>
      </div>
    </article>
  );
}
