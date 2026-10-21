/**
 * Application routes.
 *
 * Public routes: browse reports and open a report's details.
 * Protected routes: everything that requires a session.
 * Admin routes: guarded on the client for experience AND on the server for
 * authority.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import { ProtectedRoute, AdminRoute } from './components/RouteGuards.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ItemsPage from './pages/ItemsPage.jsx';
import ItemDetailPage from './pages/ItemDetailPage.jsx';
import ReportItemPage from './pages/ReportItemPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import MyItemsPage from './pages/MyItemsPage.jsx';
import MatchesPage from './pages/MatchesPage.jsx';
import MyClaimsPage from './pages/MyClaimsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AdminItemsPage from './pages/AdminItemsPage.jsx';
import AdminClaimsPage from './pages/AdminClaimsPage.jsx';
import AdminAuditPage from './pages/AdminAuditPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Navbar />
      <main id="main" className="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/items" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/:itemId" element={<ItemDetailPage />} />

          <Route
            path="/report/:mode"
            element={
              <ProtectedRoute>
                <ReportItemPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-items"
            element={
              <ProtectedRoute>
                <MyItemsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matches"
            element={
              <ProtectedRoute>
                <MatchesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/claims"
            element={
              <ProtectedRoute>
                <MyClaimsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/items"
            element={
              <AdminRoute>
                <AdminItemsPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/claims"
            element={
              <AdminRoute>
                <AdminClaimsPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <AdminRoute>
                <AdminAuditPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminRoute>
                <AdminUsersPage />
              </AdminRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer className="footer">
        <p>
          Smart Lost &amp; Found — an academic DBMS project. Candidate match scores are advisory and do not prove
          ownership.
        </p>
      </footer>
    </>
  );
}

export default App;
