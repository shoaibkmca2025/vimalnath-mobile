import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/Button';
import { PasswordField, TextField } from '@/components/Field';
import { readSession, startSession } from '@/data/session';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign In · Vimalnath Admin';
  }, []);

  if (readSession()) return <Navigate to={from} replace />;

  const emailError = !email.trim() ? 'Enter your email address.' : !EMAIL.test(email.trim()) ? 'Enter an email address like name@company.com.' : null;
  const passwordError = !password ? 'Enter your password.' : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    if (emailError) return emailRef.current?.focus();
    if (passwordError) return passwordRef.current?.focus();
    setSubmitting(true);
    setFailure(null);
    try {
      await startSession(email.trim(), password);
      navigate(from, { replace: true });
    } catch (error) {
      setFailure((error as Error).message);
      setSubmitting(false);
      passwordRef.current?.focus();
      passwordRef.current?.select();
    }
  };

  return (
    <main className="auth">
      <div className="card auth__card">
        <div className="auth__brand">
          <img className="brand-mark" src="/logo-mark.png" alt="" width={56} height={56} />
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>Sign in to Vimalnath Admin</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              Manage the catalogue, orders and app content.
            </p>
          </div>
        </div>

        <form className="stack" onSubmit={submit} noValidate>
          <TextField
            ref={emailRef}
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            error={touched.email ? emailError : null}
            required
          />
          <PasswordField
            ref={passwordRef}
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, password: true }))}
            error={touched.password ? passwordError : null}
            required
          />
          {failure && (
            <p className="notice notice--warning" role="alert">
              {failure}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block loading={submitting} loadingLabel="Signing In…">
            Sign In
          </Button>
        </form>

        <p className="muted" style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
          Forgot your password? Ask the Owner for a new link.
        </p>
      </div>
    </main>
  );
}
