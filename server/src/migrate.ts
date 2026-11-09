import { readdir, readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

import { loadConfig } from './config.ts';
import { connect } from './db.ts';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
/** Any fixed number. Two deploys at once take turns instead of applying the same change twice. */
const LOCK_ID = 7410001;

/** Applies the .sql files not yet recorded, in name order. All of them land together or not at all. */
export async function migrate(sql: Sql, dir: URL = MIGRATIONS) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await tx`select name from schema_migrations`).map((row) => row.name as string));
    const pending = files.filter((file) => !applied.has(file));
    for (const name of pending) {
      await tx.unsafe(await readFile(new URL(name, dir), 'utf8'));
      await tx`insert into schema_migrations (name) values (${name})`;
    }
    return pending;
  });
}

if (import.meta.main) {
  const sql = connect(loadConfig().DATABASE_URL);
  try {
    const applied = await migrate(sql);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'The database is up to date.');
  } finally {
    await sql.end();
  }
}
