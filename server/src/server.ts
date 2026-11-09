import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { adminRoutes } from './staff.ts';

const config = loadConfig();
const sql = connect(config.DATABASE_URL);
const production = config.NODE_ENV === 'production';
const app = createApp({
  adminOrigin: config.ADMIN_ORIGIN,
  production,
  trustProxy: config.TRUST_PROXY,
  checkDatabase: () => sql`select 1`,
});
app.route('/v1/admin', adminRoutes(sql, { adminOrigin: config.ADMIN_ORIGIN, production, trustProxy: config.TRUST_PROXY }));

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => console.log(`API listening on port ${port}`));

// Let requests in flight finish before the host replaces this process.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => void sql.end().then(() => process.exit(0))));
}
