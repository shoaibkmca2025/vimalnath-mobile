import { after, before } from 'node:test';

import postgres from 'postgres';

import { connect } from '../src/db.ts';

export const needsDatabase = process.env.DATABASE_URL ? false : 'needs DATABASE_URL (see .env.example)';

/** A throwaway database for one test file, so tests never touch real data. */
export function testDatabase(label: string, setup?: (sql: postgres.Sql) => Promise<void>) {
  const url = process.env.DATABASE_URL;
  const name = `vimalnath_test_${label}_${process.pid}`;
  const server = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const db: { sql: postgres.Sql } = { sql: null as never };

  before(async () => {
    if (!server) return;
    await server.unsafe(`create database ${name}`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    db.sql = connect(testUrl.href);
    await setup?.(db.sql);
  });

  after(async () => {
    if (!server) return;
    await db.sql.end();
    await server.unsafe(`drop database ${name}`);
    await server.end();
  });

  return db;
}
