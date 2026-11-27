import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { AddressInput, addressesOf, Gstin, makeDefault, removeAddress, saveAddress, State, STATES } from './addresses.ts';
import { clientOf } from './app.ts';
import { readCalculators } from './calculators.ts';
import { readCatalogue } from './catalogue.ts';
import { readContent } from './content.ts';
import { AppFeedback, saveFeedback } from './feedback.ts';
import { customerPhoto } from './media.ts';
import { InboxIds, isPushService, PreferencesInput, readInboxQuery, webPushKeys } from './notifications.ts';
import { inbox, markRead, notifyStaff, preferencesOf, remove, savePreferences, unreadOf } from './notify.ts';
import { AppOrder, appOrders, placeOrder, respondToRequest } from './orders.ts';
import { countAttempt, dummyHash, hashPassword, MAX_ATTEMPTS, newToken, only, passwordMatches, sha256, type Env } from './staff.ts';
import { appStock } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

// The app sends its updates strictly in order and stops at the first one refused, so free text
// from it is cut to size instead of refused: one long name must not hold up the orders behind it.
const Text = z.string().max(5000).default('').transform((text) => text.trim().slice(0, 200));
const EventId = z.string().min(1).max(300);
const Label = z.string().trim().min(1, 'Enter who this is for.').max(100, 'Use 100 characters or fewer.');
const AppUserId = z.coerce.number().int().positive().max(2147483647);
// A mobile number is the login: its last 10 digits, however it's typed ("+91 98200 12345", "09820012345").
const Mobile = z.string().max(40).transform((value) => value.replace(/\D/g, '').slice(-10)).refine((digits) => digits.length === 10, 'Enter your 10-digit mobile number.');
const Password = z.string().min(8, 'Use at least 8 characters.').max(200, 'Use 200 characters or fewer.');
/**
 * A new account: the person, their shop (name, GSTIN, address) and a password. The shop's details are optional here so
 * apps from before checkout can still register; the app asks for them, and checkout collects what's missing.
 */
const Register = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use 100 characters or fewer.'),
  business: Text,
  city: Text,
  email: Text,
  phone: Mobile,
  password: Password,
  gstin: Gstin,
  addressLine: z.string().trim().max(300, 'Use 300 characters or fewer.').default(''),
  area: z.string().trim().max(120, 'Use 120 characters or fewer.').default(''),
  landmark: z.string().trim().max(120, 'Use 120 characters or fewer.').default(''),
  state: z.union([State, z.literal('')]).default(''),
  pincode: z
    .string()
    .trim()
    .regex(/^(\d{6})?$/, 'Enter the 6-digit PIN code.')
    .default(''),
});
/** The account's profile in the app's shape (login, GET /profile). */
const PROFILE = (sql: Sql) => sql`name, business, phone, email, city, gstin, address_line as "addressLine", area, landmark, state, pincode`;
const LogIn = z.object({ phone: Mobile, password: z.string().min(1, 'Enter your password.').max(200) });

// Queued from the phone, so cut to size rather than refused; the shop's address fields are optional for older apps.
const ProfileEvent = z.object({
  eventId: EventId,
  profile: z.object({
    name: Text,
    business: Text,
    phone: Text,
    email: Text,
    city: Text,
    gstin: z.string().max(40).optional().transform((value) => value?.trim().toUpperCase().slice(0, 15)),
    addressLine: z.string().max(5000).optional().transform((value) => value?.trim().slice(0, 300)),
    area: z.string().max(5000).optional().transform((value) => value?.trim().slice(0, 120)),
    landmark: z.string().max(5000).optional().transform((value) => value?.trim().slice(0, 120)),
    state: z.string().max(100).optional().transform((value) => (value && STATES.includes(value.trim()) ? value.trim() : undefined)),
    pincode: z.string().max(40).optional().transform((value) => (value && /^\d{6}$/.test(value.trim()) ? value.trim() : undefined)),
  }),
});
const COLUMN: Record<string, string> = { addressLine: 'address_line' };
const OrderEvent = z.object({ eventId: EventId, order: AppOrder });
const ActivityEvent = z.object({
  eventId: EventId,
  type: z.string().min(1).max(40),
  occurredAt: z.string().max(40),
  productId: z.string().max(200).optional(),
  productName: z.string().max(500).optional(),
  optionIndex: z.number().int().optional(),
  optionLabel: z.string().max(500).optional(),
  price: z.number().optional(),
});

