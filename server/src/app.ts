import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

type Options = {
  adminOrigin: string;
  production: boolean;
  trustProxy: boolean;
  checkDatabase: () => Promise<unknown>;
  requestsPerMinute?: number;
};

/** Behind a proxy, the last X-Forwarded-For entry is the one the proxy added; earlier ones can be faked. */
export const clientOf = (c: Context, trustProxy: boolean) => (trustProxy && c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()) || getConnInfo(c).remote.address || 'unknown';

// shortcut: counts live in this process, so they reset on restart. Move them to the database when the API runs on more than one server.
function rateLimit(limit: number, keyOf: (c: Context) => string): MiddlewareHandler {
  let counts = new Map<string, number>();
  let resetAt = 0;
  return async (c, next) => {
    const now = Date.now();
    if (now >= resetAt) {
      // Starting a fresh map each window is what stops this growing forever.
      counts = new Map();
      resetAt = now + 60_000;
    }
    const client = keyOf(c);
    const used = (counts.get(client) ?? 0) + 1;
    counts.set(client, used);
    if (used > limit) {
      c.header('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      throw new HTTPException(429, { message: 'Too many requests. Please wait a minute and try again.' });
    }
    await next();
  };
}

export function createApp({ adminOrigin, production, trustProxy, checkDatabase, requestsPerMinute = 300 }: Options) {
  const app = new Hono();

  const limit = rateLimit(requestsPerMinute, (c) => clientOf(c, trustProxy));

  app.use(logger());
  const pageHeaders = secureHeaders();
  // The app and its web version show media from other addresses, so other sites may embed it.
  const mediaHeaders = secureHeaders({ crossOriginResourcePolicy: 'cross-origin' });
  app.use((c, next) => (c.req.path.startsWith('/v1/media/') ? mediaHeaders : pageHeaders)(c, next));
  if (production && trustProxy) {
    app.use(async (c, next) => {
      if (c.req.header('x-forwarded-proto') === 'http') throw new HTTPException(403, { message: 'This API only works over https.' });
      await next();
    });
  }
  const smallBodies = bodyLimit({
    maxSize: 1024 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'That request is too large.' });
    },
  });
  // An upload is the file itself; the largest allowed is a 25 MB price-list PDF.
  const uploads = bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'Choose a file under 25 MB.' });
    },
  });
  app.use('/v1/*', (c, next) => (c.req.path === '/v1/admin/media' ? uploads : smallBodies)(c, next));
  app.use('/v1/admin/*', cors({ origin: adminOrigin, credentials: true }));
  // The app sends a token, not a cookie, so any address may call it (its web version runs on its own).
  app.use('/v1/app/*', cors());
  app.use('/v1/admin/*', limit);
  app.use('/v1/app/*', limit);

  app.get('/v1/health', async (c) => {
    await checkDatabase().catch((error: unknown) => {
      console.error('Health check failed:', error);
      throw new HTTPException(503, { message: 'The database is not reachable.' });
    });
    return c.json({ status: 'ok' });
  });

  app.notFound((c) => c.json({ error: { message: 'That address does not exist.' } }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: { message: error.message, ...(error.cause as object | undefined) } }, error.status);
    console.error(error);
    return c.json({ error: { message: 'Something went wrong on our side. Please try again.' } }, 500);
  });

  return app;
}
