import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Order } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { appRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

type AppOrders = { customerId: string; orders: { number: string; status: string; mobileOrderId: string; mobileEventId: string; history: { status: string }[] }[] };
type Line = { productId: string; code: string; name: string; option?: string; qty: number; mrp?: number };

testDatabase('orders', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  // A product priced from its catalogue page: no options.
  await sql`insert into products (id, code, name, section, category_id, catalogue_source, catalogue_page, sort_order) values ('p3', 'TGH-99', 'Lock', 'Locks', 'glass', 'master', 12, 3)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const name = `Staff ${next}`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${name}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { name, headers: { Cookie: res.headers.get('set-cookie')!.split(';')[0]! } };
}

/** A connected phone, placing orders the way the app's sync sends them. */
async function phone(label = 'Ravi Glass Works') {
  const token = `token-${++next}`;
  await sql`with customer as (insert into customers (name) values (${label}) returning id) insert into app_devices (label, token_hash, customer_id) select ${label}, ${sha256(token)}, id from customer`;
  const auth = { Authorization: `Bearer ${token}` };
  let made = 0;
  return {
    place: (lines: Line[], extra: Record<string, unknown> = {}, eventId = `order:${token}:${made + 1}`) => {
      made += 1;
      const order = { id: `local-${made}`, number: 'VSC-0001', createdAt: new Date().toISOString(), customer: 'Site A', status: 'Placed', lines, total: 1, ...extra };
      return send('/v1/app/orders', 'POST', { eventId, order }, auth);
    },
    orders: async () => (await (await send('/v1/app/orders', 'GET', undefined, auth)).json()) as AppOrders,
    respond: (id: string, decision: string) => send(`/v1/app/orders/${id}/respond`, 'POST', { decision }, auth),
  };
}

const adminOrders = async (headers: Record<string, string>) => (await (await send('/v1/admin/orders', 'GET', undefined, headers)).json()) as Order[];
const ofDevice = async (label: string) => (await adminOrders((await staff('sales')).headers)).filter((order) => order.appUser?.label === label);
const lock = (qty = 1): Line[] => [{ productId: 'p3', code: 'TGH-99', name: 'Lock', qty }];

test('place: the server numbers the order and uses its own prices, not the phone’s', { skip }, async () => {
  const ravi = await phone();
  const res = await ravi.place([
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', option: 'SSS', qty: 2, mrp: 1 },
    { productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 1, mrp: 1500 },
  ]);
  assert.equal(res.status, 200);
  const { orders } = await ravi.orders();
  assert.deepEqual(
    orders.map((order) => [order.number, order.status, order.mobileOrderId, order.history.map((step) => step.status)]),
    [['VSC-0001', 'Placed', 'local-1', ['Placed']]],
  );

  const [order] = await ofDevice('Ravi Glass Works');
  assert.equal(order!.total, 4500);
  assert.deepEqual(order!.lines.map((line) => [line.mrp, line.optionCode, line.problem]), [
    [1500, 'TGH-55-S', 'The app showed ₹1'],
    [1500, undefined, undefined],
  ]);
});

test('place: lines that no longer match the catalogue are kept and flagged, never refused', { skip }, async () => {
  await sql`update products set visible = false where id = 'p2'`;
  const anil = await phone('Anil Traders');
  const res = await anil.place([
    { productId: 'gone', code: 'OLD-1', name: 'Old Handle', qty: 1, mrp: 900 },
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', option: 'Gold', qty: 1, mrp: 900 },
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', qty: 1 },
    { productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 3, mrp: 1500 },
    ...lock(4),
  ]);
  await sql`update products set visible = true where id = 'p2'`;
  assert.equal(res.status, 200);

  const [order] = await ofDevice('Anil Traders');
  assert.deepEqual(order!.lines.map((line) => [line.code, line.mrp, line.problem]), [
    ['OLD-1', undefined, 'No longer in the catalogue'],
    ['TGH-55', undefined, '“Gold” is no longer offered'],
    ['TGH-55', undefined, 'No option was chosen'],
    ['TGH-55', 1500, 'Hidden from the Shop'],
    ['TGH-99', undefined, undefined],
  ]);
  assert.equal(order!.total, 4500);
});

test('resend: an order sent again, even five times at once, is saved once', { skip }, async () => {
  const ravi = await phone('Resend Co');
  const statuses = await Promise.all(Array.from({ length: 5 }, () => ravi.place(lock(), {}, 'order:same')));
  assert.deepEqual(statuses.map((res) => res.status), [200, 200, 200, 200, 200]);
  assert.equal((await ravi.place(lock(), {}, 'order:same')).status, 200);
  assert.equal((await ravi.orders()).orders.length, 1);
});

test('numbers: never shared when orders arrive together, and they keep growing past VSC-9999', { skip }, async () => {
  const phones = await Promise.all(Array.from({ length: 10 }, (_, index) => phone(`Shop ${index}`)));
  await Promise.all(phones.map((each) => each.place(lock())));
  const numbers = await sql`select number from orders`;
  assert.equal(new Set(numbers.map((row) => row.number)).size, numbers.length);

  await sql`select setval('order_numbers', 9999)`;
  const big = await phone('Big Order Co');
  await big.place(lock());
  assert.equal((await big.orders()).orders[0]!.number, 'VSC-10000');
});

test('placed time: when the customer placed it offline; a time in the future is not trusted', { skip }, async () => {
  const late = await phone('Late Sync Co');
  await late.place(lock(), { createdAt: '2026-10-01T09:30:00.000Z' });
  await late.place(lock(), { createdAt: '2099-01-01T00:00:00.000Z' });
  const [future, offline] = await ofDevice('Late Sync Co');
  assert.equal(new Date(offline!.createdAt).toISOString(), '2026-10-01T09:30:00.000Z');
  assert.ok(Math.abs(new Date(future!.createdAt).getTime() - Date.now()) < 60_000);
});

test('status: each change records who made it, the phone sees it, and undo is a recorded change back', { skip }, async () => {
  const ravi = await phone('Status Co');
  await ravi.place(lock());
  await ravi.place(lock(2));
  const desk = await staff('sales');
  const ids = (await ofDevice('Status Co')).map((order) => order.id);

  const confirmed = (await (await send('/v1/admin/orders/status', 'POST', { ids, status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] };
  assert.deepEqual(confirmed.orders.map((order) => order.status), ['confirmed', 'confirmed']);
  assert.deepEqual(confirmed.orders[0]!.history.map((step) => [step.status, step.by]), [['placed', 'App'], ['confirmed', desk.name]]);

  // Cancelling, and bringing a cancelled order back, are the Owner's; Sales are refused, and their "restore" changes nothing.
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'cancelled' }, desk.headers)).status, 403);
  const owner = await staff('owner');
  await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'cancelled' }, owner.headers);
  const kept = (await (await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] };
  assert.equal(kept.orders[0]!.status, 'cancelled');
  const undone = (await (await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'confirmed' }, owner.headers)).json()) as { orders: Order[] };
  assert.deepEqual(undone.orders[0]!.history.map((step) => step.status), ['placed', 'confirmed', 'cancelled', 'confirmed']);
  // Setting the status it already has records nothing.
  const same = (await (await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'confirmed' }, owner.headers)).json()) as { orders: Order[] };
  assert.equal(same.orders[0]!.history.length, 4);

  const seen = (await ravi.orders()).orders.find((order) => order.mobileOrderId === 'local-1')!;
  assert.equal(seen.status, 'Confirmed');
  assert.deepEqual(seen.history.map((step) => step.status), ['Placed', 'Confirmed', 'Cancelled', 'Confirmed']);
});

test('internal note: saved for staff, removed when emptied, never sent to the phone', { skip }, async () => {
  const ravi = await phone('Note Co');
  await ravi.place(lock());
  const desk = await staff('sales');
  const [order] = await ofDevice('Note Co');
  const note = 'Quoted ₹2,400 for the lock';
  const saved = (await (await send(`/v1/admin/orders/${order!.id}/internal-note`, 'PUT', { text: note }, desk.headers)).json()) as { orders: Order[] };
  assert.deepEqual([saved.orders[0]!.internalNote?.text, saved.orders[0]!.internalNote?.by], [note, desk.name]);
  assert.doesNotMatch(JSON.stringify(await ravi.orders()), /Quoted/);
  const cleared = (await (await send(`/v1/admin/orders/${order!.id}/internal-note`, 'PUT', { text: '  ' }, desk.headers)).json()) as { orders: Order[] };
  assert.equal(cleared.orders[0]!.internalNote, undefined);
  assert.equal((await send('/v1/admin/orders/999999/internal-note', 'PUT', { text: 'x' }, desk.headers)).status, 404);
});

test('access: Owners and Sales work on orders; the Accountant sees them with their money; Catalogue editors and signed-out people cannot', { skip }, async () => {
  assert.equal((await send('/v1/admin/orders')).status, 401);
  assert.equal((await send('/v1/admin/orders', 'GET', undefined, (await staff('catalogue')).headers)).status, 403);
  assert.equal((await send('/v1/admin/orders', 'GET', undefined, (await staff('owner')).headers)).status, 200);
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [1], status: 'shipped' }, (await staff('sales')).headers)).status, 400);

  // The Accountant: every order, with its bill, but doesn't move orders, write their notes or send order requests.
  const accountant = (await staff('accountant')).headers;
  const all = (await adminOrders(accountant)) as (Order & { terms?: string })[];
  assert.ok(all.length > 0 && all.some((order) => order.terms), 'every order, with its terms and bill');
  const id = all[0]!.id;
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [id], status: 'confirmed' }, accountant)).status, 403);
  assert.equal((await send(`/v1/admin/orders/${id}/internal-note`, 'PUT', { text: 'x' }, accountant)).status, 403);
  assert.equal((await send(`/v1/admin/orders/${id}/inventory-note`, 'PUT', { text: 'x' }, accountant)).status, 403);
  assert.equal((await send('/v1/admin/orders', 'POST', { appUserId: 1, customer: 'x', lines: [] }, accountant)).status, 403);
});

type ShopOrder = AppOrders['orders'][number] & { id: string; source: string; details?: { customer: string; total: number; lines: Line[] } };

/** An order request staff send to a customer's phone, as the admin's New Order Request page sends it. */
async function request(headers: Record<string, string>, label: string, extra: Record<string, unknown> = {}) {
  const [device] = await sql`select id from app_devices where label = ${label}`;
  const body = { appUserId: device!.id, customer: 'Site B', phone: '98220 11111', notes: 'Deliver after 4 pm', lines: [{ productId: 'p1', option: 'SSS', qty: 2, note: 'Matt' }, { productId: 'p3', qty: 1 }], ...extra };
  return send('/v1/admin/orders', 'POST', body, headers);
}

test('request: staff send an order; the customer sees its details and confirms it, which passes it to inventory', { skip }, async () => {
  const ravi = await phone('Request Co');
  const desk = await staff('sales');
  const res = await request(desk.headers, 'Request Co');
  assert.equal(res.status, 201);
  const [sent] = ((await res.json()) as { orders: Order[] }).orders;
  assert.equal(sent!.status, 'requested');
  assert.equal(sent!.source, 'admin');
  assert.equal(sent!.total, 3000);
  assert.deepEqual(sent!.lines.map((line) => [line.code, line.optionCode, line.mrp, line.note]), [['TGH-55', 'TGH-55-S', 1500, 'Matt'], ['TGH-99', undefined, undefined, undefined]]);
  assert.deepEqual(sent!.history.map((step) => [step.status, step.by]), [['requested', desk.name]]);

  const inventory = await staff('inventory');
  assert.equal((await adminOrders(inventory.headers)).some((order) => order.id === sent!.id), false);

  // Not received until the phone syncs; then the first time is kept.
  assert.equal(sent!.customerSeenAt, undefined);
  const [seen] = (await ravi.orders()).orders as ShopOrder[];
  const received = (await adminOrders(desk.headers)).find((order) => order.id === sent!.id)!.customerSeenAt;
  assert.ok(received);
  await ravi.orders();
  assert.equal((await adminOrders(desk.headers)).find((order) => order.id === sent!.id)!.customerSeenAt, received);
  assert.deepEqual([seen!.status, seen!.source, seen!.details?.customer, seen!.details?.total, seen!.details?.lines.length], ['Requested', 'admin', 'Site B', 3000, 2]);
  assert.match(seen!.mobileEventId, /^admin:/);

  assert.equal((await ravi.respond(seen!.id, 'maybe')).status, 400);
  assert.equal((await ravi.respond(seen!.id, 'confirm')).status, 200);
  // Pressed twice: still fine, and recorded once.
  assert.equal((await ravi.respond(seen!.id, 'confirm')).status, 200);
  assert.equal((await ravi.respond(seen!.id, 'decline')).status, 409);

  const confirmed = (await adminOrders(desk.headers)).find((order) => order.id === sent!.id)!;
  assert.deepEqual(confirmed.history.map((step) => [step.status, step.by]), [['requested', desk.name], ['confirmed', 'App']]);
  assert.equal((await adminOrders(inventory.headers)).some((order) => order.id === sent!.id), true);

  // Another phone can't answer it.
  const other = await phone('Other Co');
  assert.equal((await other.respond(seen!.id, 'confirm')).status, 404);
});

test('request: a declined one stays out of inventory, a cancelled one cannot be confirmed, and bad lines are refused', { skip }, async () => {
  const ravi = await phone('Decline Co');
  const desk = await staff('owner');
  await request(desk.headers, 'Decline Co');
  await request(desk.headers, 'Decline Co');
  const [second, first] = (await ravi.orders()).orders as ShopOrder[];
  assert.equal((await ravi.respond(first!.id, 'decline')).status, 200);
  assert.equal((await ravi.orders()).orders.find((order) => order.number === first!.number)!.status, 'Declined');

  await send('/v1/admin/orders/status', 'POST', { ids: [second!.id], status: 'cancelled' }, desk.headers);
  const late = await ravi.respond(second!.id, 'confirm');
  assert.equal(late.status, 409);
  assert.match(JSON.stringify(await late.json()), /cancelled/);

  const noOption = await request(desk.headers, 'Decline Co', { lines: [{ productId: 'p1', qty: 1 }] });
  assert.equal(noOption.status, 400);
  assert.equal(((await noOption.json()) as { error: { field: string } }).error.field, 'lines.0.option');
  assert.equal((await request(desk.headers, 'Decline Co', { lines: [{ productId: 'gone', qty: 1 }] })).status, 400);
  assert.equal((await request(desk.headers, 'Decline Co', { lines: [] })).status, 400);
  assert.equal((await request(desk.headers, 'Decline Co', { appUserId: 999999 })).status, 400);
  assert.equal((await request((await staff('inventory')).headers, 'Decline Co')).status, 403);
});

test('pick list: the inventory team ticks each line as it picks it (who, when); the office sees it; only while packing', { skip }, async () => {
  const shop = await phone('Pick Co');
  await shop.place([...lock(2), ...lock(1)]);
  const desk = await staff('sales');
  const inventory = await staff('inventory');
  const [order] = await ofDevice('Pick Co');
  const tick = (headers: Record<string, string>, position: number, picked: boolean) => send(`/v1/admin/orders/${order!.id}/lines/${position}/picked`, 'PUT', { picked }, headers);
  const answer = async (res: Response) => ((await res.json()) as { orders: Order[] }).orders[0]!;

  // Not confirmed yet: nothing to pick.
  assert.equal((await tick(inventory.headers, 0, true)).status, 409);
  await send('/v1/admin/orders/status', 'POST', { ids: [order!.id], status: 'confirmed' }, desk.headers);
  const ticked = await answer(await tick(inventory.headers, 1, true));
  assert.deepEqual([ticked.lines[0]!.picked, ticked.lines[1]!.picked?.by], [undefined, inventory.name]);
  assert.ok(Date.parse(ticked.lines[1]!.picked!.at) > 0);
  // The office sees who picked what, but only the inventory team (and the Owner) ticks.
  assert.equal((await adminOrders(desk.headers)).find((one) => one.id === order!.id)!.lines[1]!.picked?.by, inventory.name);
  assert.equal((await tick(desk.headers, 0, true)).status, 403);
  // A mistake is unticked; a line that isn't in the order can't be ticked.
  assert.equal((await answer(await tick(inventory.headers, 1, false))).lines[1]!.picked, undefined);
  assert.equal((await tick(inventory.headers, 7, true)).status, 409);
  // Still tickable once packed; closed once it has gone out.
  await send('/v1/admin/orders/status', 'POST', { ids: [order!.id], status: 'packed' }, inventory.headers);
  assert.equal((await answer(await tick(inventory.headers, 0, true))).lines[0]!.picked?.by, inventory.name);
  await send('/v1/admin/orders/status', 'POST', { ids: [order!.id], status: 'dispatched' }, inventory.headers);
  assert.equal((await tick(inventory.headers, 0, false)).status, 409);
});

test('inventory: packs and dispatches confirmed orders, can set them back to pending, and every change shows in the admin', { skip }, async () => {
  const ravi = await phone('Inventory Co');
  await ravi.place(lock());
  await ravi.place(lock(3));
  const desk = await staff('sales');
  const inventory = await staff('inventory');
  const [newer, older] = await ofDevice('Inventory Co');
  // Not confirmed yet, so not theirs to see or move.
  assert.equal((await adminOrders(inventory.headers)).some((order) => order.id === older!.id), false);
  const early = (await (await send('/v1/admin/orders/status', 'POST', { ids: [older!.id], status: 'packed' }, inventory.headers)).json()) as { orders: Order[] };
  assert.equal(early.orders[0]!.status, 'placed');

  await send('/v1/admin/orders/status', 'POST', { ids: [older!.id, newer!.id], status: 'confirmed' }, desk.headers);
  const move = (ids: string[], status: string) => send('/v1/admin/orders/status', 'POST', { ids, status }, inventory.headers);
  assert.equal((await move([older!.id], 'packed')).status, 200);
  assert.equal((await move([older!.id], 'dispatched')).status, 200);
  assert.equal((await move([newer!.id], 'packed')).status, 200);
  assert.equal((await move([newer!.id], 'confirmed')).status, 200);
  // Pending, Packed, Dispatched and Delivered are theirs, and cancelling an order that hasn't gone out; going back to New isn't.
  assert.equal((await move([older!.id], 'placed')).status, 403);
  assert.equal((await move([older!.id], 'requested')).status, 403);
  const dispatchedStays = (await (await move([older!.id], 'cancelled')).json()) as { orders: Order[] };
  assert.equal(dispatchedStays.orders[0]!.status, 'dispatched');

  const noted = (await (await send(`/v1/admin/orders/${older!.id}/inventory-note`, 'PUT', { text: 'VRL Logistics, LR 4471' }, inventory.headers)).json()) as { orders: Order[] };
  assert.deepEqual([noted.orders[0]!.inventoryNote?.text, noted.orders[0]!.inventoryNote?.by], ['VRL Logistics, LR 4471', inventory.name]);
  assert.equal((await send(`/v1/admin/orders/${older!.id}/internal-note`, 'PUT', { text: 'x' }, inventory.headers)).status, 403);

  const seen = new Map((await adminOrders(desk.headers)).map((order) => [order.id, order]));
  assert.deepEqual(seen.get(older!.id)!.history.map((step) => [step.status, step.by]), [['placed', 'App'], ['confirmed', desk.name], ['packed', inventory.name], ['dispatched', inventory.name]]);
  assert.equal(seen.get(older!.id)!.inventoryNote?.text, 'VRL Logistics, LR 4471');
  assert.deepEqual(seen.get(newer!.id)!.history.map((step) => step.status), ['placed', 'confirmed', 'packed', 'confirmed']);
  // The customer sees Packed and Dispatched too, but never the inventory note.
  const phoneView = JSON.stringify(await ravi.orders());
  assert.match(phoneView, /"Packed"/);
  assert.doesNotMatch(phoneView, /VRL/);

  // A pending or packed order can be cancelled by the inventory team; only the office can restore it.
  const extra = await ravi.place(lock(5));
  assert.equal(extra.status, 200);
  const third = (await ofDevice('Inventory Co')).find((order) => order.status === 'placed')!;
  await send('/v1/admin/orders/status', 'POST', { ids: [third.id], status: 'confirmed' }, desk.headers);
  const cancelled = (await (await move([third.id], 'cancelled')).json()) as { orders: Order[] };
  assert.deepEqual(cancelled.orders[0]!.history.at(-1), { ...cancelled.orders[0]!.history.at(-1)!, status: 'cancelled', by: inventory.name });
  assert.equal(((await (await move([third.id], 'confirmed')).json()) as { orders: Order[] }).orders[0]!.status, 'cancelled');
  // Sales can't bring it back either; the Owner can.
  assert.equal(((await (await send('/v1/admin/orders/status', 'POST', { ids: [third.id], status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] }).orders[0]!.status, 'cancelled');
  assert.equal(((await (await send('/v1/admin/orders/status', 'POST', { ids: [third.id], status: 'confirmed' }, (await staff('owner')).headers)).json()) as { orders: Order[] }).orders[0]!.status, 'confirmed');

  // The inventory team marks a dispatched order delivered, and can undo that back to dispatched, but no further.
  const pendingDelivery = (await (await move([newer!.id], 'delivered')).json()) as { orders: Order[] };
  assert.equal(pendingDelivery.orders[0]!.status, 'confirmed');
  const delivered = (await (await move([older!.id], 'delivered')).json()) as { orders: Order[] };
  assert.deepEqual([delivered.orders[0]!.status, delivered.orders[0]!.history.at(-1)!.by], ['delivered', inventory.name]);
  assert.equal((await adminOrders(inventory.headers)).find((order) => order.id === older!.id)?.status, 'delivered');
  const stuck = (await (await move([older!.id], 'packed')).json()) as { orders: Order[] };
  assert.equal(stuck.orders[0]!.status, 'delivered');
  const undone = (await (await move([older!.id], 'dispatched')).json()) as { orders: Order[] };
  assert.equal(undone.orders[0]!.status, 'dispatched');
});
