# Vimalnath Admin: shop management roadmap

The plan for turning the admin into a complete management system for an architectural hardware shop: products, stock, purchases, sales, GST billing, customers, suppliers, orders, payments, expenses and reports. It builds on what exists; nothing that works is replaced.

Status: ✅ done · 🔨 being built · ⬜ planned

## 1. What exists today

| Part | Stack | Where |
| --- | --- | --- |
| Customer app | Expo (React Native) for Android, iOS and web | `src/` |
| Admin | React 19 + Vite + React Router, own component set (no UI library), light and dark themes | `admin/` |
| API | Hono on Node, Postgres via `postgres`, Zod validation, cookie sessions for staff, tokens for phones | `server/` |
| Database | Postgres (Neon online, Docker locally), plain SQL migrations run in order | `server/migrations/` |
| Hosting | API as a Neon Function; admin and the app's web version as Cloudflare Workers | `deploy/` |

Working modules:

- **Sign-in and staff**: Owner, Sales, Catalogue editor and Inventory manager roles; password links; sign-in lockouts; activity log of every change.
- **Catalogue**: 650 products, options (variants) with MRP, specs, photos, categories (add, edit, reorder), price lists (add PDFs), price history.
- **Orders**: orders from the app, order requests sent from the admin, confirm → pack → dispatch → deliver, inventory panel, notes, print.
- **Customers**: profile from their app, tags, notes, merge duplicates, orders, what they buy.
- **Payments**: bill per order (cash or credit, editable amount), payments by cash, UPI, bank or cheque, split across a customer's oldest bills, overdue alerts after the credit period.
- **Stock**: stock per product option, prices (purchase, selling, wholesale), GST rate, HSN, unit, min and max, rack and warehouse, stock ledger with every change, add/take away/count, CSV import and export, delivered orders take stock out automatically, add, edit and delete products from the Stock page.
- **Dashboard**: today's sales, pending customer payments, stock value, low stock, sales by month, order figures, needs-attention list.
- **App content**: banners, videos, More Apps, notifications to phones, settings.

## 2. Architecture

The existing stack stays. New modules follow the patterns already in place:

- **One API, one database.** Each module is a set of tables (a migration), a Hono route file in `server/src/`, and admin pages in `admin/src/pages/`.
- **Ledgers, not overwritten balances.** Stock changes go through `stock_moves`; money goes through payment rows. A balance is the sum of its ledger, or is updated in the same transaction as the ledger row.
- **The server calculates.** Totals, tax and balances are worked out on the server from the lines; the admin's figures are previews.
- **Exactly once.** Anything that moves stock or money is a status change inside one locked transaction (draft → received, dispatched → delivered), and its reversal undoes exactly what it did.
- **Nothing financial is erased.** Drafts can be deleted; posted records are cancelled or reversed, with who and when.
- **Money**: whole rupees where the shop prices in rupees (MRP, order bills); rupees and paise (`numeric(14,2)`) for purchase rates, tax and supplier bills.
- **Roles** are checked on the server for every route; the admin hides what a role can't use.

## 3. Navigation

| Group | Page | Status |
| --- | --- | --- |
| Overview | Dashboard | ✅ (purchase cards 🔨) |
| Sales | Orders, Order Requests, Inventory (packing) | ✅ |
| Sales | Customers, Payments | ✅ |
| GST | GST Dashboard (with GSTR-3B working), Sales Register, tax invoices, Purchase Register (input tax credit), HSN Summary, GST Payments, GST Settings | ✅ |
| GST | GSTR-1 sections and export, GSTR-2B matching, credit and debit notes | ⬜ Phase 3 |
| Sales | Quotations, returns | ⬜ Phase 3 |
| Sales | Feedback from the app | ✅ |
| Purchases | Purchases, Suppliers | ✅ |
| Purchases | Expenses | ⬜ Phase 4 |
| Catalogue | Products, Stock, Prices, Categories, Price Lists | ✅ |
| Reports | Sales, purchases, stock, GST, profit and loss | ⬜ Phase 4 |
| App Content | Banners, videos, More Apps, media | ✅ |
| System | Activity, Staff, Notifications, Settings | ✅ (permissions ⬜) |

