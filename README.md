# Vimalnath Sales Corporation — Mobile app

React Native + Expo (SDK 57, Expo Router) app: a shop for the Taiton catalogue, a cart and orders kept on the phone, a glass calculator, a bar optimizer, and PDF sharing. The web admin panel is in [admin/](admin/README.md) and the backend in [server/](server/README.md).

## Run everything in Docker

Start Docker Desktop, then from this folder:

```bash
docker compose up -d --build
docker compose exec api node src/staff.ts you@company.com "Your Name"   # prints a link to set the first Owner's password
```

| What | Where |
|---|---|
| Admin panel | http://localhost:8090 |
| Mobile app, web version | http://localhost:8091 |

The API starts behind the admin panel and applies database migrations itself. `docker compose down` stops everything and keeps the data. The phone app itself can't run in a container; use Expo Go as below.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go (Android / iOS)
npm run android       # or: npm run ios / npm run web
npm run typecheck
```

The calculator tests run from the admin project, which copies the app's calculators: `cd admin && npm test`.

## Structure

```
app/
  _layout.tsx            Root stack: font, splash, cart, orders and toast providers
  (tabs)/                Shop, Catalog, Optimizer, Cutlist, Orders
  telescopic.tsx         Configuration grids for each Cutlist system (also synchronized, folding)
  glass-calculator.tsx   Cutting size, glass size and material list
  product/[id].tsx       Product, cart.tsx and order/[id].tsx make up the ordering flow
  user.tsx               Menu screens (also settings, about, more-apps, videos)
src/
  components/            Screen, sheets, tab bar, menu drawer, cards, result panels
  data/                  Shop catalogue, price lists, bar sections, cutlist systems, videos
  lib/                   Glass calculator, bar optimizer, PDF builders and export
  providers/             Cart, orders, toast and menu drawer
  theme.ts               Colours, fonts, type styles
scripts/                 One-off tools: catalogue extraction from the Taiton PDFs, tile drawing
assets/                  Photos, catalogue pages and product thumbnails
```

Orders, the cart, the profile and the size unit are saved on the phone with AsyncStorage. With a token from the shop (Settings → Shop connection), the app also sends the profile, orders and, if the customer allows it, product views to the server.

## Before production

- Replace the sample section data in `src/data/sections.ts` with approved Vimalnath records.
- Get confirmed formulas for the synchro and folding systems. `src/lib/glass-calculator.ts` uses a placeholder for them and warns on screen and in the PDF.
- Confirm the widest telescopic panel. The calculator allows more than the 950 mm printed on the kits, and warns when a size goes over it.
- Fill in the price list links in `src/data/catalogues.ts` and real video links in `src/data/videos.ts`.
- Set `ios.bundleIdentifier` in `app.json` before building with EAS.
