import type { Sql, TransactionSql } from 'postgres';

import type { Role } from './staff.ts';

/**
 * The notification center. A change that should tell someone calls notifyCustomer or notifyStaff inside its own
 * transaction: the notification is saved with it (or not at all), and a customer's pushes are queued, one per phone, for
 * the sender (notifications.ts sendQueued). An event key makes each event notify each person once, however often it's
 * raised (a retried request, a double click). A category someone turned off is still listed, already read: no alert, no
 * badge.
 */

export const CATEGORIES = ['orders', 'payments', 'inventory', 'billing', 'returns', 'customers', 'announcements', 'system'] as const;
export type Category = (typeof CATEGORIES)[number];
/** The ones a person can turn off; system alerts always come. */
export const PREFERENCE_CATEGORIES = ['orders', 'payments', 'inventory', 'billing', 'returns', 'customers', 'announcements'] as const;
type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];
/** On a locked phone these show only "Contents hidden" (Android's private visibility): amounts stay off the lock screen. */
const PRIVATE: ReadonlySet<Category> = new Set(['payments', 'billing', 'returns']);

type Db = Sql | TransactionSql;
type Values = Record<string, string | number | null | undefined>;
/** What a notification is about and where a tap goes (an app route, or an admin page). */
export type Link = { entityType?: string; entityId?: string | number | null; data?: Record<string, string> };
export type Who = { accountId: number } | { staffId: number };

export const rupees = (amount: number) => `₹${(Math.round(amount * 100) / 100).toLocaleString('en-IN')}`;

/** Fills {placeholders}; one with no value becomes empty, and the spaces it leaves are tidied. */
export const fill = (text: string, values: Values) =>
  text
    .replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key] ?? '') : match))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();

const owner = (who: Who) => ('accountId' in who ? { account_id: who.accountId } : { staff_id: who.staffId });
const whoIs = (db: Db, who: Who) => ('accountId' in who ? db`account_id = ${who.accountId}` : db`staff_id = ${who.staffId}`);

export type Preferences = Record<`${PreferenceCategory}_enabled` | 'sound_enabled' | 'vibration_enabled', boolean>;
const DEFAULTS = Object.fromEntries([...PREFERENCE_CATEGORIES.map((category) => `${category}_enabled`), 'sound_enabled', 'vibration_enabled'].map((key) => [key, true])) as Preferences;

export async function preferencesOf(db: Db, who: Who): Promise<Preferences> {
  const [row] = await db`select * from notification_preferences where ${whoIs(db, who)}`;
  return row ? (Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, row[key] as boolean])) as Preferences) : { ...DEFAULTS };
}

export async function savePreferences(db: Db, who: Who, changes: Partial<Preferences>) {
  const next = { ...(await preferencesOf(db, who)), ...changes };
  const target = 'accountId' in who ? db`(account_id)` : db`(staff_id)`;
  await db`
    insert into notification_preferences ${db({ ...owner(who), ...next, updated_at: new Date() })}
    on conflict ${target} do update set ${db(next)}, updated_at = now()`;
  return next;
}

const enabled = (preferences: Preferences, category: Category) => category === 'system' || preferences[`${category}_enabled`] !== false;

/**
 * The Android channel a push goes to: one per category and sound/vibration choice ("orders-alert", "payments-silent"…),
 * since a channel's sound can't change once made. The app makes the channels for the person's current choice.
 */
export function channelOf(category: Category, preferences: Preferences) {
  const variant = preferences.sound_enabled ? (preferences.vibration_enabled ? 'alert' : 'sound') : preferences.vibration_enabled ? 'vibrate' : 'silent';
  return `${category}-${variant}`;
}

type Template = { audience: 'customer' | 'staff'; category: Category; title: string; body: string };
async function templateOf(db: Db, event: string) {
  const [row] = await db<Template[]>`select audience, category, title, body from notification_templates where event = ${event}`;
  return row;
}

type Draft = { event: string; category: Category; title: string; message: string; link: Link; key?: string; announcementId?: number; orderId?: number | null };

