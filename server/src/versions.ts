import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import type { Env } from './staff.ts';

/** The version of the list that the admin loaded. Scripts and tests may leave it out: their save isn't checked, but still counts. */
export const Seen = z.number().int().min(0).optional();

/**
 * Call first inside a whole-list save's transaction. It counts the save, and refuses it when the list was saved since
 * `seen`, so one person's out-of-date copy never quietly replaces another's change. The row lock makes two saves at
 * the same moment take turns, and the second is refused.
 */
export async function claimList(tx: TransactionSql, name: string, seen: number | undefined) {
  const [row] = await tx`update list_versions set version = version + 1 where name = ${name} ${seen === undefined ? tx`` : tx`and version = ${seen}`} returning version`;
  if (!row) throw new HTTPException(409, { message: 'Someone else changed this list. Reload to see their change.' });
}

/** Every list's version, read by the admin before the lists themselves. */
export function versionRoutes(sql: Sql) {
  return new Hono<Env>().get('/versions', async (c) => c.json(Object.fromEntries((await sql`select name, version from list_versions`).map((row) => [row.name, row.version]))));
}
