"""Builds the shop's catalogue products: thumbnails, catalogue page images and catalog.generated.ts."""
import io, json, os, re, sys
import pymupdf
from PIL import Image, ImageStat

sys.path.insert(0, os.path.dirname(__file__))
import img_util
from extract import CATALOGS, SRC, CODE, clean, rect_distance, section_for

APP = r'E:\vimalnath-mobile'
THUMBS = os.path.join(APP, 'assets', 'shop', 'thumbs')
PAGES = os.path.join(APP, 'assets', 'shop', 'pages')
OUT_TS = os.path.join(APP, 'src', 'data', 'shop', 'catalog.generated.ts')

# Pages whose products are curated by hand in systems.ts (complete kits with exact prices).
CURATED_PAGES = {'tavic': set(range(6, 22)) | {24, 25, 26, 27, 40}, 'master': {29, 31, 33, 34}, 'office': set()}
# Extra pages the curated products reference, so their catalogue page image gets rendered too.
CURATED_REFS = {'tavic': set(range(7, 15)) | set(range(16, 22)) | {25, 26, 27, 40}, 'master': {33}, 'office': set()}

CODE_TOKEN = re.compile(r'\bT[A-Z]{1,5}[A-Z0-9]*(?:-[A-Za-z0-9+/.]+)+')
CAT_IDS = {'Hardware': 'hardware', 'Office Partition': 'office', 'Sliding Folding System': 'folding',
           'Telescopic Sliding': 'telescopic', 'Synchronized Systems': 'synchro'}


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def webp(pix, path, max_side, quality):
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    im.thumbnail((max_side, max_side))
    im.save(path, 'WEBP', quality=quality, method=6)


def main():
    os.makedirs(THUMBS, exist_ok=True)
    os.makedirs(PAGES, exist_ok=True)
    products, seen, pages_used = [], {}, set()

    for key, (fname, offset, sections) in CATALOGS.items():
        doc = pymupdf.open(os.path.join(SRC, fname))
        for ref in CURATED_REFS[key]:
            pages_used.add((key, ref))
        for pno in range(doc.page_count):
            printed = pno + 1 - offset
            title, cat = section_for(sections, printed)
            if not title or (pno + 1) in CURATED_PAGES[key]:
                continue
            page = doc[pno]
            table_rects = [pymupdf.Rect(t.bbox) for t in page.find_tables().tables]
            # Product photos: not finish swatches, badges ("NEW" ribbons are very wide) or full-page backgrounds.
            images = img_util.page_images(page)

            for b in page.get_text('blocks'):
                rect = pymupdf.Rect(b[:4])
                # Codes printed inside a price table are table rows, not product headings.
                if any(t.contains(rect) for t in table_rects):
                    continue
                lines = [clean(l) for l in b[4].split('\n') if clean(l)]
                if not lines or not CODE.match(lines[0]):
                    continue
                text = ' '.join(lines)
                codes = []
                for m in CODE_TOKEN.finditer(text):
                    code = m.group(0).rstrip('.-/')
                    if code not in codes:
                        codes.append(code)
                desc = CODE_TOKEN.sub(' ', text)
                desc = re.sub(r'\s+', ' ', desc).strip(' -:,')
                if len(desc) < 4 or desc[0].islower() or re.match(r'^[\d₹J(]', desc):
                    desc = ''
                # Keep the whole name (the app wraps it); drop a spec-list bullet the name may start with.
                desc = re.sub(r'^[•·]\s*', '', desc)
                thumb_pix = None
                for r, xref, smask in sorted(images, key=lambda item: rect_distance(item[0], rect))[:3]:
                    thumb_pix = img_util.product_image(doc, xref, smask)
                    if thumb_pix is not None:
                        break
                for code in codes:
                    ident = f'{CAT_IDS[cat]}:{code}'
                    # A code can appear several times (heading, table, related items); keep the
                    # mention with a photo and a name.
                    previous = seen.get(ident)
                    if previous is not None and (previous['thumb'] or thumb_pix is None) and (previous['name'] or not desc):
                        continue
                    thumb = None
                    if thumb_pix is not None:
                        thumb = f'{key}-{pno + 1}-{slug(code)}.webp'
                        img_util.save(thumb_pix, os.path.join(THUMBS, thumb))
                    entry = {'id': slug(ident), 'code': code, 'name': desc or (previous or {}).get('name', ''), 'category': CAT_IDS[cat],
                             'section': title, 'thumb': thumb or (previous or {}).get('thumb'), 'source': key, 'page': pno + 1, 'printed': printed}
                    if previous is not None:
                        products[products.index(previous)] = entry
                    else:
                        products.append(entry)
                    seen[ident] = entry
                    pages_used.add((key, pno + 1))

        pages_used = {(p['source'], p['page']) for p in products} | {(k, r) for k, refs in CURATED_REFS.items() for r in refs}
        for (k, p) in sorted(pages_used):
            if k != key:
                continue
            path = os.path.join(PAGES, f'{k}-{p}.webp')
            if not os.path.exists(path):
                webp(doc[p - 1].get_pixmap(dpi=150), path, 1400, 60)

    thumbs = sorted({p['thumb'] for p in products if p['thumb']})
    lines = [
        '// Generated from the Taiton Feb-2026 price lists by scripts/catalog/generate.py (needs PyMuPDF + Pillow). Do not edit by hand.',
        "import type { ImageSourcePropType } from 'react-native';",
        '',
        "import type { CatalogSource, ShopProduct } from './types';",
        '',
        'const thumbs: Record<string, ImageSourcePropType> = {',
        *[f"  '{t}': require('../../../assets/shop/thumbs/{t}')," for t in thumbs],
        '};',
        '',
        '/** Catalogue page images, keyed "source-pdfPage". */',
        'export const catalogPages: Record<string, ImageSourcePropType> = {',
        *[f"  '{k}-{p}': require('../../../assets/shop/pages/{k}-{p}.webp')," for k, p in sorted(pages_used)],
        '};',
        '',
        'type Row = [id: string, code: string, name: string, category: ShopProduct["category"], section: string, thumb: string, source: CatalogSource, page: number];',
        '',
        'const rows: Row[] = [',
        *[f"  {json.dumps([p['id'], p['code'], p['name'], p['category'], p['section'], p['thumb'] or '', p['source'], p['page']], ensure_ascii=False)},"
          for p in products],
        '];',
        '',
        'export const catalogProducts: ShopProduct[] = rows.map(([id, code, name, category, section, thumb, source, page]) => ({',
        '  id,',
        '  code,',
        '  name,',
        '  category,',
        '  section,',
        '  image: thumb ? thumbs[thumb] : undefined,',
        '  catalogPage: { source, page },',
        '}));',
        '',
    ]
    os.makedirs(os.path.dirname(OUT_TS), exist_ok=True)
    with open(OUT_TS, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))
    size = lambda d: sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d)) / 1e6
    by_cat = {}
    for p in products:
        by_cat[p['category']] = by_cat.get(p['category'], 0) + 1
    print('products', len(products), by_cat, 'no image', sum(1 for p in products if not p['thumb']))
    print(f'thumbs {len(thumbs)} {size(THUMBS):.1f} MB, pages {len(pages_used)} {size(PAGES):.1f} MB')


if __name__ == '__main__':
    main()
