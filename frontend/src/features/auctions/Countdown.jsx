/**
 * عداد المدة المتبقية؛ يحسب فرق ساعة الجهاز عن وقت الخادم ثم يعرض الأيام والساعات والثواني.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect, useState } from 'react';
export default function Countdown({
  target,
  label,
  serverTime,
  startTime,
  expiredLabel,
  className = '',
}) {
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(() =>
    serverTime ? new Date(serverTime).getTime() - Date.now() : 0,
  );
  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // يصفر العرض عند النهاية لتجنب مدة سالبة؛ هذا العداد لا يقرر قبول العروض في الخادم.
  const currentTime = now + offset;
  const startsAt = new Date(startTime).getTime();
  const endsAt = new Date(target).getTime();
  const waitingToStart = startsAt > currentTime;
  const seconds = Math.max(
    0,
    Math.ceil(((waitingToStart ? startsAt : endsAt) - currentTime) / 1000),
  );
  const days = Math.floor(seconds / 86400);
  const clock = [
    Math.floor((seconds % 86400) / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return (
    <p className={`auction-countdown ${className}`.trim()} role="timer" aria-live="off">
      {expiredLabel && endsAt <= currentTime ? (
        <span>{expiredLabel}</span>
      ) : (
        <>
          <span>{waitingToStart ? 'يبدأ المزاد بعد' : label}</span>{' '}
          <b dir="ltr">
            {days ? `${days} يوم ` : ''}
            {clock}
          </b>
        </>
      )}
    </p>
  );
}
