# Vimalnath API

The backend for the mobile app and admin panel, following the plan in `docs/Vimalnath-Backend-Modules.pdf`. Built so far: Module 1 (API server, database, security, deployment), Module 2 (staff sign-in and roles), Module 3 (app users), Module 4 (catalogue: products, categories and price lists, edited in the admin), Module 5 (photo and PDF uploads) and Module 6 (orders).

Needs Node 24.2 or newer, which runs the TypeScript directly, so there is no build step.

## Run it on this computer

To run everything in Docker instead, see the repo's main README. For working on the API itself:

```bash
cd server
npm install
cp .env.example .env
docker compose up -d db        # a local PostgreSQL, from the repo root's compose file (start Docker Desktop first)
npm run migrate                # creates the tables
(cd ../admin && npm install && npm run seed)  # once: builds the data file from the app
npm run import-data            # once: copies the app's data into the database
npm run owner-link -- you@company.com "Your Name"   # prints a link to set the first password
npm run dev                    # http://localhost:3000/v1/health
```

Run `npm run owner-link` again if the Owner is ever locked out. Staff who forget their password get a new link from the Staff page.

```bash
npm test             # database tests need DATABASE_URL, and are skipped without it
npm run typecheck
```

## Structure

```
migrations/    Database changes, applied in name order
src/
  server.ts    Starts the API and shuts it down cleanly
  app.ts       Routes, security, request limits and the one error format
  staff.ts     Staff sign-in, roles and everything under /v1/admin
  app-users.ts The app's shop connection (/v1/app) and the admin's App Users (/v1/admin/app-users)
  catalogue.ts Products, categories and price lists under /v1/admin (read: all staff; change: Owner and Catalogue editor)
  orders.ts    Orders from the app (numbered VSC-0001 on), and /v1/admin/orders for status changes and internal notes
  media.ts     Uploads (POST /v1/admin/media: photos up to 5 MB, PDFs up to 25 MB) and serving them at /v1/media/<id>.webp, -md.webp, -sm.webp or .pdf
  validate.ts  Checks input; a route uses jsonBody(schema)
  config.ts    Reads and checks the settings at startup
  migrate.ts   Applies new migrations
  import-data.ts  One-time copy of the app's data
```

Every error looks like `{ "error": { "message": "...", "field": "name" } }`. `field` appears only when one input is at fault.

**The app's shop connection.** Staff add a customer under App Users and send them the token. The customer enters it in the app under Settings → Shop connection. The app then sends `Authorization: Bearer <token>` to:

| Route | What it does |
|---|---|
| `GET /v1/app/orders` | `{ customerId, orders }`: each order's shop number, status and history. The app checks this around every sync. |
| `POST /v1/app/orders` | `{ eventId, order }`. Saved once however often it's sent, at the server's prices; lines that no longer match the catalogue are flagged for staff, not refused. |
| `POST /v1/app/profile` | `{ eventId, profile }`, the User screen's details. |
| `POST /v1/app/activity` | A product view, sent only if the customer turned on activity sharing. |

The app sends these one at a time, in order, and stops at the first one refused. So the server accepts a resend without storing it twice and shortens over-long text instead of refusing it. Only a malformed order is refused.

## Changing the database

Add a new file such as `migrations/005_orders.sql`, then run `npm run migrate`. Never edit a file that has already been applied. The Docker image applies new migrations each time it starts.

## Before going live

These depend on where it's hosted:

- Set `NODE_ENV=production`, `DATABASE_URL`, `ADMIN_ORIGIN` and `TRUST_PROXY=true` in the host's secret settings.
- Serve `/v1` on the same domain as the admin, because the admin calls it with relative addresses and the sign-in cookie is same-site only.
- Turn on daily database backups and test one restore.
- Point an uptime monitor at `/v1/health`. It returns 503 when the database is down.
- The `Dockerfile` here is the API image. The repo-root `docker-compose.yml` is for one computer, over plain http.
- Set up a staging copy and automatic deploys. `.github/workflows/server.yml` already runs the checks.
