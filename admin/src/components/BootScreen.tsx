import { WarningCircleIcon } from '@phosphor-icons/react';

/** Shown while the catalogue loads, or with a retry if it couldn't. */
export function BootScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="auth">
      <div className="empty" role={error ? 'alert' : 'status'} aria-live="polite">
        <img className="brand-mark" src="/logo-mark.png" alt="" width={56} height={56} style={{ width: 56, height: 56, borderRadius: 14 }} />
        {error ? (
          <>
            <p className="empty__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningCircleIcon size={20} weight="fill" color="var(--danger)" aria-hidden />
              Couldn’t load the admin
            </p>
            <p className="empty__body">{error} Check that the admin was started with npm run dev, then try again.</p>
            <button type="button" className="btn btn--primary" onClick={onRetry}>
              Try Again
            </button>
          </>
        ) : (
          <>
            <span className="spinner" style={{ color: 'var(--tint)', marginTop: 8 }} aria-hidden />
            <p className="muted">Loading…</p>
          </>
        )}
      </div>
    </main>
  );
}
