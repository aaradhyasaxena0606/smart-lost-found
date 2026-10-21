/**
 * Application navigation.
 *
 * Shows the unread notification count, role-appropriate links, and a clearly
 * labelled sign-out. Keyboard focus styles come from the shared stylesheet.
 */
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationsApi } from '../api/endpoints.js';

export function Navbar() {
  const { isAuthenticated, isAdmin, user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnread(0);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await notificationsApi.unreadCount();
        if (!cancelled) setUnread(data.unreadCount);
      } catch {
        /* a badge failure must never break navigation */
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) => (isActive ? 'nav__link nav__link--active' : 'nav__link');

  return (
    <header className="nav">
      <div className="nav__inner">
        <Link to="/" className="nav__brand">
          Smart Lost &amp; Found
        </Link>

        <nav aria-label="Main navigation" className="nav__links">
          <NavLink to="/items" className={linkClass}>
            Browse reports
          </NavLink>
          <NavLink to="/report/lost" className={linkClass}>
            Report lost
          </NavLink>
          <NavLink to="/report/found" className={linkClass}>
            Report found
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink to="/dashboard" className={linkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/matches" className={linkClass}>
                Matches
              </NavLink>
              <NavLink to="/claims" className={linkClass}>
                My claims
              </NavLink>
              <NavLink to="/notifications" className={linkClass}>
                Notifications{unread > 0 ? <span className="nav__badge">{unread}</span> : null}
              </NavLink>
            </>
          ) : null}

          {isAdmin ? (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          ) : null}
        </nav>

        <div className="nav__account">
          {isAuthenticated ? (
            <>
              <span className="nav__user" title={user?.email}>
                {user?.fullName}
                {isAdmin ? ' (admin)' : ''}
              </span>
              <button type="button" className="button button--secondary button--small" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className="button button--secondary button--small" to="/login">
                Sign in
              </Link>
              <Link className="button button--small" to="/register">
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
