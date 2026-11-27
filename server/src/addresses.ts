import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { GST_STATES } from './gst.ts';

/**
 * Customers' shop details and delivery addresses. The address book is edited directly (strict checks, clear messages);
 * an order's delivery address arrives in the phone's queue, which stops at the first refused update, so it is cleaned
 * and cut to size, never refused.
 */

export const STATES = Object.values(GST_STATES);
export const ADDRESS_TYPES = ['shop', 'home', 'site', 'other'] as const;

/** The 10-digit mobile number, however it's typed ("+91 98200 12345", "09820012345"). */
const tenDigits = (value: string) => value.replace(/\D/g, '').slice(-10);
const Mobile = (what: string) => z.string().max(40).transform(tenDigits).refine((digits) => digits.length === 10, `Enter the ${what}: 10 digits.`);
const OptionalMobile = z
  .string()
  .max(40)
  .default('')
  .transform((value) => (value.trim() ? tenDigits(value) : ''))
  .refine((digits) => digits === '' || digits.length === 10, 'Enter the alternate number: 10 digits, or leave it empty.');
const Required = (max: number, message: string) => z.string(message).trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
const Optional = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`).default('');
export const State = z.string('Choose the state.').refine((state) => STATES.includes(state), 'Choose the state.');
export const Pincode = z.string('Enter the 6-digit PIN code.').trim().regex(/^\d{6}$/, 'Enter the 6-digit PIN code.');

/** A GSTIN: 15 characters, its first two the state's code. Empty is fine (not every customer is registered). */
export const Gstin = z
  .string()
  .trim()
  .max(15, 'A GSTIN has 15 characters.')
  .default('')
  .transform((gstin) => gstin.toUpperCase())
  .refine((gstin) => !gstin || (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) && gstin.slice(0, 2) in GST_STATES), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.');

export const AddressInput = z.object({
  type: z.enum(ADDRESS_TYPES, 'Choose shop, home, site or other.'),
  label: Optional(60),
  receiverName: Required(100, 'Enter who receives the goods.'),
  contactNumber: Mobile('contact number'),
  alternateContact: OptionalMobile,
  siteName: Optional(120),
  addressLine: Required(300, 'Enter the address: building, street.'),
  area: Optional(120),
  landmark: Optional(120),
  city: Required(80, 'Enter the city.'),
  state: State,
  pincode: Pincode,
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.output<typeof AddressInput>;

/** An address in the app's shape. */
export const addressesOf = (db: Sql | TransactionSql, accountId: number) => db`
  select id, address_type as type, label, receiver_name as "receiverName", contact_number as "contactNumber", alternate_contact as "alternateContact",
    site_name as "siteName", address_line as "addressLine", area, landmark, city, state, pincode, is_default as "isDefault", updated_at as "updatedAt"
  from customer_addresses where account_id = ${accountId} order by is_default desc, id`;

const row = (input: AddressInput) => ({
  address_type: input.type,
  label: input.label,
  receiver_name: input.receiverName,
  contact_number: input.contactNumber,
  alternate_contact: input.alternateContact,
  site_name: input.siteName,
  address_line: input.addressLine,
  area: input.area,
  landmark: input.landmark,
  city: input.city,
  state: input.state,
  pincode: input.pincode,
  is_default: input.isDefault,
});

/** Saves an address (new, or changing one of this account's); making it the default unsets the one before. */
export async function saveAddress(sql: Sql, accountId: number, input: AddressInput, id?: number) {
  return sql.begin(async (tx) => {
    // The first address is the default, whatever was asked.
    const [{ count }] = (await tx`select count(*)::int as count from customer_addresses where account_id = ${accountId}`) as unknown as [{ count: number }];
    const values = { ...row(input), is_default: input.isDefault || count === 0 || (id !== undefined && count === 1) };
    if (values.is_default) await tx`update customer_addresses set is_default = false where account_id = ${accountId} and is_default`;
    if (id === undefined) {
      const [made] = await tx`insert into customer_addresses ${tx({ ...values, account_id: accountId })} returning id`;
      return made!.id as number;
    }
    const [changed] = await tx`update customer_addresses set ${tx(values)}, updated_at = now() where id = ${id} and account_id = ${accountId} returning id`;
    if (!changed) throw new HTTPException(404, { message: 'That address has already been removed.' });
    return id;
  });
}

export async function removeAddress(sql: Sql, accountId: number, id: number) {
  await sql.begin(async (tx) => {
    const [gone] = await tx`delete from customer_addresses where id = ${id} and account_id = ${accountId} returning is_default`;
    if (!gone) throw new HTTPException(404, { message: 'That address has already been removed.' });
    // Another becomes the default, so there always is one while any are left.
    if (gone.is_default) await tx`update customer_addresses set is_default = true where id = (select id from customer_addresses where account_id = ${accountId} order by id limit 1)`;
  });
}

export async function makeDefault(sql: Sql, accountId: number, id: number) {
  await sql.begin(async (tx) => {
    const [found] = await tx`select id from customer_addresses where id = ${id} and account_id = ${accountId} for update`;
    if (!found) throw new HTTPException(404, { message: 'That address has already been removed.' });
    await tx`update customer_addresses set is_default = false where account_id = ${accountId} and is_default`;
    await tx`update customer_addresses set is_default = true, updated_at = now() where id = ${id}`;
  });
}

// ---------- An order's delivery address, from the phone's queue ----------

const Cut = (max: number) => z.string().max(5000).default('').transform((text) => text.trim().slice(0, max));

/** As the app sends it with an order. Cleaned, never refused: a refused order would hold up the phone's queue. */
export const AppDelivery = z.object({
  type: z.enum(['saved', 'temporary', 'site']).catch('temporary'),
  addressId: z.number().int().positive().max(2147483647).optional().catch(undefined),
  receiverName: Cut(100),
  contact: Cut(40),
  alternateContact: Cut(40),
  siteName: Cut(120),
  addressLine: Cut(300),
  area: Cut(120),
  landmark: Cut(120),
  city: Cut(80),
  state: Cut(60),
  pincode: Cut(10),
  instructions: Cut(500),
  // "Save this address to my saved addresses", as a home, site or other address.
  save: z.boolean().default(false).catch(false),
  saveAs: z.enum(['home', 'site', 'other']).catch('site').default('site'),
  label: Cut(60),
});
export type AppDelivery = z.output<typeof AppDelivery>;

/** "Plot 12, MIDC Satpur, near Bus Stop, Nashik, Maharashtra 422007": the address on one line, as staff read it. */
export const addressLineOf = (address: { addressLine: string; area?: string; landmark?: string; city: string; state: string; pincode: string }) =>
  [address.addressLine, address.area, address.landmark ? `near ${address.landmark}` : '', address.city, [address.state, address.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/**
 * The order's copy of where it goes, inside its transaction: the columns staff work with, the whole copy, and (when the
 * customer ticked it) a new entry in their address book, unless they already have the same address.
 */
export async function deliveryFor(tx: TransactionSql, accountId: number, delivery: AppDelivery) {
  const contact = tenDigits(delivery.contact) || delivery.contact;
  const alternate = tenDigits(delivery.alternateContact) || '';
  const snapshot = { ...delivery, contact, alternateContact: alternate, line: addressLineOf(delivery) };
  // The saved address it came from must be this account's; otherwise it's kept as a plain copy.
  const [saved] = delivery.addressId ? await tx`select id from customer_addresses where id = ${delivery.addressId} and account_id = ${accountId}` : [];
  let addressId = (saved?.id as number | undefined) ?? null;
  if (delivery.save && /^\d{6}$/.test(delivery.pincode) && delivery.addressLine && delivery.city) {
    const [same] = await tx`
      select id from customer_addresses
      where account_id = ${accountId} and lower(address_line) = lower(${delivery.addressLine}) and pincode = ${delivery.pincode} and lower(receiver_name) = lower(${delivery.receiverName})`;
    if (same) addressId = same.id as number;
    else {
      const [{ count }] = (await tx`select count(*)::int as count from customer_addresses where account_id = ${accountId}`) as unknown as [{ count: number }];
      const [made] = await tx`
        insert into customer_addresses ${tx({
          account_id: accountId,
          address_type: delivery.saveAs,
          label: delivery.label,
          receiver_name: delivery.receiverName,
          contact_number: contact,
          alternate_contact: alternate,
          site_name: delivery.siteName,
          address_line: delivery.addressLine,
          area: delivery.area,
          landmark: delivery.landmark,
          city: delivery.city,
          state: delivery.state,
          pincode: delivery.pincode,
          is_default: count === 0,
        })}
        returning id`;
      addressId = made!.id as number;
    }
  }
  return {
    delivery: tx.json(snapshot as never),
    delivery_receiver_name: delivery.receiverName,
    delivery_contact: contact,
    delivery_alternate_contact: alternate,
    delivery_address_type: delivery.type,
    delivery_site_name: delivery.siteName,
    delivery_instructions: delivery.instructions,
    delivery_address_id: addressId,
  };
}
