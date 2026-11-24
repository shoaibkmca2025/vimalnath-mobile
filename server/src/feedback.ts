import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

/** Feedback from the app's menu: a rating, a problem, a suggestion or anything else. */

const KINDS = ['problem', 'suggestion', 'feedback'] as const;
/** Enough for real use; stops a stuck button or a script from filling the table. */
const DAILY_LIMIT = 20;

// The app cuts free text to size rather than being refused, as the order sync does.
const Text = (max: number) => z.string().max(10_000).default('').transform((text) => text.trim().slice(0, max));

export const AppFeedback = z
  .object({
    rating: z.number().int('Choose 1 to 5 stars.').min(1, 'Choose 1 to 5 stars.').max(5, 'Choose 1 to 5 stars.').nullable().default(null),
    kind: z.enum(KINDS, 'Choose what it’s about.'),
    message: Text(2000),
    appVersion: Text(20),
    platform: Text(60),
  })
  .refine((feedback) => feedback.rating !== null || feedback.message, { message: 'Choose a rating or write a message.', path: ['message'] })
  .refine((feedback) => feedback.kind !== 'problem' || feedback.message, { message: 'Tell us what went wrong.', path: ['message'] });

/** Saves a customer's feedback. Up to DAILY_LIMIT a day from one account. */
export async function saveFeedback(sql: Sql, deviceId: number, feedback: z.output<typeof AppFeedback>) {
  const [{ today }] = (await sql`select count(*)::int as today from app_feedback where device_id = ${deviceId} and created_at > now() - interval '1 day'`) as unknown as [{ today: number }];
  if (today >= DAILY_LIMIT) throw new HTTPException(429, { message: 'Thanks, we have plenty from you today. Please send more tomorrow.' });
  await sql`
    insert into app_feedback ${sql({ device_id: deviceId, rating: feedback.rating, kind: feedback.kind, message: feedback.message, app_version: feedback.appVersion, platform: feedback.platform })}`;
}

/** /v1/admin/feedback: Owners and Sales read it and mark what they've done. */
export function feedbackAdminRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'sales'));

  // shortcut: the newest 1000, which the admin filters itself; page it on the server if people need to look further back.
  routes.get('/', async (c) =>
    c.json(
      await sql`
        select f.id::text as id, f.rating, f.kind, f.message, f.app_version as "appVersion", f.platform, f.status, f.staff_note as "staffNote",
          f.handled_by as "handledBy", f.handled_at as "handledAt", f.created_at as "createdAt",
          json_build_object('id', d.id, 'label', d.label, 'name', d.name, 'business', d.business, 'phone', d.phone) as "appUser",
          case when cu.id is not null then json_build_object('id', cu.id, 'name', cu.name) end as customer
        from app_feedback f
        join app_devices d on d.id = f.device_id
        left join customers cu on cu.id = coalesce((select merged_into from customers where id = d.customer_id), d.customer_id)
        order by f.created_at desc, f.id desc limit 1000`,
    ),
  );

  // For the red count in the sidebar.
  routes.get('/count', async (c) => {
    const [{ unread }] = (await sql`select count(*)::int as unread from app_feedback where status = 'new'`) as unknown as [{ unread: number }];
    return c.json({ new: unread });
  });

  routes.patch(
    '/:id',
    jsonBody(
      z
        .object({ status: z.enum(['new', 'seen', 'resolved'], 'Choose a status.').optional(), staffNote: z.string().trim().max(2000, 'Use 2,000 characters or fewer.').optional() })
        .refine((change) => change.status !== undefined || change.staffNote !== undefined, 'Nothing to change.'),
    ),
    async (c) => {
      const id = parse(z.coerce.number().int().positive().max(2147483647), c.req.param('id'));
      const change = c.req.valid('json');
      const [row] = await sql`
        update app_feedback set
          status = coalesce(${change.status ?? null}, status),
          staff_note = coalesce(${change.staffNote ?? null}, staff_note),
          handled_by = ${c.get('staff').name}, handled_at = now()
        where id = ${id} returning id`;
      if (!row) throw new HTTPException(404, { message: 'That feedback does not exist.' });
      return c.body(null, 204);
    },
  );

  return routes;
}