/** One notification for one customer, and a push to each of their phones (unless they turned the category off). */
async function deliverToCustomer(db: Db, accountId: number, draft: Draft) {
  const preferences = await preferencesOf(db, { accountId });
  const on = enabled(preferences, draft.category);
  const data = { ...(draft.link.data ?? {}) };
  const [row] = await db`
    insert into notifications ${db({
      account_id: accountId,
      event: draft.event,
      category: draft.category,
      title: draft.title,
      message: draft.message,
      entity_type: draft.link.entityType ?? null,
      entity_id: draft.link.entityId === undefined || draft.link.entityId === null ? null : String(draft.link.entityId),
      data: db.json(data),
      event_key: draft.key ?? null,
      announcement_id: draft.announcementId ?? null,
      is_read: !on,
      read_at: on ? null : new Date(),
    })}
    on conflict do nothing
    returning id`;
  if (!row || !on) return row ? Number(row.id) : null;
  const tokens = await db`select id, token from device_tokens where account_id = ${accountId}`;
  if (tokens.length)
    await db`
      insert into notification_log ${db(
        tokens.map((token) => ({
          event: draft.event,
          channel: 'push',
          recipient: token.token as string,
          device_id: accountId,
          order_id: draft.orderId ?? null,
          title: draft.title,
          body: draft.message,
          data: db.json({ ...data, notificationId: String(row.id), category: draft.category, channel: channelOf(draft.category, preferences), private: PRIVATE.has(draft.category) ? '1' : '' }),
          notification_id: row.id,
          device_token_id: token.id,
        })),
      )}`;
  return Number(row.id);
}

/**
 * Tells a customer (an app account) about an event, in its template's words. Nothing for an order with no app account,
 * an event without a template, or one already told (same key).
 */
export async function notifyCustomer(db: Db, accountId: number | null | undefined, event: string, values: Values, link: Link = {}, key?: string, orderId?: number | null) {
  if (!accountId) return null;
  const template = await templateOf(db, event);
  if (!template || template.audience !== 'customer') return null;
  return deliverToCustomer(db, accountId, { event, category: template.category, title: fill(template.title, values), message: fill(template.body, values), link, key, orderId });
}

/** Every customer account linked to a customer record (a counter bill's buyer can have more than one). */
export async function accountsOfCustomer(db: Db, customerId: number | null | undefined) {
  if (!customerId) return [];
  const rows = await db`
    select id from app_devices
    where not blocked and coalesce((select merged_into from customers where id = customer_id), customer_id) = coalesce((select merged_into from customers where id = ${customerId}), ${customerId})
    order by id`;
  return rows.map((row) => row.id as number);
}

export type StaffTarget = { roles: Role[]; except?: { id?: number; name?: string }; staffIds?: number[] };

/**
 * Tells staff about an event, in the admin's notification center: everyone active in the given roles (Owners always), or
 * the people named, except whoever did it.
 */
export async function notifyStaff(db: Db, event: string, values: Values, link: Link, target: StaffTarget, key?: string) {
  const template = await templateOf(db, event);
  if (!template || template.audience !== 'staff') return 0;
  const roles = [...new Set<Role>(['owner', ...target.roles])];
  const people = await db`
    select id from staff_users
    where active and ${target.staffIds ? db`id in ${db(target.staffIds.length ? target.staffIds : [0])}` : db`role in ${db(roles)}`}
      and id <> ${target.except?.id ?? 0} ${target.except?.name ? db`and name <> ${target.except.name}` : db``}
    order by id`;
  const draft: Draft = { event, category: template.category, title: fill(template.title, values), message: fill(template.body, values), link, key };
  let told = 0;
  for (const person of people) {
    const preferences = await preferencesOf(db, { staffId: person.id as number });
    const on = enabled(preferences, draft.category);
    const [row] = await db`
      insert into notifications ${db({
        staff_id: person.id as number,
        event,
        category: draft.category,
        title: draft.title,
        message: draft.message,
        entity_type: link.entityType ?? null,
        entity_id: link.entityId === undefined || link.entityId === null ? null : String(link.entityId),
        data: db.json(link.data ?? {}),
        event_key: key ?? null,
        is_read: !on,
        read_at: on ? null : new Date(),
      })}
      on conflict do nothing
      returning id`;
    if (row) told += 1;
  }
  return told;
}

// ---------- Announcements ----------

export type Announcement = { audience: 'customers' | 'staff'; accountIds?: number[]; roles?: Role[]; category: Category; title: string; body: string; by: string };

/**
 * The Owner's message to every customer, chosen customers, or staff (all, or some roles). Set-based, so a message to a
 * few thousand customers is a handful of queries. Returns how many people get it and how many pushes are queued.
 */
