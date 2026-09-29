"""Turns prices.txt into src/data/shop/catalog.prices.generated.ts (MRP options per product, plus the
products the automatic extraction missed). Run after generate.py; needs PyMuPDF + Pillow."""
import json, os, re, sys
import pymupdf
from PIL import Image, ImageStat

sys.path.insert(0, os.path.dirname(__file__))
import img_util
from extract import CATALOGS, SRC, rect_distance, section_for

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PRICES = os.path.join(os.path.dirname(__file__), 'prices.txt')
GENERATED = os.path.join(APP, 'src', 'data', 'shop', 'catalog.generated.ts')
OUT_TS = os.path.join(APP, 'src', 'data', 'shop', 'catalog.prices.generated.ts')
THUMBS = os.path.join(APP, 'assets', 'shop', 'thumbs')
CAT_IDS = {'Hardware': 'hardware', 'Office Partition': 'office', 'Sliding Folding System': 'folding',
           'Telescopic Sliding': 'telescopic', 'Synchronized Systems': 'synchro'}


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def norm(code):
    """Codes are printed inconsistently (TAV-2-AL KIT / TAV-2-AL-KIT, TML-DL-35MM / TML-DL-35mm)."""
    return re.sub(r'[\s-]+', '-', code.upper()).strip('-')


def parse_options(text):
    options = []
    for part in text.split(';'):
        part = part.strip()
        m = re.match(r'^(.*?)\s*([0-9]+)$', part)
        if not m:
            raise ValueError(f'No price in option: {part!r}')
        options.append({'label': m.group(1).strip() or 'Standard', 'mrp': int(m.group(2))})
    return options


def read_prices():
    entries, source, page = [], None, None
    for raw in open(PRICES, encoding='utf-8'):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('@'):
            source, page = line[1:].split()
            page = int(page)
            continue
        head, opts = line.split('=>', 1)
        head = head.strip()
        added = head.startswith('+')
        name = ''
        if added:
            head = head[1:].strip()
            m = re.match(r'^(.*?)\s*\[(.*)\]$', head)
            head, name = (m.group(1).strip(), m.group(2).strip()) if m else (head, '')
        entries.append({'source': source, 'page': page, 'code': head, 'name': name, 'added': added, 'options': parse_options(opts)})
    return entries


def read_generated():
    ts = open(GENERATED, encoding='utf-8').read()
    rows = re.findall(r'^  (\[.*\]),$', ts, re.M)
    return [json.loads(r) for r in rows]  # [id, code, name, category, section, thumb, source, page]


def crop_thumb(doc_cache, source, page, code):
    fname = CATALOGS[source][0]
    doc = doc_cache.setdefault(source, pymupdf.open(os.path.join(SRC, fname)))
    pg = doc[page - 1]
    hits = pg.search_for(code) or pg.search_for(code.split(' ')[0])
    if not hits:
        return None
    for r, xref, smask in sorted(img_util.page_images(pg), key=lambda item: rect_distance(item[0], hits[0]))[:3]:
        im = img_util.product_image(doc, xref, smask)
        if im is not None:
            name = f'{source}-{page}-{slug(code)}.webp'
            img_util.save(im, os.path.join(THUMBS, name))
            return name
    return None


def main():
    entries = read_prices()
    products = read_generated()
    by_page = {(e['source'], e['page'], norm(e['code'])): e for e in entries}
    by_source = {}
    by_code = {}
    for e in entries:
        by_source.setdefault((e['source'], norm(e['code'])), e)
        by_code.setdefault(norm(e['code']), e)

    prices = {}
    for pid, code, _name, _cat, _sec, _thumb, source, page in products:
        e = by_page.get((source, page, norm(code))) or by_source.get((source, norm(code))) or by_code.get(norm(code))
        if e:
            prices[pid] = e['options']

    existing = {(cat, norm(code)) for _pid, code, _n, cat, *_ in products}
    extras, docs, seen = [], {}, set()
    for e in entries:
        if not e['added']:
            continue
        title, cat_label = section_for(CATALOGS[e['source']][2], e['page'] - CATALOGS[e['source']][1])
        cat = CAT_IDS[cat_label]
        key = (cat, norm(e['code']))
        if key in existing or key in seen:
            continue
        seen.add(key)
        pid = slug(f'{cat}:{e["code"]}')
        thumb = crop_thumb(docs, e['source'], e['page'], e['code'])
        extras.append([pid, e['code'], e['name'], cat, title, thumb or '', e['source'], e['page']])
        prices[pid] = e['options']

    # Pages the extras point to must have a rendered page image.
    have_pages = set(re.findall(r"'(\w+-\d+)': require\('../../../assets/shop/pages/", open(GENERATED, encoding='utf-8').read()))
    missing_pages = sorted({f'{x[6]}-{x[7]}' for x in extras} - have_pages)
    for key in missing_pages:
        source, page = key.rsplit('-', 1)
        doc = docs.setdefault(source, pymupdf.open(os.path.join(SRC, CATALOGS[source][0])))
        pix = doc[int(page) - 1].get_pixmap(dpi=150)
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        im.thumbnail((1400, 1400))
        im.save(os.path.join(APP, 'assets', 'shop', 'pages', f'{key}.webp'), 'WEBP', quality=60, method=6)

    lines = [
        '// Generated from scripts/catalog/prices.txt by scripts/catalog/apply_prices.py. Do not edit by hand.',
        "import type { ImageSourcePropType } from 'react-native';",
        '',
        "import type { CatalogSource, ProductOption, ShopProduct } from './types';",
        '',
        '/** MRP options typed from the Taiton Feb-2026 price lists, keyed by product id. */',
        'export const catalogPrices: Record<string, ProductOption[]> = {',
        *[f'  {json.dumps(pid)}: {json.dumps(opts, ensure_ascii=False)},' for pid, opts in prices.items()],
        '};',
        '',
        'const extraThumbs: Record<string, ImageSourcePropType> = {',
        *[f"  '{x[5]}': require('../../../assets/shop/thumbs/{x[5]}')," for x in extras if x[5]],
        '};',
        '',
        '/** Catalogue page images for the extra products that no other product points to. */',
        'export const extraPages: Record<string, ImageSourcePropType> = {',
        *[f"  '{k}': require('../../../assets/shop/pages/{k}.webp')," for k in missing_pages],
        '};',
        '',
        'type Row = [id: string, code: string, name: string, category: ShopProduct["category"], section: string, thumb: string, source: CatalogSource, page: number];',
        '',
        '/** Products listed in the price lists that the automatic extraction missed. */',
        'const rows: Row[] = [',
        *[f'  {json.dumps(x, ensure_ascii=False)},' for x in extras],
        '];',
        '',
        'export const extraProducts: ShopProduct[] = rows.map(([id, code, name, category, section, thumb, source, page]) => ({',
        '  id,',
        '  code,',
        '  name,',
        '  category,',
        '  section,',
        '  image: thumb ? extraThumbs[thumb] : undefined,',
        '  catalogPage: { source, page },',
        '}));',
        '',
    ]
    with open(OUT_TS, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))

    unpriced = [(p[1], p[6], p[7]) for p in products if p[0] not in prices]
    print(f'priced {len(prices)} (catalogue {len(prices) - len(extras)}/{len(products)}, extras {len(extras)}), '
          f'extra thumbs {sum(1 for x in extras if x[5])}, extra pages {len(missing_pages)}')
    print('unpriced:', len(unpriced))
    for u in unpriced:
        print('  ', *u)


if __name__ == '__main__':
    main()
