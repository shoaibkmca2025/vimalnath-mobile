import { buildApi } from './api.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { realSenders, sendQueued } from './notifications.ts';
import { runScheduled } from './notify.ts';

/**
 * The API as a Neon Function, next to the database (see deploy/README.md). Neon runs `export default app`; there is
 * no long-lived process, so instead of the server's 10-second sender a scheduled trigger calls /internal/notify.
 */
const config = loadConfig();
// Neon injects DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED. Each instance holds a few direct connections.
const sql = connect(process.env.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL, 5);
const senders = realSenders(config, sql);
const app = buildApi(sql, config);

// Outside /v1, so the Worker's secret isn't needed: Neon strips X-Neon-* headers from callers, so this one proves the
// call is Neon's own schedule. Sending twice is safe: each message is claimed once.
app.post('/internal/notify', async (c) => {
  if (!c.req.header('x-neon-trigger-invocation-id')) return c.json({ error: { message: 'Not a scheduled call.' } }, 401);
  const sent = await sendQueued(sql, senders);
  // Payment reminders and clearing old notifications, each at its own pace (hourly, daily).
  await runScheduled(sql);
  return c.json({ sent });
});

export default app;
