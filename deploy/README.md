# Deploying (free plans: Cloudflare, Render, Neon)

| Part | Where | Address |
| --- | --- | --- |
| Database | Neon project `vimalnath` (Singapore) | private connection string |
| API | Render free web service `vimalnath-api` (Singapore), from `render.yaml` | https://vimalnath-api.onrender.com (only the Worker may call it) |
| Admin | Cloudflare Worker `vimalnath-admin`: the admin's files, and `/v1/*` passed to the API | https://vimalnath-admin.shoaibk-mca2024.workers.dev |
| App, web version | Cloudflare Worker `vimalnath-app` (static files) | https://vimalnath-app.shoaibk-mca2024.workers.dev |

Phones and the app's web version use the **admin address** as the shop's server address. The phone apps themselves are built with EAS.

## How the pieces trust each other

The Worker adds a secret header (`x-proxy-secret`) and the visitor's address (`x-client-ip`) to every `/v1` call. The API, given the same `PROXY_SECRET`, refuses calls without it (except `/v1/health`, for Render's checks) and uses that address for rate limits and sign-in lockouts. Keep the two secrets identical.

## Free-plan limits

- Render sleeps the API after 15 minutes without visits; the next visit waits about a minute. Notifications queued meanwhile go out when it wakes.
- Render's free plan blocks SMTP, so staff emails show as "Not set up". Push to phones works.
- Neon's free plan stops all writes at 1 GiB. Uploads are stored in the database: run "Remove Unused Files" in the Media Library now and then, and upgrade before it nears the limit.
- Cloudflare's free plan allows 100,000 Worker requests a day.

## First setup

1. **Neon:** done. The 14 migrations and the catalogue import ran; new migrations run by themselves when the API starts.
2. **Render:** New → Blueprint → this repository. It reads `render.yaml` and asks for:
   - `DATABASE_URL`: Neon's **direct** connection string (host without `-pooler`), ending `?sslmode=require`.
   - `PROXY_SECRET`: the same value as the Worker's.
3. **Cloudflare**, from this folder (`npx wrangler login` once):

   ```sh
   npm install
   npx wrangler secret put PROXY_SECRET --config admin.jsonc
   npm run deploy:admin
   npm run deploy:app
   ```

   If Render named the service differently, change `API_ORIGIN` in `admin.jsonc` and deploy again.
4. **First Owner:**

   ```sh
   cd ../server
   DATABASE_URL='<neon url>' ADMIN_ORIGIN='https://vimalnath-admin.shoaibk-mca2024.workers.dev' node src/staff.ts owner@example.com "Owner Name"
   ```

   It prints a one-time link to set the password.

## Later deploys

- API: push to GitHub; Render rebuilds on each commit that touches `server/`.
- Admin and app: `npm run deploy:admin` / `npm run deploy:app` from this folder.

## Moving to paid plans later

With the Workers Paid plan the API can run on Cloudflare itself as a Container (no sleeping, email works); ask for the Containers setup that was prepared before this free one.
