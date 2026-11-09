/**
 * شجرة صفحات الموقع؛ تفصل الصفحات العامة وصفحات الحساب والإدارة، وتحول الروابط القديمة إلى المسارات الموحدة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { useEffect } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import SiteHeader from './components/SiteHeader.jsx';
import Footer from './components/Footer.jsx';
import RequireRole from './features/auth/RequireRole.jsx';
import LoginPage from './features/auth/pages/LoginPage.jsx';
import RegisterPage from './features/auth/pages/RegisterPage.jsx';
import HomePage from './features/cars/pages/HomePage.jsx';
import CarDetailsPage from './features/cars/pages/CarDetailsPage.jsx';
import SubmitCarPage from './features/account/SubmitCarPage.jsx';
import MyCarsPage from './features/account/MyCarsPage.jsx';
import MyBidsPage from './features/account/MyBidsPage.jsx';
import AccountPage from './features/account/AccountPage.jsx';
import WalletPage from './features/account/WalletPage.jsx';
import AuctionRulesPage from './features/auctions/AuctionRulesPage.jsx';
import InvoicesPage from './features/account/InvoicesPage.jsx';
import SettingsPage from './features/account/SettingsPage.jsx';
import NotificationsPage from './features/account/NotificationsPage.jsx';
import AdminReviewPage from './features/admin/pages/AdminReviewPage.jsx';
import AdminAuctionsPage from './features/admin/pages/AdminAuctionsPage.jsx';
import AdminInvoicesPage from './features/admin/pages/AdminInvoicesPage.jsx';
import AdminDashboardPage from './features/admin/pages/AdminDashboardPage.jsx';
import AdminUsersPage from './features/admin/pages/AdminUsersPage.jsx';
import AuctionPage from './features/auctions/AuctionPage.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import { routes } from './routes.js';
import { connectRealtime } from './realtime.js';
// يجمع رأس الموقع ومحتوى الصفحة الحالية وتذييلها دون تكرارها في كل مسار.
function SiteLayout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
      <Footer />
    </>
  );
}
// يمنع فتح صفحات الإدارة دون دور admin ثم يركب إطار لوحة الإدارة حول الصفحة.
function ProtectedAdmin() {
  return (
    <RequireRole role="admin">
      <AdminLayout>
        <Outlet />
      </AdminLayout>
    </RequireRole>
  );
}
// يحوّل رابطًا قديمًا إلى وجهته الجديدة، مع الحفاظ على معرّف العنصر ووجهة العودة إن وجدا.
function LegacyRedirect({ to }) {
  const { id } = useParams();
  const { state } = useLocation();
  return <Navigate to={typeof to === 'function' ? to(id) : to} state={state} replace />;
}
// بعد تغير الرابط يعيد موضع الصفحة للأعلى أو ينتقل للقسم المطلوب بالوسم داخل الصفحة.
function ScrollToPage() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash)
      requestAnimationFrame(() =>
        document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }),
      );
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}
export default function App() {
  useEffect(() => connectRealtime(), []);
  return (
    <>
      <ScrollToPage />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path={routes.auctionRules} element={<AuctionRulesPage />} />
          <Route
            path={routes.wallet}
            element={
              <RequireRole role="user">
                <WalletPage />
              </RequireRole>
            }
          />
          <Route path="cars/:id" element={<CarDetailsPage />} />
          <Route path="auctions/:id" element={<AuctionPage />} />
          <Route
            path={routes.account}
            element={
              <RequireRole>
                <AccountPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.cars}
            element={
              <RequireRole role="user">
                <MyCarsPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.submitCar}
            element={
              <RequireRole role="user">
                <SubmitCarPage />
              </RequireRole>
            }
          />
          <Route
            path="/account/cars/:id/edit"
            element={
              <RequireRole role="user">
                <SubmitCarPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.bids}
            element={
              <RequireRole role="user">
                <MyBidsPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.invoices}
            element={
              <RequireRole>
                <InvoicesPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.settings}
            element={
              <RequireRole>
                <SettingsPage />
              </RequireRole>
            }
          />
          <Route
            path={routes.notifications}
            element={
              <RequireRole>
                <NotificationsPage />
              </RequireRole>
            }
          />
          <Route element={<ProtectedAdmin />}>
            <Route
              path={routes.adminNotifications}
              element={<NotificationsPage audience="admin" />}
            />
            <Route path={routes.adminDashboard} element={<AdminDashboardPage />} />
            <Route path={routes.adminReview} element={<AdminReviewPage />} />
            <Route path={routes.adminAuctions} element={<AdminAuctionsPage />} />
            <Route path={routes.adminInvoices} element={<AdminInvoicesPage />} />
            <Route
              path={routes.adminUsers}
              element={
                <RequireRole role="admin" permission="is_primary_admin">
                  <AdminUsersPage />
                </RequireRole>
              }
            />
          </Route>
          <Route
            path="*"
            element={
              <main className="page-main">
                <h1>الصفحة غير موجودة</h1>
                <Link className="button button-dark" to={routes.home}>
                  العودة للرئيسية
                </Link>
              </main>
            }
          />
        </Route>
        <Route path={routes.login} element={<LoginPage />} />
        <Route path={routes.register} element={<RegisterPage />} />
        <Route path={routes.adminLogin} element={<LegacyRedirect to={routes.login} />} />
        <Route path="/buyer/login" element={<LegacyRedirect to={routes.login} />} />
        <Route path="/seller/login" element={<LegacyRedirect to={routes.login} />} />
        <Route path="/buyer/register" element={<LegacyRedirect to={routes.register} />} />
        <Route path="/seller/register" element={<LegacyRedirect to={routes.register} />} />
        <Route path="/buyer/bids" element={<LegacyRedirect to={routes.bids} />} />
        <Route path="/seller/cars" element={<LegacyRedirect to={routes.cars} />} />
        <Route path="/seller/submit" element={<LegacyRedirect to={routes.submitCar} />} />
        <Route path="/seller/cars/:id/edit" element={<LegacyRedirect to={routes.editCar} />} />
        <Route path="/buyer" element={<LegacyRedirect to={routes.account} />} />
        <Route path="/seller" element={<LegacyRedirect to={routes.account} />} />
        <Route path="/admin" element={<LegacyRedirect to={routes.adminDashboard} />} />
      </Routes>
    </>
  );
}
