import { useState } from 'react';

import { getAdminSyncStatus, logOut } from '@/lib/admin-sync';
import { confirmDestructive } from '@/lib/confirm';
import { clearProfilePhoto } from '@/lib/profile-photo';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { useOrders } from '@/providers/OrdersProvider';

/**
 * Logging out, after asking: sends anything waiting, signs this phone out at the shop, and removes the account's
 * orders, cart and photo from the phone. The app then shows the login screen. Used by Settings, the menu and the
 * User screen, so all three do the same thing.
 */
export function useLogOut() {
  const { showToast } = useAppUI();
  const { clear } = useCart();
  const { clearOrders } = useOrders();
  const [loggingOut, setLoggingOut] = useState(false);

  const confirmLogOut = () =>
    confirmDestructive('Log out?', 'Your order history and cart are removed from this phone. The shop keeps every order you sent.', 'Log Out', () => {
      void (async () => {
        setLoggingOut(true);
        try {
          await logOut();
          clearOrders();
          clear();
          await clearProfilePhoto();
          showToast(getAdminSyncStatus().error ?? 'You’re logged out.');
        } catch (error) {
          showToast(error instanceof Error ? error.message : 'Something went wrong. Try again.');
        } finally {
          setLoggingOut(false);
        }
      })();
    });

  return { confirmLogOut, loggingOut };
}
