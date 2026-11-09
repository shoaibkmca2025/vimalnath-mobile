import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { Button, ButtonLink } from '@/components/Button';
import { PasswordField } from '@/components/Field';
import { api, type ApiError } from '@/lib/api';

/** Where a one-time link from the Owner lands, for new staff and for anyone who forgot their password. */
export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Set Password · Vimalnath Admin';
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await api('/auth/set-password', 'POST', { token: params.get('token') ?? '', password });
      setDone(true);
    } catch (error) {
      setFailure(error as ApiError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="auth">
      <div className="card auth__card">
        <div className="auth__brand">
          <img className="brand-mark" src="/logo-mark.png" alt="" width={56} height={56} />
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>{done ? 'Your password is set' : 'Set your password'}</h1>
        </div>
        {done ? (
          <ButtonLink to="/login" variant="primary" size="lg" block>
            Sign In
          </ButtonLink>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            <PasswordField label="New password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="At least 10 characters." error={failure?.field === 'password' ? failure.message : null} required />
            {failure && failure.field !== 'password' && (
              <p className="notice notice--warning" role="alert">
                {failure.message}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" block loading={saving} loadingLabel="Saving…">
              Set Password
            </Button>
            <ButtonLink to="/login" variant="plain" block>
              Back to Sign In
            </ButtonLink>
          </form>
        )}
      </div>
    </main>
  );
}
