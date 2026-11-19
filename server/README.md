# Vimalnath API

The backend for the mobile app and admin panel, following the plan in `docs/Vimalnath-Backend-Modules.pdf`. Built: Modules 1 to 12. The parts left are the glass formula numbers and material rules (8.3, 8.4), which stay in the app's code while Vimalnath confirms them; optional phone sign-in (3.3); and WhatsApp alerts (10.2). Push and email are built but only send once the accounts are set up (see Notifications below).

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
  app-users.ts The app's accounts and shop connection (/v1/app, including GET /v1/app/content for app sync) and the admin's App Users (/v1/admin/app-users)
  catalogue.ts Products, categories, price lists and the MRP history (/v1/admin/price-history) under /v1/admin (read: all staff; change: Owner and Catalogue editor)
  customers.ts Customers (/v1/admin/customers): each app user belongs to one; notes, tags and merging
  calculators.ts Cutlist systems, configurations and bar sections (/v1/admin/calculators, /cutlist, /bar-sections; change: Owner and Catalogue editor)
  content.ts   Banners, installation videos, More Apps and settings (/v1/admin/content, /banners, /videos, /more-apps; /settings is Owner only)
  activity.ts  The activity log (/v1/admin/activity): who changed what and when; Owners see everyone's, others their own; nothing edits or deletes it
  versions.ts  A save counter per whole list (/v1/admin/versions): a save from an out-of-date admin tab is refused (409) instead of replacing a newer change
  orders.ts    Orders from the app (numbered VSC-0001 on), and /v1/admin/orders for order requests staff send to a customer's app, status changes, and internal and inventory notes. The Inventory manager role sees only confirmed, packed, dispatched and delivered orders, and moves them between Pending (confirmed), Packed and Dispatched
  media.ts     Uploads (POST /v1/admin/media: photos up to 5 MB, PDFs up to 25 MB), serving them at /v1/media/<id>.webp, -md.webp, -sm.webp or .pdf,
               and the media library: where each file is used, delete one nothing uses, and Owner cleanup of unused files over a day old
  notifications.ts  New-order emails to staff and order updates pushed to customers: queued with the change, sent every 10 seconds, three tries,
               logged; wording, recipients and broadcasts under /v1/admin/notifications (Owner only)
  validate.ts  Checks input; a route uses jsonBody(schema)
  config.ts    Reads and checks the settings at startup
  migrate.ts   Applies new migrations
  import-data.ts  One-time copy of the app's data
```

Every error looks like `{ "error": { "message": "...", "field": "name" } }`. `field` appears only when one input is at fault.

**The app's accounts.** A customer creates an account in the app with their mobile number and a password; each account starts as its own customer, and staff see it under App Users. Logging in gives the phone a token; logging in on another phone signs the first one out. A customer who forgets their password asks the shop, and Owner or Sales staff set a new one in App Users (`PATCH /v1/admin/app-users/:id` with `{ password }`), which also signs the phone out. Five wrong passwords lock a number for 15 minutes.

| Route | What it does |
|---|---|
| `POST /v1/app/register` | `{ name, business?, city?, email?, phone, password }` → `{ token, customerId }`. 409 if the number already has an account. |
| `POST /v1/app/login` | `{ phone, password }` → `{ token, customerId, profile }`. The phone's earlier token stops working. |
| `POST /v1/app/logout` | The token stops working and the phone stops getting order updates. |

The app sends `Authorization: Bearer <token>` to every other route here:

| Route | What it does |
|---|---|
| `GET /v1/app/orders` | `{ customerId, orders }`: each order's shop number, status and history. An order staff sent (`source: "admin"`) also carries its `details`. The app checks this around every sync. |
| `POST /v1/app/orders/:id/respond` | `{ decision: "confirm" | "decline" }` for an order staff sent. Confirmed, it goes to the inventory team. |
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

## Notifications (Module 10)

Everything is built; sending needs two accounts only the shop can set up:

- **Staff emails:** add `SMTP_URL` (and optionally `MAIL_FROM`) to the server's settings, e.g. a Gmail app password:
  `smtps://you%40gmail.com:app-password@smtp.gmail.com`. Until then each email shows as "Not set up" in the delivery log.
- **Push to customers:** build the app with an Expo (EAS) project that has Firebase (Android) and Apple push credentials,
  so phones can get a push address. Expo Go can't receive push on Android. The server needs nothing for push unless
  enhanced push security is on in the Expo dashboard (then set `EXPO_ACCESS_TOKEN`).
