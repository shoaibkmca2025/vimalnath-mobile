import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('checkout', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`insert into stock_items (product_id, option_label, hsn, gst_rate, unit, quantity, selling_price) values ('p1', 'SSS', '8302', 18, 'pcs', 20, 1500)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/orders', orderAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
const json = async <T = Record<string, unknown>>(res: Response | Promise<Response>) => (await (await res).json()) as T;

async function owner() {
  const email = `owner${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values ('Owner', ${email}, 'owner') returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

const SHOP = { business: 'Patil Glass House', gstin: '27aapfu0939f1zv', addressLine: 'Shop 4, Mahatma Nagar', area: 'Trimbak Road', landmark: 'Near ABB Circle', city: 'Nashik', state: 'Maharashtra', pincode: '422007' };
async function customer(extra: Record<string, unknown> = SHOP) {
  const phone = `93${String(++next).padStart(8, '0')}`;
  const res = await send('/v1/app/register', 'POST', { name: 'Ramesh Patil', phone, password: 'phone password', ...extra });
  assert.equal(res.status, 201, await res.clone().text());
  const { token, customerId } = await json<{ token: string; customerId: string }>(res);
  return { id: Number(customerId), phone, auth: { Authorization: `Bearer ${token}` } };
}
type Address = { id: number; type: string; label: string; receiverName: string; contactNumber: string; addressLine: string; city: string; pincode: string; isDefault: boolean };
const addresses = async (auth: Record<string, string>) => (await json<{ addresses: Address[] }>(send('/v1/app/addresses', 'GET', undefined, auth))).addresses;
const SITE = { type: 'site', label: 'Gangapur Road bungalow', receiverName: 'Suresh (site engineer)', contactNumber: '+91 98220 55555', alternateContact: '', siteName: 'Kulkarni Bungalow', addressLine: 'Plot 22, Gangapur Road', area: 'Anandvalli', landmark: 'Opp. Petrol Pump', city: 'Nashik', state: 'Maharashtra', pincode: '422013' };

async function order(auth: Record<string, string>, delivery?: Record<string, unknown>, eventId = `event-${++next}`) {
  const body = { eventId, order: { id: `order-${eventId}`, createdAt: new Date().toISOString(), customer: 'Patil Glass House', phone: '', notes: 'Call before coming', lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', option: 'SSS', qty: 2, mrp: 1500 }], ...(delivery ? { delivery } : {}) } };
  assert.equal((await send('/v1/app/orders', 'POST', body, auth)).status, 200);
  return (await sql`select id from orders where client_event_id = ${eventId}`)[0]!.id as number;
}

test('signup takes the shop’s name, GSTIN and address; the shop’s address starts the address book; bad GSTINs and PIN codes are refused', { skip }, async () => {
  const shop = await customer();
  const { profile, addresses: book } = await json<{ profile: Record<string, string>; addresses: Address[] }>(send('/v1/app/profile', 'GET', undefined, shop.auth));
  assert.deepEqual(profile, { name: 'Ramesh Patil', business: 'Patil Glass House', phone: shop.phone, email: '', city: 'Nashik', gstin: '27AAPFU0939F1ZV', addressLine: 'Shop 4, Mahatma Nagar', area: 'Trimbak Road', landmark: 'Near ABB Circle', state: 'Maharashtra', pincode: '422007' });
  assert.deepEqual(book.map((address) => [address.type, address.label, address.receiverName, address.contactNumber, address.isDefault]), [['shop', 'Patil Glass House', 'Ramesh Patil', shop.phone, true]]);

  // Logging in on another phone brings the shop's details with it.
  const login = await json<{ profile: Record<string, string> }>(send('/v1/app/login', 'POST', { phone: shop.phone, password: 'phone password' }));
  assert.equal(login.profile.gstin, '27AAPFU0939F1ZV');

  const bad = async (extra: Record<string, unknown>) => (await send('/v1/app/register', 'POST', { name: 'X', phone: `93${String(++next).padStart(8, '0')}`, password: 'phone password', ...extra })).status;
  assert.equal(await bad({ gstin: '27AAPFU0939F1Z' }), 400, 'too short');
  assert.equal(await bad({ gstin: '99AAPFU0939F1ZV' }), 400, 'no such state');
  assert.equal(await bad({ pincode: '4220' }), 400);
  assert.equal(await bad({ state: 'Atlantis' }), 400);
  // An app from before checkout registers without any of it.
  const older = await customer({ business: '', city: '' });
  assert.deepEqual(await addresses(older.auth), []);
});

test('the address book: add, edit, set default (one at a time), delete (another takes over); only this account’s; clear errors', { skip }, async () => {
  const shop = await customer();
  const site = await json<{ id: number; addresses: Address[] }>(send('/v1/app/addresses', 'POST', { ...SITE, isDefault: true }, shop.auth));
  assert.deepEqual(site.addresses.map((address) => [address.type, address.isDefault]), [['site', true], ['shop', false]]);
  assert.equal(site.addresses[0]!.contactNumber, '9822055555');
  const home = await json<{ id: number }>(send('/v1/app/addresses', 'POST', { ...SITE, type: 'home', label: 'Home', siteName: '', addressLine: '7 Shanti Nagar' }, shop.auth));

  const edited = await json<{ addresses: Address[] }>(send(`/v1/app/addresses/${home.id}`, 'POST', { ...SITE, type: 'home', label: 'Home', siteName: '', addressLine: '9 Shanti Nagar' }, shop.auth));
  assert.equal(edited.addresses.find((address) => address.id === home.id)!.addressLine, '9 Shanti Nagar');
  await send(`/v1/app/addresses/${home.id}/default`, 'POST', {}, shop.auth);
  assert.deepEqual((await addresses(shop.auth)).filter((address) => address.isDefault).map((address) => address.id), [home.id]);
  await send(`/v1/app/addresses/${home.id}/delete`, 'POST', {}, shop.auth);
  const left = await addresses(shop.auth);
  assert.equal(left.length, 2);
  assert.equal(left.filter((address) => address.isDefault).length, 1, 'another becomes the default');

  const other = await customer();
  assert.equal((await send(`/v1/app/addresses/${site.id}/delete`, 'POST', {}, other.auth)).status, 404);
  assert.equal((await send(`/v1/app/addresses/${site.id}`, 'POST', SITE, other.auth)).status, 404);
  const wrong = await json<{ error: { message: string; field?: string } }>(send('/v1/app/addresses', 'POST', { ...SITE, pincode: '42201', contactNumber: '12345' }, shop.auth));
  assert.match(wrong.error.message, /10 digits|PIN code/);
});

test('an order keeps its delivery address as it was: editing the profile or the address book later doesn’t change it; staff see it all', { skip }, async () => {
  const office = await owner();
  const shop = await customer();
  const [saved] = await addresses(shop.auth);
  const orderId = await order(shop.auth, {
    type: 'saved',
    addressId: saved!.id,
    receiverName: 'Ramesh Patil',
    contact: shop.phone,
    addressLine: SHOP.addressLine,
    area: SHOP.area,
    landmark: SHOP.landmark,
    city: SHOP.city,
    state: SHOP.state,
    pincode: SHOP.pincode,
    instructions: 'Deliver after 11 am',
  });

  // The customer moves shop and edits the saved address afterwards.
  await send(`/v1/app/addresses/${saved!.id}`, 'POST', { ...SITE, type: 'shop', addressLine: 'New Shop, College Road', pincode: '422005' }, shop.auth);
  await send('/v1/app/profile', 'POST', { eventId: `profile-${++next}`, profile: { name: 'Ramesh Patil', business: 'Patil Glass & Hardware', phone: shop.phone, email: '', city: 'Nashik', addressLine: 'New Shop, College Road', pincode: '422005', gstin: '27AAPFU0939F1ZV' } }, shop.auth);

  const [placed] = await json<{ delivery: Record<string, string>; appUser: Record<string, string>; notes: string }[]>(send(`/v1/admin/orders`, 'GET', undefined, office)).then((all) => all.filter((one) => (one as unknown as { id: string }).id === String(orderId)));
  assert.deepEqual(
    [placed!.delivery.addressType, placed!.delivery.receiverName, placed!.delivery.contact, placed!.delivery.line, placed!.delivery.instructions],
    ['saved', 'Ramesh Patil', shop.phone, 'Shop 4, Mahatma Nagar, Trimbak Road, near Near ABB Circle, Nashik, Maharashtra 422007', 'Deliver after 11 am'],
  );
  // Staff also see who ordered: name, shop now, registered mobile, GSTIN.
  assert.deepEqual([placed!.appUser.name, placed!.appUser.business, placed!.appUser.phone, placed!.appUser.gstin], ['Ramesh Patil', 'Patil Glass & Hardware', shop.phone, '27AAPFU0939F1ZV']);
  assert.equal(placed!.notes, 'Call before coming');
});

test('a site address for one order stays out of the address book unless ticked; ticked, it’s saved once; a resent order is one order', { skip }, async () => {
  const shop = await customer();
  const site = { type: 'site', receiverName: 'Suresh', contact: '98220 55555', alternateContact: '98220 66666', siteName: 'Kulkarni Bungalow', addressLine: 'Plot 22, Gangapur Road', area: 'Anandvalli', landmark: '', city: 'Nashik', state: 'Maharashtra', pincode: '422013', instructions: 'Ask for Suresh at the gate' };
  await order(shop.auth, site);
  assert.equal((await addresses(shop.auth)).length, 1, 'only the shop: a one-off site stays out');

  const first = await order(shop.auth, { ...site, save: true, saveAs: 'site', label: 'Kulkarni site' }, 'event-save');
  // The phone sends it again (no answer the first time): still one order, one address.
  await order(shop.auth, { ...site, save: true, saveAs: 'site', label: 'Kulkarni site' }, 'event-save');
  assert.equal((await sql`select count(*)::int as n from orders where client_event_id = 'event-save'`)[0]!.n, 1);
  const book = await addresses(shop.auth);
  assert.deepEqual(book.map((address) => [address.type, address.label]), [['shop', 'Patil Glass House'], ['site', 'Kulkarni site']]);
  const [row] = await sql`select delivery_address_type, delivery_site_name, delivery_contact, delivery_alternate_contact, delivery_address_id from orders where id = ${first}`;
  assert.deepEqual([row!.delivery_address_type, row!.delivery_site_name, row!.delivery_contact, row!.delivery_alternate_contact, row!.delivery_address_id], ['site', 'Kulkarni Bungalow', '9822055555', '9822066666', book[1]!.id]);

  // An order from an app before checkout (no delivery) still arrives, its address in the notes.
  const old = await order(shop.auth);
  assert.equal((await sql`select delivery from orders where id = ${old}`)[0]!.delivery, null);
  // Rubbish in the delivery part never stops the order (the phone's queue would stall).
  const messy = await order(shop.auth, { type: 'nonsense', addressId: 'x', receiverName: 'A'.repeat(500), pincode: 'abc' });
  assert.equal((await sql`select delivery_address_type, length(delivery_receiver_name) as n from orders where id = ${messy}`)[0]!.n, 100);
});

test('the app’s content carries each item’s GST rate, for the GST shown at checkout', { skip }, async () => {
  const shop = await customer();
  const content = await json<{ content: { gstRates: Record<string, Record<string, number>> } }>(send('/v1/app/content', 'GET', undefined, shop.auth));
  assert.equal(content.content.gstRates.p1!.SSS, 18);
});
