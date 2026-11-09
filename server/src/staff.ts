import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { clientOf } from './app.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { jsonBody, parse } from './validate.ts';

const ROLES = ['owner', 'sales', 'catalogue'] as const;
type Role = (typeof ROLES)[number];
type Staff = { id: number; name: string; email: string; role: Role };
type Env = { Variables: { staff: Staff; sessionHash: string } };

const COOKIE = 'vimalnath_session';
const EMAIL_USED = 'Someone already uses that email.';
const BAD_LINK = 'This link has expired or was already used. Ask the Owner for a new one.';
const MAX_ATTEMPTS = 5;

const Email = z.string().trim().toLowerCase().pipe(z.email('Enter an email address like name@company.com.'));
const Name = z.string().trim().min(1, 'Enter their name.').max(100, 'Use 100 characters or fewer.');
const Role = z.enum(ROLES, 'Choose a role.');
const NewPassword = z.string().min(10, 'Use at least 10 characters.').max(200, 'Use 200 characters or fewer.');
const StaffId = z.coerce.number().int().positive().max(2147483647);

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 32, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))),
  );

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${(await derive(password, salt)).toString('base64')}`;
}

async function passwordMatches(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(await derive(password, Buffer.from(salt!, 'base64')), Buffer.from(key!, 'base64'));
}

const dummyHash = hashPassword(randomBytes(16).toString('hex'));
const newToken = () => randomBytes(32).toString('base64url');
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** A one-time link to set a password, valid for 3 days. Replaces any earlier link for that person. */
export async function issuePasswordLink(sql: Sql, staffId: number, adminOrigin: string) {
  const token = newToken();
  await sql.begin(async (tx) => {
    await tx`delete from password_tokens where staff_id = ${staffId} or expires_at < now()`;
    await tx`insert into password_tokens (token_hash, staff_id, expires_at) values (${sha256(token)}, ${staffId}, now() + interval '3 days')`;
  });
  return `${adminOrigin}/set-password?token=${token}`;
}

/** Everything under /v1/admin. Routes added after the sign-in check are private by default. */
export function adminRoutes(sql: Sql, { adminOrigin, production, trustProxy }: { adminOrigin: string; production: boolean; trustProxy: boolean }) {
  const admin = new Hono<Env>();
  const publicColumns = () => sql`id, name, email, role, active, password_hash is not null as "hasPassword", last_sign_in_at as "lastSignInAt"`;
  const cookie = { httpOnly: true, secure: production, sameSite: 'Strict', path: '/v1/admin' } as const;
  const staffId = (c: Context) => parse(StaffId, c.req.param('id'));

  admin.post('/auth/sign-in', jsonBody(z.object({ email: Email, password: z.string().min(1, 'Enter your password.').max(200) })), async (c) => {
    const { email, password } = c.req.valid('json');
    const client = clientOf(c, trustProxy);
    const [row] = await sql`select id, name, email, role, password_hash, active from staff_users where email = ${email}`;
    // Counted before the password check, so guesses sent together can't all get past the limit.
    const [attempt] = row
      ? await sql`
          insert into sign_in_attempts as a (email, client, expires_at) values (${email}, ${client}, now() + interval '15 minutes')
          on conflict (email, client) do update set
            attempts = case when a.expires_at <= now() then 1 else a.attempts + 1 end,
            expires_at = case when a.expires_at <= now() or a.attempts < ${MAX_ATTEMPTS} then excluded.expires_at else a.expires_at end
          returning attempts`
      : [];
    // Hash even with nothing to compare, so the response time doesn't reveal which emails exist.
    const matches = await passwordMatches(password, row?.password_hash ?? (await dummyHash));
    // One message for every failure, so it can't be used to find out which accounts exist.
    if (!row || !row.active || !row.password_hash || attempt!.attempts > MAX_ATTEMPTS || !matches) {
      throw new HTTPException(401, { message: 'Wrong email or password. After 5 wrong tries, sign-in is locked for 15 minutes.' });
    }
    const token = newToken();
    await sql.begin(async (tx) => {
      await tx`delete from staff_sessions where expires_at < now()`;
      await tx`delete from sign_in_attempts where expires_at < now() or (email = ${email} and client = ${client})`;
      await tx`insert into staff_sessions (token_hash, staff_id, expires_at) values (${sha256(token)}, ${row.id}, now() + interval '12 hours')`;
      await tx`update staff_users set last_sign_in_at = now() where id = ${row.id}`;
    });
    setCookie(c, COOKIE, token, cookie);
    return c.json({ id: row.id, name: row.name, email: row.email, role: row.role });
  });

  admin.post('/auth/set-password', jsonBody(z.object({ token: z.string().min(1, BAD_LINK).max(100, BAD_LINK), password: NewPassword })), async (c) => {
    const { token, password } = c.req.valid('json');
    const hash = await hashPassword(password);
    const done = await sql.begin(async (tx) => {
      const [used] = await tx`delete from password_tokens where token_hash = ${sha256(token)} and expires_at > now() returning staff_id`;
      if (!used) return false;
      const [staff] = await tx`update staff_users set password_hash = ${hash} where id = ${used.staff_id} and active returning email`;
      await tx`delete from staff_sessions where staff_id = ${used.staff_id}`;
      if (staff) await tx`delete from sign_in_attempts where email = ${staff.email}`;
      return Boolean(staff);
    });
    if (!done) throw new HTTPException(400, { message: BAD_LINK });
    return c.body(null, 204);
  });

  // Each request also pushes the expiry back, so a session only ends after 12 hours of no use.
  admin.use(async (c, next) => {
    const token = getCookie(c, COOKIE);
    const hash = token ? sha256(token) : '';
    const [staff] = await sql<Staff[]>`
      update staff_sessions s set expires_at = now() + interval '12 hours'
      from staff_users u
      where s.token_hash = ${hash} and s.expires_at > now() and u.id = s.staff_id and u.active
      returning u.id, u.name, u.email, u.role`;
    if (!staff) throw new HTTPException(401, { message: 'Please sign in.' });
    c.set('staff', staff);
    c.set('sessionHash', hash);
    await next();
  });

  const only = (...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    if (!roles.includes(c.get('staff').role)) throw new HTTPException(403, { message: 'You do not have access to this.' });
    await next();
  };

  admin.get('/me', (c) => c.json(c.get('staff')));

  admin.post('/auth/sign-out', async (c) => {
    await sql`delete from staff_sessions where token_hash = ${c.get('sessionHash')}`;
    deleteCookie(c, COOKIE, cookie);
    return c.body(null, 204);
  });

  admin.post('/auth/change-password', jsonBody(z.object({ current: z.string().max(200), password: NewPassword })), async (c) => {
    const { current, password } = c.req.valid('json');
    const me = c.get('staff').id;
    const [row] = await sql`select password_hash from staff_users where id = ${me}`;
    if (!(await passwordMatches(current, row!.password_hash))) throw new HTTPException(400, { message: 'Your current password is wrong.', cause: { field: 'current' } });
    const hash = await hashPassword(password);
    await sql.begin(async (tx) => {
      await tx`update staff_users set password_hash = ${hash} where id = ${me}`;
      await tx`delete from staff_sessions where staff_id = ${me} and token_hash <> ${c.get('sessionHash')}`;
    });
    return c.body(null, 204);
  });

  admin.get('/staff', only('owner'), async (c) => c.json(await sql`select ${publicColumns()} from staff_users order by name`));

  admin.post('/staff', only('owner'), jsonBody(z.object({ name: Name, email: Email, role: Role })), async (c) => {
    const [staff] = await sql`insert into staff_users ${sql(c.req.valid('json'))} on conflict (email) do nothing returning ${publicColumns()}`;
    if (!staff) throw new HTTPException(409, { message: EMAIL_USED, cause: { field: 'email' } });
    return c.json({ staff, link: await issuePasswordLink(sql, staff.id, adminOrigin) }, 201);
  });

  const StaffChange = z.object({ name: Name.optional(), email: Email.optional(), role: Role.optional(), active: z.boolean().optional() }).refine((change) => Object.keys(change).length > 0, 'Nothing to change.');

  admin.patch('/staff/:id', only('owner'), jsonBody(StaffChange), async (c) => {
    const id = staffId(c);
    const change = c.req.valid('json');
    const staff = await sql.begin(async (tx) => {
      // Locking the Owners makes two of them demoting each other take turns, so one always remains.
      const owners = await tx`select id from staff_users where role = 'owner' and active for update`;
      const removesOwner = change.active === false || (change.role !== undefined && change.role !== 'owner');
      if (removesOwner && owners.length === 1 && owners[0]!.id === id) throw new HTTPException(400, { message: 'There must always be at least one active Owner.' });
      const [updated] = await tx`update staff_users set ${tx(change)} where id = ${id} returning ${publicColumns()}`.catch((error: { code?: string }) => {
        if (error.code === '23505') throw new HTTPException(409, { message: EMAIL_USED, cause: { field: 'email' } });
        throw error;
      });
      if (updated && change.active === false) await tx`delete from staff_sessions where staff_id = ${id}`;
      return updated;
    });
    if (!staff) throw new HTTPException(404, { message: 'That staff member does not exist.' });
    return c.json(staff);
  });

  admin.post('/staff/:id/password-link', only('owner'), async (c) => {
    const id = staffId(c);
    const [target] = await sql`select id from staff_users where id = ${id} and active`;
    if (!target) throw new HTTPException(404, { message: 'That staff member is not active.' });
    return c.json({ link: await issuePasswordLink(sql, id, adminOrigin) });
  });

  return admin;
}

// npm run owner-link -- email@company.com "Their Name": the first account, or a way back in for a locked-out Owner.
if (import.meta.main) {
  const parsed = Email.safeParse(process.argv[2]);
  if (!parsed.success) {
    console.error('Usage: npm run owner-link -- you@company.com "Your Name"');
    process.exit(1);
  }
  const email = parsed.data;
  const name = parse(Name, process.argv[3] ?? email);
  const { DATABASE_URL, ADMIN_ORIGIN } = loadConfig();
  const sql = connect(DATABASE_URL);
  try {
    const [owner] = await sql`
      insert into staff_users (name, email, role) values (${name}, ${email}, 'owner')
      on conflict (email) do update set role = 'owner', active = true
      returning id`;
    await sql`delete from sign_in_attempts where email = ${email}`;
    console.log(`Open this link to set the password (one use, 3 days):\n${await issuePasswordLink(sql, owner!.id, ADMIN_ORIGIN)}`);
  } finally {
    await sql.end();
  }
}
