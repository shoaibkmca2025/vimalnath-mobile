import { Navigate, Outlet, useLocation } from 'react-router';

import { readSession } from '@/data/session';
import { DataProvider } from '@/data/store';

/**
 * Sends people to sign in first, then back to the page they asked for. The catalogue only loads once
 * someone is signed in, so the sign-in page appears immediately.
 */
export function RequireSession() {
  const location = useLocation();
  if (!readSession()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}
