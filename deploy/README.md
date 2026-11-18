# Deploying (free plans: Cloudflare and Neon)

| Part | Where | Address |
| --- | --- | --- |
| Database | Neon project `vimalnath` (`empty-paper-39101544`, Singapore, Postgres 18), branch `main` | private connection string |
| API | Neon Function `api` on the same branch, next to the database | https://br-steep-morning-bi42869c-api.compute.c-5.ap-southeast-1.aws.neon.tech (only the Worker may call it) |
| Admin | Cloudflare Worker `vimalnath-admin`: the admin's files, and `/v1/*` passed to the API | https://vimalnath-admin.shoaibk-mca2024.workers.dev |
| App, web version | Cloudflare Worker `vimalnath-app` (static files) | https://vimalnath-app.shoaibk-mca2024.workers.dev |

Phones and the app's web version use the **admin address** as the shop's server address. The phone apps themselves are built with EAS.

## How the pieces trust each other

The Worker adds a secret header (`x-proxy-secret`) and the visitor's address (`x-client-ip`) to every `/v1` call. The API, given the same `PROXY_SECRET`, refuses calls without it (except `/v1/health`) and uses that address for rate limits and sign-in lockouts. Keep the two secrets identical.

## The API as a Neon Function

`server/src/function.ts` serves the same API (`server/src/api.ts`) that `server.ts` serves in Docker. Differences:

- Neon injects `DATABASE_URL`; the function uses `DATABASE_URL_UNPOOLED` when present, 5 connections per instance.
- There is no long-lived process, so a scheduled trigger calls `POST /internal/notify` every minute to send queued notifications. Only Neon's own trigger header gets through.
- Photos are resized with sharp's WebAssembly build (`npm run build:function` packs it), loaded on the first upload.
- Neon's free plan stops all writes at 1 GiB, and uploads are stored in the database: run "Remove Unused Files" in the Media Library now and then.

## First setup

1. **Neon CLI sign-in**, once: `npx neon@latest auth` (opens the browser).
2. **Database:** done. The migrations run from this computer; after adding a migration, run it before deploying:

   ```sh
   cd ../server
   DATABASE_URL='<neon direct url>' ADMIN_ORIGIN='https://vimalnath-admin.shoaibk-mca2024.workers.dev' node src/migrate.ts
   ```

3. **The function**, first deploy with its settings (later deploys keep them):

   ```sh
   npm install
   npm run build:function
   npx neon@latest functions deploy api --src function --no-bundle --project-id empty-paper-39101544 --branch main \
     --env NODE_ENV=production --env TRUST_PROXY=true \
     --env ADMIN_ORIGIN=https://vimalnath-admin.shoaibk-mca2024.workers.dev --env PROXY_SECRET=<the Worker's secret>
   npx neon@latest triggers create --function-slug api --name send-notifications --cron '* * * * *' \
     --function-path /internal/notify --project-id empty-paper-39101544 --branch main
   npx neon@latest functions get api --project-id empty-paper-39101544 --branch main   # shows invocation_url
   ```

   In Git Bash on Windows, run the trigger command with `MSYS_NO_PATHCONV=1` in front: otherwise Git Bash rewrites `/internal/notify` into a Windows path and Neon answers "invalid function trigger path".

4. **Cloudflare**, from this folder (`npx wrangler login` once): put the function's `invocation_url` (no trailing slash) in `API_ORIGIN` in `admin.jsonc`, then:

   ```sh
   npx wrangler secret put PROXY_SECRET --config admin.jsonc   # once
   npm run deploy:admin
   npm run deploy:app
   ```

5. **First Owner:** `DATABASE_URL='<neon url>' ADMIN_ORIGIN='https://vimalnath-admin.shoaibk-mca2024.workers.dev' node src/staff.ts owner@example.com "Owner Name"` from `server/` prints a one-time link to set the password.

## Later deploys

- API: `npm run deploy:function` (after `npx neon@latest auth`).
- Admin and app: `npm run deploy:admin` / `npm run deploy:app`.

## Other hosts

`render.yaml` (Render free) and the Docker image still work: the same API, with `server.ts` and its own 10-second sender. Render's free plan sleeps after 15 minutes and blocks SMTP.
