import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { ToastContext, type ToastInput } from '@/components/useToast';

type ToastItem = ToastInput & { id: number };

const ICONS = { success: CheckCircleIcon, error: WarningCircleIcon, info: InfoIcon };

/**
 * Short confirmations ("Saved", "Order confirmed") in a polite live region, so they're announced without
 * stealing focus. Toasts with an Undo stay up longer.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.action ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const IconComponent = ICONS[toast.tone ?? 'success'];
          return (
            <div key={toast.id} className="toast">
              <IconComponent size={18} weight="fill" color={toast.tone === 'error' ? '#ff6961' : toast.tone === 'info' ? '#7399ff' : '#30d158'} aria-hidden />
              <span style={{ flex: 1 }}>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="toast__action"
                  onClick={() => {
                    toast.action!.onAction();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
