import type { Sql } from 'postgres';

import { activityRoutes } from './activity.ts';
import { createApp } from './app.ts';
import { appRoutes, appUserAdminRoutes } from './app-users.ts';
import { calculatorRoutes } from './calculators.ts';
import { catalogueRoutes } from './catalogue.ts';
import type { loadConfig } from './config.ts';
import { customerRoutes } from './customers.ts';
import { contentRoutes } from './content.ts';
import { mediaAdminRoutes, mediaRoutes } from './media.ts';
import { notificationRoutes } from './notifications.ts';
import { orderAdminRoutes } from './orders.ts';
import { adminRoutes } from './staff.ts';
import { versionRoutes } from './versions.ts';

/** The whole API, the same wherever it runs: a Node server (server.ts) or a Neon Function (function.ts). */
export function buildApi(sql: Sql, config: ReturnType<typeof loadConfig>) {
  const production = config.NODE_ENV === 'production';
  const app = createApp({
    adminOrigin: config.ADMIN_ORIGIN,
    production,
    trustProxy: config.TRUST_PROXY,
    proxySecret: config.PROXY_SECRET,
    checkDatabase: () => sql`select 1`,
  });
  const admin = adminRoutes(sql, { adminOrigin: config.ADMIN_ORIGIN, production, trustProxy: config.TRUST_PROXY });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/', catalogueRoutes(sql));
  admin.route('/', calculatorRoutes(sql));
  admin.route('/', contentRoutes(sql));
  admin.route('/', versionRoutes(sql));
  admin.route('/', activityRoutes(sql));
  admin.route('/notifications', notificationRoutes(sql, { email: Boolean(config.SMTP_URL) }));
  admin.route('/media', mediaAdminRoutes(sql));
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/customers', customerRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
  app.route('/v1/media', mediaRoutes(sql));
  return app;
}