export async function announce(sql: Sql, message: Announcement) {
  return sql.begin(async (tx) => {
    const target = message.audience === 'customers' ? (message.accountIds ? { accountIds: message.accountIds } : {}) : message.roles ? { roles: message.roles } : {};
    const [made] = await tx`
      insert into announcements ${tx({ audience: message.audience, target: tx.json(target), category: message.category, title: message.title, body: message.body, created_by: message.by })}
      returning id`;
    const id = made!.id as number;
    const column = `${message.category}_enabled`;
    const on = message.category === 'system' ? tx`true` : tx`coalesce(p.${tx(column)}, true)`;
    const values = { title: message.title, body: message.body, category: message.category, id, key: `announcement:${id}` };
    if (message.audience === 'staff') {
      const rows = await tx`
        insert into notifications (staff_id, event, category, title, message, data, event_key, announcement_id, is_read, read_at)
        select s.id, 'announcement', ${values.category}, ${values.title}, ${values.body}, '{}', ${values.key}, ${id}, not ${on}, case when ${on} then null else now() end
        from staff_users s left join notification_preferences p on p.staff_id = s.id
        where s.active ${message.roles ? tx`and s.role in ${tx(message.roles)}` : tx``}
        on conflict do nothing
        returning id`;
      return { id, users: rows.length, queued: 0 };
    }
    const rows = await tx`
      insert into notifications (account_id, event, category, title, message, data, event_key, announcement_id, is_read, read_at)
      select d.id, 'broadcast', ${values.category}, ${values.title}, ${values.body}, '{}', ${values.key}, ${id}, not ${on}, case when ${on} then null else now() end
      from app_devices d left join notification_preferences p on p.account_id = d.id
      where not d.blocked ${message.accountIds ? tx`and d.id in ${tx(message.accountIds.length ? message.accountIds : [0])}` : tx``}
      on conflict do nothing
      returning id`;
    // A push to each phone of everyone who keeps this category on, to the channel their sound choice picked.
    const queued = await tx`
      insert into notification_log (event, channel, recipient, device_id, title, body, data, notification_id, device_token_id)
      select 'broadcast', 'push', t.token, n.account_id, n.title, n.message,
        jsonb_build_object('notificationId', n.id::text, 'category', n.category, 'private', '',
          'channel', n.category || '-' || case when coalesce(p.sound_enabled, true) then case when coalesce(p.vibration_enabled, true) then 'alert' else 'sound' end
            else case when coalesce(p.vibration_enabled, true) then 'vibrate' else 'silent' end end),
        n.id, t.id
      from notifications n join device_tokens t on t.account_id = n.account_id left join notification_preferences p on p.account_id = n.account_id
      where n.announcement_id = ${id} and not n.is_read
      returning id`;
    return { id, users: rows.length, queued: queued.length };
  });
}

// ---------- The inbox ----------

export type InboxQuery = { filter?: 'all' | 'unread' | 'read'; category?: Category; q?: string; before?: number; limit?: number };

