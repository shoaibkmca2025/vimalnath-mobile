const UNREACHABLE = 'Couldn’t reach the server. Check your connection and try again.';

export class ApiError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

// shortcut: same-origin only (Vite proxies /v1 here). Once hosting is chosen, serve /v1 on the admin's domain or add a base URL.
export async function api<T = void>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/v1/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new ApiError(UNREACHABLE);
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  // Signed out mid-use: reloading asks the server again, which leads to sign-in and then back to this page.
  if (response.status === 401 && path !== '/me' && path !== '/auth/sign-in') window.location.reload();
  // No JSON means a proxy or the host answered, not the API.
  if (!response.ok) throw new ApiError(data?.error?.message ?? UNREACHABLE, data?.error?.field);
  return data as T;
}
