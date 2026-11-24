import { Navigate, Outlet, useLocation } from 'react-router';

import { readSession } from '@/data/session';
import { DataProvider } from '@/data/store';

/** The inventory team's pages: its pick list, the stock and its own password. Any other address goes to the pick list. */
const INVENTORY_PAGES = ['/inventory', '/stock', '/settings'];

/**
 * Sends people to sign in first, then back to the page they asked for. The catalogue only loads once
 * someone is signed in, so the sign-in page appears immediately.
 */
export function RequireSession() {
  const location = useLocation();
  const session = readSession();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // The menu hides the rest from them too, but an address typed in, a bookmark or a link must not open it.
  if (session.role === 'inventory' && !INVENTORY_PAGES.some((page) => location.pathname === page || location.pathname.startsWith(`${page}/`))) {
    return <Navigate to="/inventory" replace />;
  }
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}
