import { serve } from '@hono/node-server';

import { buildApi } from './api.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { realSenders, startNotifier } from './notifications.ts';

/** The API as a long-running Node server (Docker, Render). On Neon Functions, function.ts serves it instead. */
const config = loadConfig();
const sql = connect(config.DATABASE_URL);
const app = buildApi(sql, config);

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => console.log(`API listening on port ${port}`));
const stopNotifier = startNotifier(sql, realSenders(config, sql));

// Let requests in flight finish before the host replaces this process.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopNotifier();
    server.close(() => void sql.end().then(() => process.exit(0)));
  });
}
