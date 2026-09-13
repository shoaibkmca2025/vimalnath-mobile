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

  // The drawer is a native Modal that would cover the toast, so close it before showing feedback.
  const openEnquiry = useCallback(() => {
    setDrawerOpen(false);
    toast.show('Your enquiry list is empty.');
  }, [toast.show]);

  return (
    <AppUIContext.Provider value={value}>
      {children}
      <Toast controller={toast} />
      <MenuDrawer visible={drawerOpen} onClose={closeDrawer} onEnquiry={openEnquiry} />
    </AppUIContext.Provider>
  );
}

export function useAppUI() {
  const context = useContext(AppUIContext);
  if (!context) throw new Error('useAppUI must be used inside AppUIProvider');
  return context;
}
