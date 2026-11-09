/**
 * مرجع عناوين الصفحات ووجهات الدخول؛ يتحقق من رابط العودة حتى يبقى التنقل داخل الموقع.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
export const routes = {
  home: '/',
  login: '/login',
  register: '/register',
  account: '/account',
  cars: '/account/cars',
  bids: '/account/bids',
  submitCar: '/account/cars/new',
  editCar: (id) => '/account/cars/' + id + '/edit',
  invoices: '/account/invoices',
  settings: '/account/settings',
  notifications: '/account/notifications',
  wallet: '/account/wallet',
  auctionRules: '/auction-rules',
  adminLogin: '/admin/login',
  adminReview: '/admin/review',
  adminAuctions: '/admin/auctions',
  adminListings: '/admin/auctions#approved-listings',
  adminInvoices: '/admin/invoices',
  adminDashboard: '/admin/dashboard',
  adminUsers: '/admin/users',
  adminNotifications: '/admin/notifications',
  car: (id) => '/cars/' + id,
  auction: (id) => '/auctions/' + id,
};
export const roleHome = { user: routes.account, admin: routes.adminDashboard };
export const loginPath = { user: routes.login, admin: routes.adminLogin };
// يقبل مسارًا داخليًا فقط لوجهة العودة بعد الدخول، ويرفض الروابط الخارجية أو الملتبسة.
export function safeReturnTo(value, fallback = '/') {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : fallback;
}