/**
 * Module 11: everything the app shows, as people in the app see it. Hidden products and categories, and banners
 * switched off, stay in the admin.
 */
export async function appContent(sql: Sql) {
  const [{ products, categories, catalogues, catalogPages }, { cutlist, sections }, { banners, videoSections, moreApps, settings }, stock, rates] = await Promise.all([
    readCatalogue(sql),
    readCalculators(sql),
    readContent(sql),
    appStock(sql),
    sql`select product_id, option_label, gst_rate::float8 as rate from stock_items where gst_rate is not null order by product_id, option_label`,
  ]);
  // Each item's GST rate, so checkout can show the GST inside the prices (the prices are MRP, GST included).
  const gstRates: Record<string, Record<string, number>> = {};
  for (const row of rates) (gstRates[row.product_id as string] ??= {})[row.option_label as string] = row.rate as number;
  return {
    // Out or low, by product and option: the app marks them and won't add an item that's out to the cart.
    stock,
    gstRates,
    products: products.filter((product) => product.visible).map(({ visible: _, ...product }) => product),
    categories: categories.filter((category) => category.visible).map(({ visible: _, ...category }) => category),
    catalogPages,
    priceLists: catalogues,
    cutlist,
    sections,
    banners: banners.filter((banner) => banner.active).map(({ active: _, ...banner }) => banner),
    videoSections,
    moreApps,
    settings,
  };
}

const ExpoToken = z.string().regex(/^Expo(nent)?PushToken\[[\w-]+\]$/, 'That is not an Expo push token.');
/** An FCM registration token, as the Android app gets it from Firebase. */
const FcmToken = z.string().regex(/^[\w:-]{100,4096}$/, 'That is not an FCM token.');
/** A browser's push subscription. Only the browsers' own push services: the server will post to this address. */
const BrowserSubscription = z.object({
  endpoint: z.string().max(1000).refine(isPushService, 'That is not a browser push service.'),
  keys: z.object({ p256dh: z.string().regex(/^[\w-]{80,100}$/, 'That is not a browser key.'), auth: z.string().regex(/^[\w-]{16,40}$/, 'That is not a browser key.') }),
});

