import { sign } from 'node:crypto';

/**
 * Firebase Cloud Messaging (HTTP v1), for the Android app. The server signs in as the Firebase project's service account
 * (FCM_SERVICE_ACCOUNT, the key JSON from Firebase, kept only in the server's settings), gets an hour's access token from
 * Google, and posts each message to one phone's FCM token. Nothing secret ever goes to the app.
 */

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };
export type FcmMessage = { token: string; title: string; body: string; data: Record<string, unknown> | null; badge: number };
/** FCM's answer that the token is no longer valid (the app was removed, or its data cleared). */
export class TokenGone extends Error {}

/** The key JSON as pasted, or base64 of it (easier to put in an environment variable). Throws on anything else. */
export function readServiceAccount(text: string): ServiceAccount {
  const json = text.trim().startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
  const account = JSON.parse(json) as Partial<ServiceAccount>;
  if (!account.project_id || !account.client_email || !account.private_key?.includes('PRIVATE KEY')) throw new Error('FCM_SERVICE_ACCOUNT is not a Firebase service account key.');
  return { project_id: account.project_id, client_email: account.client_email, private_key: account.private_key };
}

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A signed JWT asking Google for a token to send messages (RFC 7523), valid an hour. */
export function assertion(account: ServiceAccount, now = Math.floor(Date.now() / 1000)) {
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), account.private_key).toString('base64url')}`;
}

/** FCM's data values must all be strings. */
const strings = (data: Record<string, unknown> | null) => Object.fromEntries(Object.entries(data ?? {}).flatMap(([key, value]) => (value === null || value === undefined ? [] : [[key, typeof value === 'string' ? value : JSON.stringify(value)]])));

/** The body FCM wants for one phone: the alert, where a tap goes, its channel, the icon's count, lock-screen privacy. */
export function fcmBody(message: FcmMessage) {
  const data = strings(message.data);
  return {
    message: {
      token: message.token,
      notification: { title: message.title, body: message.body },
      data: { ...data, badge: String(message.badge) },
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: data.channel ?? 'announcements-alert',
          notification_count: message.badge,
          // Payments, bills and returns show "Contents hidden" on a locked phone.
          visibility: data.private ? 'PRIVATE' : 'PUBLIC',
          // One per notification: a resend replaces it rather than showing it twice.
          tag: data.notificationId ? `n${data.notificationId}` : undefined,
          ...(data.channel?.endsWith('-alert') || data.channel?.endsWith('-sound') ? { default_sound: true } : {}),
        },
      },
    },
  };
}

/** A sender for FCM tokens; it keeps its access token until shortly before it runs out. */
export function fcmSender(account: ServiceAccount, fetchImpl: typeof fetch = fetch) {
  let cached: { token: string; until: number } | null = null;
  const accessToken = async () => {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(account) }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const answer = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
    if (!res.ok || !answer?.access_token) throw new Error(`Google refused the Firebase key: ${answer?.error_description ?? res.status}.`);
    cached = { token: answer.access_token, until: Date.now() + (answer.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
  return async (message: FcmMessage) => {
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmBody(message)),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return;
    const answer = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null;
    const code = answer?.error?.details?.find((detail) => detail.errorCode)?.errorCode ?? answer?.error?.status;
    // The phone no longer has this token: stop sending to it.
    if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(answer?.error?.message ?? ''))) throw new TokenGone('This phone no longer accepts notifications.');
    // The access token ran out early or was revoked: get a new one next time.
    if (res.status === 401) cached = null;
    throw new Error(`FCM answered ${res.status}${code ? ` (${code})` : ''}.`);
  };
}
