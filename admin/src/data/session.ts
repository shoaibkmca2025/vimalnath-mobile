import { api } from '@/lib/api';

export type Role = 'owner' | 'sales' | 'catalogue';
export type Session = { id: number; name: string; email: string; role: Role };

// Filled from the server before any signed-in page renders, so screens can read it without waiting.
let current: Session | null = null;

export const readSession = () => current;

/** Route loader: asks the server who is signed in. Any failure just means the sign-in page. */
export async function restoreSession() {
  current = await api<Session>('/me').catch(() => null);
  return null;
}

export async function startSession(email: string, password: string) {
  current = await api<Session>('/auth/sign-in', 'POST', { email, password });
}

export async function endSession() {
  await api('/auth/sign-out', 'POST').catch(() => {});
  current = null;
}
