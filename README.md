# Vimalnath Sales Corporation — Mobile app

React Native + Expo (SDK 57, Expo Router) port of the web prototype in the parent folder.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go (Android / iOS)
npm run android       # or: npm run ios / npm run web
npm run typecheck
```

## Structure

```
app/
  _layout.tsx            Root stack: fonts, splash, toast + drawer provider
  (tabs)/_layout.tsx     Bottom tabs with the custom tab bar
  (tabs)/index.tsx       Home
  (tabs)/catalog.tsx     Taiton PDF catalogues (open in the in-app browser)
  (tabs)/bar-optimizer.tsx
  (tabs)/cutlist.tsx
  telescopic.tsx         Pushed over the tabs (swipe back on iOS, hardware back on Android)
src/
  components/            Header, tab bar, drawer, section picker sheet, cards, result panel
  data/                  Catalogues, sections, cutlist systems (sample records)
  lib/bar-optimizer.ts   First-fit-decreasing bar calculation, unchanged from app.js
  providers/             Toast + drawer context
  theme.ts               Colours, fonts, type styles
assets/images/           Photos, logo mark, and the 10 telescopic tiles
```

## Changes from the web prototype

- **Navigation** — real bottom tabs and a stack push for Telescopic Sliding instead of toggling sections.
- **Section / profile** — opens a bottom sheet listing all 10 sections; picking one updates the standard bar length. (The web version always opened S-101.)
- **Share plan** — opens the native share sheet with a text summary of the bar plan. Export report is still a placeholder toast.
- **Catalogue covers** — native apps can't render a PDF page in an iframe, so the cards use designed covers. The PDFs open in the in-app browser. To show real covers, export page 1 of each PDF as an image and swap it into `CatalogueCard`.
- **Telescopic tiles** — cut from `telescopic-sliding-cover.png` into separate images rather than positioned as a sprite.
- **Sizing** — text and touch targets are scaled for phones (minimum 44 pt targets; the web build used 8–9 px labels).
- **Removed** — the unused product grid, cutlist result, and cover-upload code from `app.js`; they had no matching UI.

## Before production

Replace the sample section data in `src/data/sections.ts` with approved Vimalnath records. Set `ios.bundleIdentifier` and `android.package` in `app.json` before building with EAS.
