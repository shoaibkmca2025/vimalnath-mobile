/**
 * The admin on Cloudflare (free plan): the built admin is served as static files, and /v1/* is passed to the API on
 * Render. One address for both keeps the sign-in cookie first-party, and the app's phones use this address too.
 */
type Env = {
  ASSETS: Fetcher;
  /** The API's own address, e.g. https://vimalnath-api.onrender.com (admin.jsonc). */
  API_ORIGIN: string;
  /** Shared with the API (its PROXY_SECRET): the API refuses calls without it. Set with `wrangler secret put`. */
  PROXY_SECRET: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) return env.ASSETS.fetch(request);
    // The API trusts these only because the secret proves they came from here: who the visitor is (rate limits and
    // sign-in lockouts), and that it came over https. Anything a visitor sent under these names is replaced.
    const headers = new Headers(request.headers);
    headers.set('x-proxy-secret', env.PROXY_SECRET);
    headers.set('x-client-ip', request.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-forwarded-proto', 'https');
    return fetch(`${env.API_ORIGIN}${url.pathname}${url.search}`, { method: request.method, headers, body: request.body, redirect: 'manual' });
  },
} satisfies ExportedHandler<Env>;
