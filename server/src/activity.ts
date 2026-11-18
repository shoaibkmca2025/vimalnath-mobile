import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Env } from './staff.ts';
import { jsonBody } from './validate.ts';

// The areas the admin's Activity page groups changes by.
const Entry = z.object({
  area: z.enum(['orders', 'catalogue', 'calculators', 'content', 'settings']),
  summary: z.string().trim().min(1).max(300),
  to: z.string().max(300).regex(/^\/[\w\-/?=&%.]*$/, 'That link is not a page in this admin.').optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

/**
 * Module 12.1, the activity log. The admin adds an entry after each change it saves; who and when come from the
 * session, never the request. There is no way to edit or delete an entry.
 */
export function activityRoutes(sql: Sql) {
  const activity = new Hono<Env>();

  // Owners see everyone's changes and the app's orders; Sales and Catalogue editors see their own.
  // shortcut: the newest 1000, searched and filtered in the admin; page it on the server when people need to look further back.
  activity.get('/activity', async (c) => {
    const staff = c.get('staff');
    return c.json(
      await sql`
        select id::text as id, at, by, area, summary, to_path as "to" from activity_log
        ${staff.role === 'owner' ? sql`` : sql`where staff_id = ${staff.id}`}
        order by at desc, id desc limit 1000`,
    );
  });

  // shortcut: sent after the save it records, so a connection lost between the two loses the entry. Write it in the
  // save's own transaction if the log must be complete, for example for an audit.
  activity.post('/activity', jsonBody(Entry), async (c) => {
    const staff = c.get('staff');
    const { area, summary, to, before, after } = c.req.valid('json');
    const [entry] = await sql`
      insert into activity_log ${sql({ staff_id: staff.id, by: staff.name, area, summary, to_path: to ?? null, before: before === undefined ? null : sql.json(before as never), after: after === undefined ? null : sql.json(after as never) })}
      returning id::text as id, at, by, area, summary, to_path as "to"`;
    return c.json(entry, 201);
  });

  return activity;
}
