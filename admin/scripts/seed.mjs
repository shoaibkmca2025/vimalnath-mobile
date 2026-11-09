/**
 * Builds the admin's preview data from the mobile app's own data files, so the panel shows the real
 * catalogue instead of made-up records. Writes public/data/seed.json and copies every image it refers to
 * into public/media (both git-ignored). Runs before `npm run dev` and `npm run build`.
 *
 * The app's data is TypeScript written for React Native: each file is transpiled with the TypeScript
 * compiler, `require('…png')` resolves to the copied image's URL, and 'react-native' is stubbed out.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(ADMIN, '..');
const ASSETS = path.join(APP, 'assets');
const MEDIA = path.join(ADMIN, 'public', 'media');
const DATA = path.join(ADMIN, 'public', 'data');
const IMAGE = /\.(webp|png|jpe?g)$/i;

/** Copies an app image into public/media, keeping its path under assets/, and returns its URL. */
function media(file) {
  const relative = path.relative(ASSETS, file).split(path.sep).join('/');
  if (relative.startsWith('..')) throw new Error(`Image is outside assets/: ${file}`);
  const target = path.join(MEDIA, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(file, target);
  return `/media/${relative}`;
}

const modules = new Map();

function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  modules.set(file, module);
  const localRequire = (request) => {
    if (request === 'react-native') return {};
    const resolved = path.resolve(path.dirname(file), request);
    if (IMAGE.test(request)) return media(resolved);
    for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')]) {
      if (existsSync(candidate)) return load(candidate);
    }
    throw new Error(`Can't resolve '${request}' from ${path.relative(APP, file)}`);
  };
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}

const data = (file) => load(path.join(APP, 'src', 'data', file));

rmSync(MEDIA, { recursive: true, force: true });

const shop = data('shop/index.ts');
const { catalogues } = data('catalogues.ts');
const { sections } = data('sections.ts');
const { installationVideoSections } = data('videos.ts');
const cutlist = data('cutlist.ts');
const app = JSON.parse(readFileSync(path.join(APP, 'app.json'), 'utf8')).expo;

const heroSlide = (n) => media(path.join(ASSETS, 'images', 'hero', `hero-slide-${n}.webp`));

const seed = {
  generatedAt: new Date().toISOString(),
  products: shop.shopProducts.map(({ id, code, name, category, section, image, catalogPage, options, specs, featured }) => ({
    id,
    code,
    name,
    category,
    section,
    image: image ?? null,
    catalogPage,
    options: options ?? [],
    specs: specs ?? [],
    featured: Boolean(featured),
    visible: true,
  })),
  catalogPages: shop.catalogPages,
  categories: shop.shopCategories.map(({ id, label, image, fit }) => ({ id, label, image, fit, visible: true })),
  catalogues: catalogues.map((catalogue) => ({ ...catalogue, url: catalogue.url ?? '' })),
  sections,
  videoSections: installationVideoSections,
  cutlist: {
    systems: cutlist.cutlistSystems.map(({ id, name, subtitle, photo }) => ({ id, name, subtitle, photo: photo ?? null })),
    configurations: {
      telescopic: cutlist.telescopicConfigurations,
      synchronized: cutlist.synchronizedConfigurations,
      folding: cutlist.foldingConfigurations,
    },
  },
  // The hero copy lives in the app's HeroCard component; every slide currently shares it.
  banners: [1, 2, 3, 4].map((n) => ({
    id: `hero-${n}`,
    image: heroSlide(n),
    kicker: 'New collection · 2026',
    headline: 'Systems that move with you.',
    body: 'Sliding, folding and slim partition solutions.',
    active: true,
  })),
  settings: {
    companyName: 'Vimalnath Sales Corporation',
    tagline: 'Architectural systems and hardware',
    phone: '',
    email: '',
    website: '',
    address: '',
    defaultUnit: 'mm',
    priceListEdition: 'Taiton · Feb 2026',
    developer: '4AM Global Media',
    appVersion: app.version,
    logo: media(path.join(ASSETS, 'images', 'logo-mark.png')),
  },
};

mkdirSync(DATA, { recursive: true });
writeFileSync(path.join(DATA, 'seed.json'), JSON.stringify(seed));
console.log(
  `seed: ${seed.products.length} products, ${seed.categories.length} categories, ${seed.catalogues.length} price lists, ` +
    `${seed.sections.length} sections, ${seed.banners.length} banners → public/data/seed.json`,
);

// The app's calculators, copied as-is so the admin's formula pages run the same maths as the phone.
// Only the '@/lib/…' imports change, to sibling .ts files so Node can run them in the tests. They're checked by the app's TypeScript settings,
// not the admin's stricter ones, hence @ts-nocheck.
const APP_LIB = path.join(ADMIN, 'src', 'generated', 'app-lib');
const LIB_FILES = ['glass-calculator', 'bar-optimizer', 'format', 'length-units'];
rmSync(APP_LIB, { recursive: true, force: true });
mkdirSync(APP_LIB, { recursive: true });
for (const name of LIB_FILES) {
  const source = readFileSync(path.join(APP, 'src', 'lib', `${name}.ts`), 'utf8').replace(/from '@\/lib\/([\w-]+)'/g, (_, file) => {
    if (!LIB_FILES.includes(file)) throw new Error(`src/lib/${name}.ts imports @/lib/${file}, which isn't copied`);
    return `from './${file}.ts'`;
  });
  writeFileSync(path.join(APP_LIB, `${name}.ts`), `// @ts-nocheck\n// Generated by scripts/seed.mjs from the app's src/lib/${name}.ts. Don't edit; change the app's file.\n${source}`);
}
console.log(`seed: copied ${LIB_FILES.length} calculator files from the app → src/generated/app-lib`);
