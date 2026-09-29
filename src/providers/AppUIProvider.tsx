import { router } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { MenuDrawer } from '@/components/MenuDrawer';
import { Toast, useToastController } from '@/components/Toast';

type AppUI = {
  showToast: (message: string) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const AppUIContext = createContext<AppUI | null>(null);

export function AppUIProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toast = useToastController();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const value = useMemo(() => ({ showToast: toast.show, openDrawer, closeDrawer }), [toast.show, openDrawer, closeDrawer]);

  const openCart = useCallback(() => {
    setDrawerOpen(false);
    router.push('/cart');
  }, []);

  return (
    <AppUIContext.Provider value={value}>
      {children}
      <Toast controller={toast} />
      <MenuDrawer visible={drawerOpen} onClose={closeDrawer} onEnquiry={openCart} />
    </AppUIContext.Provider>
  );
}

export function useAppUI() {
  const context = useContext(AppUIContext);
  if (!context) throw new Error('useAppUI must be used inside AppUIProvider');
  return context;
}
