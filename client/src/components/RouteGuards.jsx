/**
 * Route guards.
 *
 * These protect client routes for user experience only; the backend re-checks
 * authentication and roles on every request (spec 15: "Protected client routes
 * for user experience, with backend authorization remaining authoritative").
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from './Feedback.jsx';

export function ProtectedRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function AdminRoute({ children }) {
  const { status, isAdmin } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!isAdmin) {
    return (
      <div className="state state--error" role="alert">
        <strong>Administrator access required.</strong>
        <p>Your account does not have permission to view this area.</p>
      </div>
    );
  }
  return children;
}

export default { ProtectedRoute, AdminRoute };