## 4. Database

Existing tables: `staff_users`, `customers`, `app_devices`, `products`, `product_options`, `categories`, `price_lists`, `orders`, `order_lines`, `order_events`, `order_payments`, `stock_items`, `stock_moves`, `notification_*`, `activity_log`, `settings`, `media_files`, and others.

New tables, by phase:

| Phase | Tables |
| --- | --- |
| 2 (✅) | `suppliers`, `purchases`, `purchase_items`, `supplier_payments`; `stock_moves` gains purchase moves |
| 3 (part ✅) | `gst_settings`, `sales_invoices`, `sales_invoice_items`, `invoice_counters`, `gst_payments`, purchases' `itc_*` columns, customers' GST columns; next: `credit_notes`,, `invoice_items`, `quotations`, `quotation_items`, `credit_notes`, `returns`, `return_items`, `invoice_numbers` (per type, per financial year); `customers` gains GSTIN, addresses, state, credit limit, opening balance |
| 4 | `expenses`, `expense_categories`, `documents`; reports read existing tables |
| 5 | `permissions` (per role), `notifications` for staff, barcode labels |

Key relations: a purchase belongs to a supplier and has items pointing at a stock item (product + option); a stock move points at the order or purchase that caused it; a supplier payment points at a supplier and, usually, one purchase.

## 5. Workflows

- **Purchase**: draft (editable, deletable) → **Receive goods** → stock goes up for each line, exactly once, and the item's purchase price becomes the bill's rate → payments recorded against the bill. A received bill can't be edited; cancelling it takes the stock back out and keeps the record.
- **Sale from the app**: placed → confirmed → packed → dispatched → **delivered**: stock goes down once. Moving it back from delivered puts the stock back.
- **Customer payment**: against one bill, or one payment split over the oldest bills. Overdue after the credit period (Settings).
- **Supplier payment**: against one bill, or on account; outstanding = opening balance + received bills − payments.
- **Stock count**: enter the counted quantity; the difference is recorded as a count.
- **GST invoice** (Phase 3): draft → posted (numbered per financial year) → cancelled or credit note. CGST + SGST inside the state, IGST outside, from the customer's state.

## 6. Roadmap

| Phase | Contents | Status |
| --- | --- | --- |
| 1. Core | Sign-in, dashboard, products and categories, stock and stock ledger, customers, customer payments | ✅ |
| 2. Purchases | Suppliers (profile, ledger, outstanding), purchase bills with items, freight, discount and GST, receive goods → stock in, supplier payments, bill attachment, dashboard purchase cards | ✅ |
| 3. Billing and GST | Done: GST settings, customer GST details, tax invoices from orders (CGST/SGST or IGST by place of supply, numbered per financial year, print, cancel), purchase tax split and input tax credit review, registers, HSN summary, GSTR-3B working with the legal set-off order, GST payments. Next: GSTR-1 sections and JSON/Excel export, GSTR-2B upload and matching, credit and debit notes with returns, quotations, WhatsApp sharing, credit limits | 🔨 |
| 4. Accounts and reports | Expenses, cash and bank book, sales, purchase, stock and GST reports, profit and loss, Excel and PDF export | ⬜ |
| 5. Advanced | Barcodes and QR labels, barcode billing, Accountant and Manager roles with permissions, staff notifications, stock ageing, customer-specific prices | ⬜ |

## 7. Decisions needed

1. **Official GST invoices.** Decided 21 Nov 2026: the admin issues the GST tax invoices. The registration type is a setting (Regular by default) for the accountant to confirm.
2. **When stock goes out.** Now: when an order is marked delivered. It can be made a setting (confirmed, dispatched or delivered).
3. **New roles.** Accountant and Manager arrive with permissions in Phase 5; until then purchases and suppliers are Owner-only.
