import postgres from 'postgres';

/** Gives up on a connection after 5 seconds, so the health check fails fast when the database is down. */
export const connect = (url: string) => postgres(url, { connect_timeout: 5, onnotice: () => {} });
