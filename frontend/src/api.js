/**
 * طبقة الاتصال بالخلفية؛ ترسل جلسة المستخدم، وتوحد أخطاء الشبكة، وتنسق الأسعار والأسماء والتواريخ.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { normalizeMake } from './data/carMakes.js';
const API_BASE = import.meta.env.VITE_API_URL || '';

// يرسل الطلب مع ملفات الجلسة ووقت انتظار محدد، ويميز انقطاع الشبكة عن أخطاء API ويرجع البيانات عند النجاح.
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch (cause) {
    throw new Error(
      cause.name === 'TimeoutError'
        ? 'استغرق الاتصال وقتًا طويلًا. أعد المحاولة.'
        : 'تعذّر الاتصال بالموقع. تأكد من تشغيل الواجهة والخلفية.',
      { cause },
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/api/login', '/api/me', '/api/register'].includes(path))
      window.dispatchEvent(new Event('mazad:unauthorized'));
    const error = new Error(payload.message || `تعذّر إكمال الطلب (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const money = (amount) =>
  amount == null
    ? '—'
    : `\u2066${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(amount))}\u2069 د.ل`;

export const carName = (car = {}) =>
  [normalizeMake(car.make), car.model, car.year].filter(Boolean).join(' ');

export const statusLabels = {
  pending_review: 'قيد المراجعة',
  approved: 'معتمدة',
  rejected: 'تحتاج إلى تعديل',
  sold: 'تم البيع',
  active: 'المزاد نشط',
  scheduled: 'قريبًا',
  closed: 'انتهى المزاد',
  ended: 'انتهى الوقت — بانتظار الإغلاق',
  cancelled: 'ملغي',
  pending: 'بانتظار السداد',
  paid: 'مسددة',
  disputed: 'قيد المراجعة',
};
export const dateTime = (value) =>
  value ? new Date(value).toLocaleString('ar-LY', { timeZone: 'Africa/Tripoli' }) : '—';
