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
| GST | Credit notes for returns (Sales Register tab, GSTR-3B and HSN net of them) | ✅ |
| GST | GSTR-1 working (B2B, B2C Large and Small, CDNR, CDNUR, documents issued; CSV per section in the offline tool's columns) | ✅ |
| GST | GSTR-2B matching, debit notes | ⬜ Phase 3 |
| Billing | Billing (dashboard and every bill), New Bill, Quotations, Discount Approvals (red count), Discount Management, Discount Report, Invoice Settings (Owner) | ✅ |
| Returns & Replacements | Returns Dashboard, Customer Returns, Product Replacements, Refund Management, Return Requests, Supplier Returns, Return Reports, Return Settings | ✅ |
| Sales | Feedback from the app | ✅ |
| Purchases | Purchases, Suppliers | ✅ |
| Purchases | Expenses (Accountant enters, Owner approves; bill upload; GST and seller GSTIN; cancelled, never deleted once approved) | ✅ |
| Catalogue | Products, Stock, Prices, Categories, Price Lists | ✅ |
| Reports | Profit & Loss (Tally's trading and P&L layout), Sales (day, week, month, year, customer, product, category, salesperson), Purchases, Stock (valuation, low and out, damaged and returned, movement), Cash & Bank books with the daily collection, Outstanding (customers and suppliers); CSV export and print | ✅ |
| App Content | Banners, videos, More Apps, media | ✅ |
| System | Activity, Staff, Notifications, Settings | ✅ (permissions ⬜) |

## 4. Database

Existing tables: `staff_users`, `customers`, `app_devices`, `products`, `product_options`, `categories`, `price_lists`, `orders`, `order_lines`, `order_events`, `order_payments`, `stock_items`, `stock_moves`, `notification_*`, `activity_log`, `settings`, `media_files`, and others.

New tables, by phase:

| Phase | Tables |
| --- | --- |
| 2 (✅) | `suppliers`, `purchases`, `purchase_items`, `supplier_payments`; `stock_moves` gains purchase moves |
| 3 (part ✅) | `gst_settings`, `sales_invoices`, `sales_invoice_items`, `invoice_counters`, `gst_payments`, purchases' `itc_*` columns, customers' GST columns; next: `credit_notes`,, `invoice_items`, `quotations`, `quotation_items`, `credit_notes`, `returns`, `return_items`, `invoice_numbers` (per type, per financial year); `customers` gains GSTIN, addresses, state, credit limit, opening balance |
| Returns (✅) | `return_settings`, `sales_returns`, `sales_return_items`, `replacement_items`, `return_events` (status history and audit log), `refund_transactions`, `sales_credit_notes`, `supplier_returns`, `supplier_return_items`, `supplier_return_events`; `stock_items` gains `held`, `damaged`, `defective`; `stock_moves` gains `bucket`, `return_id`, `supplier_return_id`; `sales_invoices` gains `return_id`; `order_payments` gains `refund_id` and the methods `return` and `store_credit` (migration 025) |
| 4 (✅) | `expenses`, `book_openings` (migration 027); reports read the existing tables (`server/src/reports.ts`) |
| Billing (✅) | `measurement_units`, `invoice_payments`, `invoice_events` (audit with before and after), `quotations`, `quotation_items`; `sales_invoices.order_id` optional (counter bills) with customer, due date, GST-inclusive rates, bill discount, version; lines gain SKU, ₹ discount, charge lines; `stock_moves.invoice_id`; Invoice Settings columns on `gst_settings` (migration 029) |
| Discounts (✅) | `discount_rules` (default, category, product), `discount_approvals`, `discount_events`; staff discount level and limit; each bill and quotation line keeps the rule it was billed under (migration 030). Returns from counter bills: `sales_returns.order_id` optional (migration 031) |
| 5 | `permissions` (per role), `notifications` for staff, barcode labels |

Key relations: a purchase belongs to a supplier and has items pointing at a stock item (product + option); a stock move points at the order or purchase that caused it; a supplier payment points at a supplier and, usually, one purchase.

## 5. Workflows

- **Purchase**: draft (editable, deletable) → **Receive goods** → stock goes up for each line, exactly once, and the item's purchase price becomes the bill's rate → payments recorded against the bill. A received bill can't be edited; cancelling it takes the stock back out and keeps the record.
- **Sale from the app**: placed → confirmed → packed → dispatched → **delivered**: stock goes down once. Moving it back from delivered puts the stock back.
- **Customer payment**: against one bill, or one payment split over the oldest bills. Overdue after the credit period (Settings).
- **Supplier payment**: against one bill, or on account; outstanding = opening balance + received bills − payments.
- **Stock count**: enter the counted quantity; the difference is recorded as a count.
- **GST invoice** (Phase 3): draft → posted (numbered per financial year) → cancelled or credit note. CGST + SGST inside the state, IGST outside, from the customer's state.
  Printed in the shop's own Tally format (their invoice VSC-26-27-412): rate before GST less a discount per line, GST on the total at each rate (CGST and SGST at half the rate each), rounded to the rupee; numbers `VSC-26-27-413` carry on from the last Tally number set in GST Settings; ship-to and bill-to with contacts, the reference boxes, the buyer's previous and current balance, an HSN/SAC tax table, amounts in words ("INR … Only"), bank details, declaration and jurisdiction.

## 5b. Counter billing and discounts (built)

**Bills** (`server/src/billing.ts`, `/v1/admin/billing`; Owners and Sales make them, the Accountant reads them and voids payments). A counter bill is a tax invoice without an order, in the same VSC series as order invoices.

- **Lines**: products from stock (billed in their stock unit), items typed by hand (any unit, including the shop's own from Invoice Settings), and charges (transport, packing: taxed, never discounted or taken from stock). A rate can be changed on the bill without touching the product's price.
- **Figures** (`computeInvoice`, the same on the server and in the editor): qty × rate less the line's % and ₹ discounts; rates typed with GST are taken back to before it; the bill discount is shared over the goods by value; GST at each rate (CGST + SGST, or IGST for another state; none for a composition dealer); rounded to the rupee. Grand total = taxable + GST + round off; balance = total − payments.
- **Steps**: draft (saved with Ctrl+S, deletable while it has no number) → **finalize** (Ctrl+Enter: the next number, the goods out of stock, refused below zero unless allowed for the bill or in Invoice Settings) → reopened by an Owner to correct it (keeps its number; finalizing again moves only the stock that changed) → cancelled (Owner or Accountant, after any payments are voided; the goods go back). Every action carries the bill's `version` and is logged with before and after.
- **Money**: advances on a draft and part payments (cash, UPI, bank, cheque, card), never past the total; a payment entered by mistake is voided with a reason and stays on record. The cash book counts them.
- **Print**: Classic (the Tally layout), Modern, Compact, or a thermal 80 mm receipt; A4 or A5; logo, signature, heading, footer and colour from Invoice Settings; PDF from the print dialog; WhatsApp sends a summary with the balance and bank details.
- **Quotations**: QTN-26-27-1, their own series; draft → sent → accepted → **converted** to a draft bill dated today (checked again before finalizing), or expired / cancelled.
- **Credit note**: from a finalized counter bill, a return (as for an order) gives the goods back and issues the GST credit note; the bill shows it in its history and can't be reopened or cancelled while it stands.

**Discounts** (`server/src/discounts.ts`, `/v1/admin/discounts`). Each goods line's rule: its product's own (while product overrides are on), else its category's, else the default policy, only between the rule's dates. A rule sets the lowest and highest discount (% or ₹ off each unit), the suggested one, and what billing staff may give alone. The discount counted is the whole of it before GST, the line's share of the bill discount included.

- Outside the range: shown on the line as it's typed, refused on saving and again before finalizing.
- Above the giver's authority (billing staff: the rule's staff limit; a manager: their own limit, never past the rule's maximum; Owners and discount admins: the rule's maximum): saving asks for approval; the bill can't be finalized until an Owner or discount admin approves it (Discount Approvals); a refusal needs a reason. Changing the discount asks again.
- Each finalized line keeps the rule's values, its source, the discount and its approval, so later rule changes don't change old bills. The Discount Report groups finalized bills by category, product, staff member or day, with the approval history and rule changes.

Tests: `server/tests/billing.test.ts`, `server/tests/discounts.test.ts`, the counter-bill return in `server/tests/returns.test.ts`, and `admin/tests/billing.test.ts` (the editor's figures match the server's).

## 5a. Returns & Replacements (built)

**Customer returns** (`server/src/returns.ts`, `/v1/admin/returns`). A return comes from a delivered order, or from a finalized counter bill, and copies each line as it was sold: from the posted tax invoice when there is one (rate before GST, HSN, the line's own CGST/SGST/IGST, a whole line giving back exactly its tax), otherwise at the price billed. Only what was sold less what other returns (not rejected or cancelled) already take can come back.

- Steps: Pending → Under Review → Approved / Rejected → Product Received → Quality Checked → Refund Processed / Replacement Completed → Closed; Cancelled before or after receipt (after receipt it is a reversal: its stock moves are undone and its credit note cancelled; not once money has been paid).
- Every step locks the return and carries its `version`: an action from an out-of-date screen is refused with who changed it, so two people can't act at once and a repeated approval moves nothing twice.
- **Stock**: received goods go into `held` stock (or straight back on sale for unopened goods, if Return Settings say so); the quality check moves each item to stock for sale, damaged, defective, or writes it off. Restocking goods that came back damaged, used or incomplete needs a reason. Replacements take their goods out of saleable stock, never below zero unless allowed. Every change is a `stock_moves` row with the bucket, the return and the balance after it.
- **Money**: `refund_transactions`, out (cash, UPI, bank, cheque, original method, store credit, or set against one of the customer's orders, which records an `order_payments` row of method `return`) or in (the difference for a dearer replacement). Partial and several refunds, never past what's owed; optional approval; pending → approved → processing → completed / failed / cancelled. Store credit is spent from Payments (method `store_credit`), checked against what the customer holds.
- **GST**: a credit note (`CN-26-27-1`, its own series per financial year) for the goods back against a posted invoice, issued on receipt or by hand; a replacement under "credit note + new tax invoice" drafts a tax invoice for the goods given (`sales_invoices.return_id`), posted from GST without touching the order's bill. Original invoices are never rewritten; an invoice with a credit note can't be cancelled. The Sales Register lists credit notes, and the GSTR-3B working, HSN summary and dashboard chart are net of them. Nothing is filed with GSTN.
- **Permissions** (Return Settings): which roles record, approve, receive, check and refund; Owners always may. A return later than the return period, or from a category not marked returnable, is flagged and waits for approval, never refused.
- **Receipt**: printed (and saved as PDF from the print dialog) in the shop's invoice layout, as the credit note when there is one; shared on WhatsApp as a text summary.

**Supplier returns** (`server/src/supplier-returns.ts`, Owners): against a received bill at its rates. Draft → Approved → Dispatched (goods leave the chosen stock: for sale, damaged or defective) → Supplier Received → Credit Note Received → Settled (against what the shop owes, or a refund) → Closed. The supplier's credit note lowers what the shop owes them and the input tax credit in the GSTR-3B working.

Tests: `server/tests/returns.test.ts` (the real-world cases: one item of several, a whole invoice, dearer, cheaper and equal replacements, partial refunds, damaged goods, a rejected return, a supplier return, credit notes, duplicate approval, two people at once, edits after approval, reversal) and `admin/tests/returns.test.ts`.

## 6. Roadmap

| Phase | Contents | Status |
| --- | --- | --- |
| 1. Core | Sign-in, dashboard, products and categories, stock and stock ledger, customers, customer payments | ✅ |
| 2. Purchases | Suppliers (profile, ledger, outstanding), purchase bills with items, freight, discount and GST, receive goods → stock in, supplier payments, bill attachment, dashboard purchase cards | ✅ |
| 3. Billing and GST | Done: GST settings, customer GST details, tax invoices from orders (CGST/SGST or IGST by place of supply, numbered per financial year, print, cancel), purchase tax split and input tax credit review, registers, HSN summary, GSTR-3B working with the legal set-off order, GST payments. Credit notes with returns are done (Phase 4 below). Also done: GSTR-1 working with CSV per section, customer credit limits (migration 028; warned on the customer and their open orders). Counter billing with quotations, payments, templates and category-wise discounts is built (5b above). Next: GSTR-2B upload and matching, debit notes | 🔨 |
| Returns & Replacements | Customer returns and exchanges with approval, receipt, quality check and restocking rules, refunds and store credit, GST credit notes, supplier returns, dashboard, reports, settings and permissions | ✅ |
| 4. Accounts and reports | Expenses, cash and bank book, sales, purchase, stock and GST reports, profit and loss, CSV (opens in Excel) and print (save as PDF); date filters for today, yesterday, this week, month, quarter and financial year | ✅ |
| 5. Advanced | Barcodes and QR labels, barcode billing, Accountant and Manager roles with permissions, staff notifications, stock ageing, customer-specific prices | ⬜ |

## 7. Decisions needed

1. **Official GST invoices.** Decided 21 Nov 2026: the admin issues the GST tax invoices. The registration type is a setting (Regular by default) for the accountant to confirm.
2. **When stock goes out.** Now: when an order is marked delivered. It can be made a setting (confirmed, dispatched or delivered).
3. **New roles.** Accountant and Manager arrive with permissions in Phase 5; until then purchases and suppliers are Owner-only.