/** Everything under /v1/app: the customer's phone, signed in with the token the shop gave them. */
export function appRoutes(sql: Sql, { trustProxy = false }: { trustProxy?: boolean } = {}) {
  const app = new Hono<{ Variables: { deviceId: number; sessionId: number } }>();
  // Each login is a session: a token per phone, so one account works on several phones at once.
  const startSession = async (tx: Sql, accountId: number, token: string) => {
    await tx`insert into app_sessions ${tx({ account_id: accountId, token_hash: sha256(token) })}`;
  };

  // Accounts: a customer registers or logs in with their mobile number and gets the token every other route here needs.
  // Declared before the token check below, so they work without one.
  // Several phones per account: logging in on another phone starts a session there and leaves the others signed in.
  app.post('/register', jsonBody(Register), async (c) => {
    const { name, business, city, email, phone, password, gstin, addressLine, area, landmark, state, pincode } = c.req.valid('json');
    const token = newToken();
    const passwordHash = await hashPassword(password);
    try {
      const id = await sql.begin(async (tx) => {
        // A new account is an app user; it becomes a customer with its first order (see ensureCustomer in orders.ts).
        const [device] = await tx`
          insert into app_devices ${tx({ label: name, name, business, city, email, phone, login: phone, password_hash: passwordHash, token_hash: sha256(token), profile_updated_at: new Date(), gstin, address_line: addressLine, area, landmark, state, pincode })}
          returning id`;
        // The shop's address starts the address book, as the default for delivery.
        if (addressLine && city && state && pincode)
          await tx`insert into customer_addresses ${tx({ account_id: device!.id, address_type: 'shop', label: business, receiver_name: name, contact_number: phone, address_line: addressLine, area, landmark, city, state, pincode, is_default: true })}`;
        await startSession(tx as unknown as Sql, device!.id as number, token);
        // The office hears about a new account in its notification center.
        await notifyStaff(
          tx,
          'customer_registered',
          { customer: name, details: [business, city, phone].filter(Boolean).join(', ') },
          { entityType: 'app_user', entityId: device!.id as number, data: { to: '/app-users' } },
          { roles: ['sales'] },
          `customer_registered:${device!.id}`,
        );
        return device!.id as number;
      });
      return c.json({ token, customerId: String(id) }, 201);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new HTTPException(409, { message: 'This mobile number already has an account. Log in instead.', cause: { field: 'phone' } });
      throw error;
    }
  });

  app.post('/login', jsonBody(LogIn), async (c) => {
    const { phone: login, password } = c.req.valid('json');
    const client = clientOf(c, trustProxy);
    const [row] = await sql`select id, blocked, password_hash, ${PROFILE(sql)} from app_devices where login = ${login}`;
    const attempts = row ? await countAttempt(sql, `app:${login}`, client) : 0;
    const matches = await passwordMatches(password, row?.password_hash ?? (await dummyHash));
    // One message for every failure, so it can't be used to find out which numbers have accounts.
    if (!row || !row.password_hash || attempts > MAX_ATTEMPTS || !matches) {
      throw new HTTPException(401, { message: 'Wrong mobile number or password. After 5 wrong tries, login is locked for 15 minutes.' });
    }
    if (row.blocked) throw new HTTPException(403, { message: 'The shop has turned off this account. Please call the shop.' });
    const token = newToken();
    await sql.begin(async (tx) => {
      await startSession(tx as unknown as Sql, row.id as number, token);
      await tx`delete from sign_in_attempts where email = ${`app:${login}`} and client = ${client}`;
    });
    return c.json({
      token,
      customerId: String(row.id),
      profile: { name: row.name, business: row.business, phone: row.phone, email: row.email, city: row.city, gstin: row.gstin, addressLine: row.addressLine, area: row.area, landmark: row.landmark, state: row.state, pincode: row.pincode },
    });
  });

  app.use(async (c, next) => {
    const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    const hash = token ? sha256(token) : null;
    let [session] = hash ? await sql`update app_sessions set last_seen_at = now() where token_hash = ${hash} returning id, account_id` : [];
    // A token the shop gave out before sessions (App Users): it becomes this phone's session the first time it's used.
    if (!session && hash) {
      const [legacy] = await sql`select id from app_devices where token_hash = ${hash}`;
      if (legacy) [session] = await sql`insert into app_sessions ${sql({ account_id: legacy.id, token_hash: hash })} on conflict (token_hash) do update set last_seen_at = now() returning id, account_id`;
    }
    // Blocked accounts are still marked as seen, so staff can tell they keep trying.
    const [device] = session ? await sql`update app_devices set last_seen_at = now() where id = ${session.account_id} returning id, blocked` : [];
    if (!device) throw new HTTPException(401, { message: 'You were logged out. Log in again.' });
    if (device.blocked) throw new HTTPException(403, { message: 'The shop has turned off this account. Please call the shop.' });
    c.set('deviceId', device.id);
    c.set('sessionId', session!.id);
    await next();
  });

  // This phone's token stops working and it stops getting notifications (its push tokens go with the session); the
  // account's other phones stay signed in.
  app.post('/logout', async (c) => {
    await sql.begin(async (tx) => {
      const [session] = await tx`delete from app_sessions where id = ${c.get('sessionId')} returning token_hash`;
      // A token from before sessions stops working too.
      if (session) await tx`update app_devices set token_hash = ${sha256(newToken())} where id = ${c.get('deviceId')} and token_hash = ${session.token_hash}`;
    });
    return c.json({ loggedOut: true });
  });

  // The app calls this around every sync: customerId pins the phone to one customer, and
  // mobileEventId tells it which of its orders have arrived, so it never sends one twice.
  // `unread` is the number on the app's bell.
  app.get('/orders', async (c) => {
    const [orders, unread] = await Promise.all([appOrders(sql, c.get('deviceId')), unreadOf(sql, { accountId: c.get('deviceId') })]);
    return c.json({ customerId: String(c.get('deviceId')), orders, unread });
  });

  // The Notification Center: a page at a time (?filter=unread|read, ?category=, ?q=, ?before=<id>), with the unread count.
  const mine = (c: { get: (key: 'deviceId') => number }) => ({ accountId: c.get('deviceId') });
  app.get('/notifications', async (c) => c.json(await inbox(sql, mine(c), readInboxQuery(c.req.query()))));
  app.get('/notifications/unread', async (c) => c.json({ unread: await unreadOf(sql, mine(c)) }));
  // Some read ({ ids }), or all of them (no body: what the app before the Notification Center sends).
  app.post('/notifications/read', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as unknown;
    const ids = InboxIds.safeParse(body);
    return c.json({ unread: await markRead(sql, mine(c), ids.success ? ids.data.ids : 'all') });
  });
  app.post('/notifications/read-all', async (c) => c.json({ unread: await markRead(sql, mine(c), 'all') }));
  app.post('/notifications/delete', jsonBody(InboxIds), async (c) => c.json(await remove(sql, mine(c), c.req.valid('json').ids)));
  app.get('/notifications/preferences', async (c) => c.json(await preferencesOf(sql, mine(c))));
  app.put('/notifications/preferences', jsonBody(PreferencesInput), async (c) => c.json(await savePreferences(sql, mine(c), c.req.valid('json'))));
  // The same as POST: the app's request helper sends GET and POST only.
  app.post('/notifications/preferences', jsonBody(PreferencesInput), async (c) => c.json(await savePreferences(sql, mine(c), c.req.valid('json'))));

  app.post('/orders', jsonBody(OrderEvent), async (c) => {
    const { eventId, order } = c.req.valid('json');
    await placeOrder(sql, c.get('deviceId'), eventId, order);
    return c.json({ received: true });
  });

  // The customer confirms or declines an order the shop sent. Confirmed, it goes to the inventory team.
  app.post('/orders/:id/respond', jsonBody(z.object({ decision: z.enum(['confirm', 'decline'], 'Choose confirm or decline.') })), async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    await respondToRequest(sql, c.get('deviceId'), id, c.req.valid('json').decision);
    return c.json({ orders: await appOrders(sql, c.get('deviceId')) });
  });

  app.post('/activity', jsonBody(ActivityEvent), async (c) => {
    const { eventId, ...activity } = c.req.valid('json');
    await sql`insert into app_events (device_id, event_id, kind, body) values (${c.get('deviceId')}, ${eventId}, 'activity', ${sql.json(activity)}) on conflict do nothing`;
    return c.json({ received: true });
  });

  // The phone sends the version it has (11.2): if nothing changed it gets only the version back; otherwise everything, about 40 KB gzipped.
  // shortcut: builds and fingerprints the whole catalogue on every check, and sends all of it when anything changed. Store a version
  // that each save moves on, and send only changed rows, once checks pass a few a second or the catalogue passes a few MB.
  app.get('/content', compress(), async (c) => {
    const content = await appContent(sql);
    const version = sha256(JSON.stringify(content)).slice(0, 16);
    return c.json(c.req.query('have') === version ? { version } : { version, content });
  });

  // Where this phone's notifications go; null when the person turns them off. The Android app sends its FCM token (or
  // Expo's), the web app on a home screen its browser's push subscription, kept as JSON. A new token replaces this
  // phone's old one of the same kind (tokens change); a token another account had moves to this one.
  app.post('/push-token', jsonBody(z.object({ token: z.union([ExpoToken, FcmToken, BrowserSubscription]).nullable(), deviceType: z.enum(['android', 'ios', 'web']).optional() })), async (c) => {
    const { token, deviceType } = c.req.valid('json');
    const accountId = c.get('deviceId');
    const sessionId = c.get('sessionId');
    await sql.begin(async (tx) => {
      if (!token) {
        await tx`delete from device_tokens where session_id = ${sessionId}`;
        await tx`update app_devices set push_token = null where id = ${accountId}`;
        return;
      }
      const web = typeof token === 'object';
      const kind = web ? 'web' : /^Expo(nent)?PushToken\[/.test(token) ? 'expo' : 'fcm';
      const address = web ? JSON.stringify({ endpoint: token.endpoint, keys: token.keys }) : token;
      await tx`delete from device_tokens where session_id = ${sessionId} and kind = ${kind} and token <> ${address}`;
      await tx`
        insert into device_tokens ${tx({ account_id: accountId, session_id: sessionId, kind, token: address, device_type: deviceType ?? (web ? 'web' : 'android') })}
        on conflict (token) do update set account_id = excluded.account_id, session_id = excluded.session_id, last_active_at = now()`;
    });
    return c.json({ received: true });
  });

  // The account's own details and address book, for checkout and the profile screens.
  app.get('/profile', async (c) => {
    const [profile] = await sql`select ${PROFILE(sql)} from app_devices where id = ${c.get('deviceId')}`;
    return c.json({ profile, addresses: await addressesOf(sql, c.get('deviceId')) });
  });
  app.get('/addresses', async (c) => c.json({ addresses: await addressesOf(sql, c.get('deviceId')) }));
  app.post('/addresses', jsonBody(AddressInput), async (c) => {
    const id = await saveAddress(sql, c.get('deviceId'), c.req.valid('json'));
    return c.json({ id, addresses: await addressesOf(sql, c.get('deviceId')) }, 201);
  });
  app.post('/addresses/:id', jsonBody(AddressInput), async (c) => {
    const id = await saveAddress(sql, c.get('deviceId'), c.req.valid('json'), parse(AppUserId, c.req.param('id')));
    return c.json({ id, addresses: await addressesOf(sql, c.get('deviceId')) });
  });
  app.post('/addresses/:id/delete', async (c) => {
    await removeAddress(sql, c.get('deviceId'), parse(AppUserId, c.req.param('id')));
    return c.json({ addresses: await addressesOf(sql, c.get('deviceId')) });
  });
  app.post('/addresses/:id/default', async (c) => {
    await makeDefault(sql, c.get('deviceId'), parse(AppUserId, c.req.param('id')));
    return c.json({ addresses: await addressesOf(sql, c.get('deviceId')) });
  });

  // The shop's public key, which the web app needs to ask its browser for a push subscription.
  app.get('/push-key', async (c) => c.json({ publicKey: (await webPushKeys(sql)).publicKey }));

  app.post('/profile', jsonBody(ProfileEvent), async (c) => {
    const { eventId, profile: sent } = c.req.valid('json');
    // Fields an older app doesn't send (or sends unusable) stay as they are.
    const profile = Object.fromEntries(Object.entries(sent).filter(([, value]) => value !== undefined)) as Record<string, string>;
    const columns = Object.fromEntries(Object.entries(profile).map(([key, value]) => [COLUMN[key] ?? key, value]));
    await sql.begin(async (tx) => {
      const [before] = await tx`select ${PROFILE(tx as unknown as Sql)} from app_devices where id = ${c.get('deviceId')} for update`;
      await tx`update app_devices set ${tx(columns)}, profile_updated_at = now() where id = ${c.get('deviceId')}`;
      // What changed, for the office (a resend changes nothing, so tells nobody).
      const LABEL: Record<string, string> = { name: 'name', business: 'shop name', phone: 'mobile', email: 'email', city: 'city', gstin: 'GSTIN', addressLine: 'address', area: 'area', landmark: 'landmark', state: 'state', pincode: 'PIN code' };
      const changed = Object.entries(profile).filter(([key, value]) => before && before[key] !== value).map(([key, value]) => `${LABEL[key]} ${value || '(removed)'}`);
      if (changed.length)
        await notifyStaff(
          tx,
          'customer_updated',
          { customer: profile.name || before?.name || 'A customer', details: changed.join(', ') },
          { entityType: 'app_user', entityId: c.get('deviceId'), data: { to: '/app-users' } },
          { roles: ['sales'] },
          `customer_updated:${c.get('deviceId')}:${eventId}`,
        );
    });
    return c.json({ received: true });
  });

  // The menu's Feedback screen: a rating, a problem, a suggestion. Staff read it under Feedback in the admin.
  app.post('/feedback', jsonBody(AppFeedback), async (c) => {
    await saveFeedback(sql, c.get('deviceId'), c.req.valid('json'));
    return c.json({ received: true }, 201);
  });

  // The customer's own photo, from Create Account or the User screen: the photo itself as the body, its type as Content-Type.
  // A new one replaces the old. Only staff can see it (App Users); it is never served publicly.
  app.put('/photo', async (c) => {
    const type = c.req.header('content-type')?.split(';')[0]?.trim() ?? '';
    const photo = await customerPhoto(type, Buffer.from(await c.req.arrayBuffer()));
    const [row] = await sql`
      insert into app_user_photos ${sql({ device_id: c.get('deviceId'), ...photo })}
      on conflict (device_id) do update set data = excluded.data, small = excluded.small, updated_at = now()
      returning updated_at as "updatedAt"`;
    return c.json({ updatedAt: row!.updatedAt });
  });

  return app;
}

