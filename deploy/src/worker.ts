/**
 * The old admin address on Cloudflare (free plan). The admin now lives on the VPS: its pages forward there, and /v1/* is
 * passed to the VPS API, because app installs from before the move still call this address.
 */
type Env = {
  /** The admin and API on the VPS, e.g. https://admin.94-103-163-234.sslip.io (admin.jsonc). */
  API_ORIGIN: string;
  /** Shared with the API (its PROXY_SECRET): the API refuses calls without it. Set with `wrangler secret put`. */
  PROXY_SECRET: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The admin itself lives on the VPS now; 302, not 301, so browsers don't remember it if the address changes again.
    if (!url.pathname.startsWith('/v1/')) return Response.redirect(`${env.API_ORIGIN}${url.pathname}${url.search}`, 302);
    // The API trusts these only because the secret proves they came from here: who the visitor is (rate limits and
    // sign-in lockouts), and that it came over https. Anything a visitor sent under these names is replaced.
    const headers = new Headers(request.headers);
    headers.set('x-proxy-secret', env.PROXY_SECRET);
    headers.set('x-client-ip', request.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-forwarded-proto', 'https');
    return fetch(`${env.API_ORIGIN}${url.pathname}${url.search}`, { method: request.method, headers, body: request.body, redirect: 'manual' });
  },
} satisfies ExportedHandler<Env>;
