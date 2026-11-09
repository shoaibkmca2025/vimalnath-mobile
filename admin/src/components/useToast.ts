import { createContext, useContext } from 'react';

export type ToastInput = { message: string; tone?: 'success' | 'error' | 'info'; action?: { label: string; onAction: () => void } };

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Shows a short confirmation, optionally with an Undo-style action. */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