/** /v1/admin/app-users: who has the app connected to the shop. Mounted after the staff sign-in check. */
export function appUserAdminRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales'));

  // shortcut: counts every event ever received on each load; keep counters on app_devices once app_events passes about a million rows.
  const appUsers = (where = sql`true`) => sql`
    select d.id, d.label, d.name, d.business, d.phone, d.email, d.city, d.blocked,
      d.last_seen_at as "lastSeenAt", d.profile_updated_at as "profileUpdatedAt", d.created_at as "createdAt",
      (select count(*) from orders o where o.device_id = d.id)::int as orders,
      (select count(*) from app_events e where e.device_id = d.id)::int as views,
      (select p.updated_at from app_user_photos p where p.device_id = d.id) as "photoAt"
    from app_devices d
    where ${where} order by d.created_at desc`;
  const one = async (id: number) => (await appUsers(sql`d.id = ${id}`))[0];

  // shortcut: sends every app user at once; page it on the server past a few thousand.
  admin.get('/', async (c) => c.json(await appUsers()));

  // The customer's photo (?size=small for lists). Private: it needs a staff session, and browsers keep it for a day
  // at most; the admin adds the photo's time to the address, so a new photo shows at once.
  admin.get('/:id/photo', async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    const small = c.req.query('size') === 'small';
    const [row] = await sql`select ${small ? sql`small` : sql`data`} as photo from app_user_photos where device_id = ${id}`;
    if (!row) throw new HTTPException(404, { message: 'This app user has no photo.' });
    return c.body(new Uint8Array(row.photo as Buffer), 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' });
  });

  const Change = z.object({ label: Label.optional(), blocked: z.boolean().optional(), password: Password.optional() }).refine((change) => Object.keys(change).length > 0, 'Nothing to change.');

  admin.patch('/:id', jsonBody(Change), async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    const { password, ...change } = c.req.valid('json');
    // For a forgotten password: the phone is signed out too (its token stops working) until the customer logs in again.
    const update = password ? { ...change, password_hash: await hashPassword(password), token_hash: sha256(newToken()) } : change;
    const [row] = await sql`update app_devices set ${sql(update)} where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That app user does not exist.' });
    // A new password signs out every phone on the account.
    if (password) await sql`delete from app_sessions where account_id = ${id}`;
    return c.json(await one(id));
  });

  return admin;
}
