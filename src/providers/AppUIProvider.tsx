import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { Toast, useToastController } from '@/components/Toast';

type AppUI = {
  showToast: (message: string) => void;
};

const AppUIContext = createContext<AppUI | null>(null);

export function AppUIProvider({ children }: { children: ReactNode }) {
  const toast = useToastController();
  const value = useMemo(() => ({ showToast: toast.show }), [toast.show]);

  return (
    <AppUIContext.Provider value={value}>
      {children}
      <Toast controller={toast} />
    </AppUIContext.Provider>
  );
}

export function useAppUI() {
  const context = useContext(AppUIContext);
  if (!context) throw new Error('useAppUI must be used inside AppUIProvider');
  return context;
}
