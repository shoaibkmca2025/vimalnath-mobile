# Vimalnath Admin

Web admin panel for the Vimalnath Sales Corporation app: a dashboard, orders and customers, products and
prices, categories, price lists, cutlist systems, glass formulas, bar sections, home banners, installation
videos, an activity log and app settings. ⌘K / Ctrl+K searches pages, orders, customers and products.

This is the **UI preview**. It isn't connected to a server yet:

- The catalogue is built from the mobile app's own data (`../src/data`) by `scripts/seed.mjs`.
- Orders and customers are sample data, because the app keeps orders on each phone today. They carry the
  same fields as the app's orders: a customer or site name, an optional phone, delivery notes, and a note
  and option code on each line.
- Glass Formulas and the Bar Sections optimizer run the app's own calculators (`../src/lib`), which the
  seed copies into `src/generated/app-lib`. Formulas are code, so they're shown and tested here, not edited.
- Edits are saved in this browser's localStorage only; the app doesn't see them. Settings › Preview data
  can download everything as JSON or reset to the app's data.
- Sign-in and staff accounts are real and use the API in [../server](../server/README.md), which must be running. Create the first account with `npm run owner-link -- you@company.com "Your Name"` in `server/`.

## Run it

```bash
cd admin
npm install
npm run dev        # http://localhost:5180 (runs the seed first)
npm run build      # typecheck + production build in dist/
npm run preview    # serve dist/ on http://localhost:4180
npm run lint
npm test           # the app's calculators against known answers, and how the admin handles API replies
```

`npm run seed` rebuilds `public/data/seed.json`, copies the images it uses into `public/media`, and copies
the app's calculators into `src/generated/app-lib`. All three are generated and git-ignored; `dev`, `build`
and `typecheck` run the seed automatically.

## Structure

```
scripts/seed.mjs        Reads the app's TypeScript data files and writes the preview catalogue
src/
  router.tsx            Routes; each page is its own lazily loaded chunk
  components/           App shell, buttons, form fields, data table, drawer, dialog, toast…
  data/                 Types, the preview data store (store.tsx + useData.ts), sample orders, analytics
  pages/                One file per screen
  generated/app-lib/    The app's glass calculator and bar optimizer, copied by the seed (don't edit)
  styles/               tokens.css (colors, type, spacing, motion), base.css, components.css, details.css
```

Pages only touch data through `useData()` (`db`, `update`, `reset`), so connecting a real API means changing
`src/data/store.tsx`, not the screens. Passing a log entry to `update` records the change, with the admin's
name and the time, in the Activity page.

## Design

Apple-style foundations for the web: the system font, semantic color tokens with light and dark themes,
the brand blue as the single tint, 44 px touch targets on touch screens, visible keyboard focus, and support
for reduced motion, reduced transparency and increased contrast. Lighthouse (v13, mobile and desktop)
scores 100 for accessibility and best practices and 93–100 for performance on every audited page. SEO is
intentionally low: the admin is marked `noindex` and blocked in `robots.txt`.