/** A page of someone's notifications, newest first, with the unread count; `next` is the cursor for the page after. */
export async function inbox(db: Db, who: Who, query: InboxQuery = {}) {
  const limit = Math.min(100, Math.max(1, query.limit ?? 30));
  const like = query.q ? `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const rows = await db`
    select id, event, category, title, message as body, entity_type as "entityType", entity_id as "entityId", data, created_at as "createdAt", is_read as read
    from notifications
    where ${whoIs(db, who)} and deleted_at is null
      ${query.filter === 'unread' ? db`and not is_read` : query.filter === 'read' ? db`and is_read` : db``}
      ${query.category ? db`and category = ${query.category}` : db``}
      ${like ? db`and (title ilike ${like} or message ilike ${like})` : db``}
      ${query.before ? db`and id < ${query.before}` : db``}
    order by id desc limit ${limit + 1}`;
  const page = rows.slice(0, limit).map((row) => ({ ...row, id: String(row.id) }));
  return { notifications: page, next: rows.length > limit ? page.at(-1)!.id : null, unread: await unreadOf(db, who) };
}

/** The unread count, always from the database (the bell, and the number on the app's icon). */
export async function unreadOf(db: Db, who: Who) {
  const [row] = await db`select count(*)::int as unread from notifications where ${whoIs(db, who)} and not is_read and deleted_at is null`;
  return row!.unread as number;
}

/** Marks some (or all) of someone's notifications read; another person's ids are ignored. Returns the new count. */
export async function markRead(db: Db, who: Who, ids: number[] | 'all') {
  await db`
    update notifications set is_read = true, read_at = now()
    where ${whoIs(db, who)} and not is_read ${ids === 'all' ? db`` : db`and id in ${db(ids.length ? ids : [0])}`}`;
  return unreadOf(db, who);
}

/** Deleted from the list; the row stays a while (retention clears it) so the event can't notify again. */
export async function remove(db: Db, who: Who, ids: number[]) {
  const rows = await db`update notifications set deleted_at = now(), is_read = true, read_at = coalesce(read_at, now()) where ${whoIs(db, who)} and deleted_at is null and id in ${db(ids.length ? ids : [0])} returning id`;
  return { removed: rows.length, unread: await unreadOf(db, who) };
}

// ---------- Scheduled work ----------

/** Claims a scheduled job if it hasn't run within `every` (e.g. '1 hour'); several servers asking at once run it once. */
async function claim(sql: Sql, name: string, every: string) {
  const rows = await sql`update scheduled_runs set last_run_at = now() where name = ${name} and last_run_at < now() - ${every}::interval returning name`;
  return rows.length > 0;
}

const indiaDay = (date = new Date()) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Payment reminders, at most hourly: each customer hears once a few days before a bill is due and then every so many
 * days while it's overdue (when the Owner has turned customer reminders on); the Owner and Accountant get one summary a
 * day of what's overdue. Orders are due on delivery (cash) or the credit period after it; counter bills on their due day.
 */
export async function paymentReminders(sql: Sql, today = indiaDay()) {
  const [settings] = await sql`select payment_reminders, remind_days_before, overdue_every_days from notification_settings`;
  const [credit] = await sql`select value from settings where key = 'creditDays'`;
  const creditDays = /^\d{1,3}$/.test(credit?.value ?? '') ? Number(credit!.value) : 30;
  const orders = await sql`
    select * from (
      select o.id, o.number, o.device_id as account, o.client_order_id, o.source,
        coalesce(o.bill_amount, o.total) - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0) as remaining,
        to_char(((select max(e.at) from order_events e where e.order_id = o.id and e.status = 'delivered') at time zone 'Asia/Kolkata')::date
          + case when o.payment_terms = 'cash' then 0 else ${creditDays}::int end, 'YYYY-MM-DD') as due
      from orders o where o.status = 'delivered'
    ) owed where remaining > 0 and due is not null`;
  const bills = await sql`
    select * from (
      select i.id, i.number, i.customer_id, i.total::float8 - coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = i.id and p.voided_at is null), 0)::float8 as remaining,
        to_char(i.due_date, 'YYYY-MM-DD') as due
      from sales_invoices i where i.status = 'posted' and i.order_id is null and i.return_id is null and i.due_date is not null
    ) owed where remaining > 0.005`;
  let overdueCount = 0;
  let overdueAmount = 0;
  const remind = async (account: number, kind: 'order' | 'bill', row: { id: number; number: string; remaining: number; due: string }, link: Link) => {
    const until = daysBetween(today, row.due);
    const values = { number: row.number, amount: rupees(Number(row.remaining)), due: dayLabel(row.due) };
    if (until >= 0 && until <= settings!.remind_days_before) await notifyCustomer(sql, account, 'payment_due', values, link, `payment_due:${kind}:${row.id}:${row.due}`);
    if (until < 0) await notifyCustomer(sql, account, 'payment_overdue', values, link, `payment_overdue:${kind}:${row.id}:${Math.floor(-until / settings!.overdue_every_days)}`);
  };
  for (const row of orders) {
    if (daysBetween(today, row.due) < 0) {
      overdueCount += 1;
      overdueAmount += Number(row.remaining);
    }
    if (!settings!.payment_reminders) continue;
    const link: Link = { entityType: 'order', entityId: row.id, data: row.source === 'admin' ? { shopOrderId: String(row.id) } : { orderId: row.client_order_id } };
    await remind(row.account, 'order', row as unknown as Parameters<typeof remind>[2], link);
  }
  for (const row of bills) {
    if (daysBetween(today, row.due) < 0) {
      overdueCount += 1;
      overdueAmount += Number(row.remaining);
    }
    if (!settings!.payment_reminders) continue;
    for (const account of await accountsOfCustomer(sql, row.customer_id)) await remind(account, 'bill', row as unknown as Parameters<typeof remind>[2], { entityType: 'invoice', entityId: row.id });
  }
  if (overdueCount)
    await notifyStaff(
      sql,
      'payments_overdue',
      { count: `${overdueCount} bill${overdueCount === 1 ? '' : 's'}`, amount: rupees(overdueAmount) },
      { entityType: 'report', data: { to: '/reports/outstanding' } },
      { roles: ['owner', 'accountant'] },
      `payments_overdue:${today}`,
    );
}

/**
 * Retention: read notifications go after 180 days, any after a year, deleted ones 30 days after deleting; the delivery log
 * after 90 days; a phone token unused for 270 days (FCM's own limit) is dropped. In batches, so a run stays short.
 */
export async function prune(sql: Sql) {
  await sql`
    delete from notifications where id in (
      select id from notifications
      where (is_read and created_at < now() - interval '180 days') or created_at < now() - interval '365 days'
        or (deleted_at is not null and deleted_at < now() - interval '30 days')
      limit 5000)`;
  await sql`delete from notification_log where id in (select id from notification_log where status <> 'pending' and created_at < now() - interval '90 days' limit 5000)`;
  await sql`delete from device_tokens where last_active_at < now() - interval '270 days'`;
}

/** Called with every send run (every 10 seconds on a server, every minute online); each job claims its own pace. */
export async function runScheduled(sql: Sql) {
  if (await claim(sql, 'payment_reminders', '1 hour')) await paymentReminders(sql);
  if (await claim(sql, 'retention', '1 day')) await prune(sql);
}
