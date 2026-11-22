/**
 * Shared chrome for every administrator page.
 *
 * The dashboard used to be the only place listing the four admin areas, so after
 * opening "Moderate reports" there was no visible way to move to Claims, Audit or
 * Accounts without going back. These tabs are rendered by the route layout, so
 * every admin page can switch to any other in one click.
 */
import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/claims', label: 'Claim appeals' },
  { to: '/admin/items', label: 'Moderate reports' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/users', label: 'Accounts' },
];

export function AdminLayout() {
  return (
    <>
      <nav className="admin-tabs" aria-label="Administration sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'admin-tab admin-tab--active' : 'admin-tab')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

export default AdminLayout;
