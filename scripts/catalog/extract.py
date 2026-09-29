"""Extract products (code, name, section, category, prices, image rect) from the Taiton price-list PDFs."""
import json, re, sys
import pymupdf

SRC = r'C:\Users\prasa\OneDrive\Desktop\vimalnath image\taiton catalog'
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'

H, OP, SF, TS, SY, SKIP = 'Hardware', 'Office Partition', 'Sliding Folding System', 'Telescopic Sliding', 'Synchronized Systems', None

# (first printed page, last printed page, section title, category)
CATALOGS = {
    'master': ('MASTER CATALOGUE PRICE LIST-feb-26.pdf', 5, [
        (1, 3, 'Patch Fittings', H), (4, 6, 'Door Handles', H), (7, 7, 'Wall Profiles & Door Rails', H),
        (8, 8, 'Office Partition Hardware', OP), (9, 13, 'Shower Cubicle Fittings', H), (14, 17, 'Sliding Door Systems', H),
        (18, 23, 'Spider Fittings & Canopy', H), (24, 25, 'Sliding Folding System', SF), (26, 27, 'Frameless Sliding Folding', SF),
        (28, 29, 'Frameless Telescopic Sliding', TS), (30, 38, 'Automatic Doors & Sensors', H), (39, 42, 'RFID & Hotel Locks', H),
        (43, 46, 'Digital Door Locks', H), (47, 47, 'Movable Partitions', OP), (48, 50, 'Door Control Hardware', H),
        (51, 51, 'Floor Springs', H), (52, 52, 'Door Closers', H), (53, 53, 'Concealed Hinges', H), (54, 55, 'Wardrobe Systems', H),
        (56, 56, 'Framed Shower Cubicles', H), (57, 57, 'Kitchen Profiles', H), (58, 59, None, SKIP),
    ]),
    'office': ('UPDATED OFFICE PARTITION PRICE LIST FEB-26.pdf', 4, [
        (1, 1, 'Tavic 25', OP), (2, 3, 'Tavic 45', OP), (4, 4, 'Tavic SG75', OP), (5, 6, 'Tavic SG100', OP),
        (7, 8, 'Tavic DG100', OP), (9, 9, 'Tavic SD60', OP), (10, 10, 'Tavic SD75', OP), (11, 11, 'Portal System', OP),
        (12, 12, 'Sliding System', OP), (13, 14, 'Partition Accessories', OP), (15, 19, 'Partition Hardware', OP),
        (20, 21, 'Digital Biometric Locks', OP), (22, 23, 'Slim Framed Sliding', OP),
    ]),
    'tavic': ('EDITION #5 TAVIC WARDROBE SLDING PRICE LIST feb-26.pdf', 5, [
        (1, 9, 'Telescopic Sliding Systems', TS), (10, 16, 'Synchro Sliding Systems', SY), (17, 18, 'Sliding System Accessories', TS),
        (19, 20, 'Frameless Telescopic Sliding', TS), (21, 21, 'Frameless Synchro Sliding', SY), (22, 22, 'Linkage Inter-moving Doors', TS),
        (23, 24, 'Manual Wooden Sliding', H), (25, 27, 'Automatic Slim Framed Sliding', H), (28, 29, 'Slim Framed Swing Door', H),
        (30, 31, 'Butterfly Soft Close Hinge', H), (32, 33, 'Invisible Sliding Systems', H), (34, 34, 'Pocket Door Series', H),
        (35, 36, 'Sliding Folding System', SF), (37, 38, 'PT Door Systems', H), (39, 43, 'Wardrobe Sliding Systems', H),
        (44, 46, 'Wardrobe Hinges', H), (47, 48, 'Wardrobe Edge Handles', H), (49, 50, 'Beveled Framed Glass Door', H),
        (51, 52, 'Cube Shelf & Glass Lamp', H), (53, 55, 'Framed Shower Systems', H), (56, 56, 'Kitchen Profiles', H),
        (57, 57, 'Exterior Sliding Folding', SF), (58, 60, None, SKIP),
    ]),
}

CODE = re.compile(r'^(T[A-Z]{1,5}[A-Z0-9]*(?:-[A-Za-z0-9+/.()]+)+(?: [A-Z0-9+/-]{1,8})*)')
PRICE = re.compile(r'(?:₹|\bJ)\s*([0-9][0-9,]*)')
NOT_NAME = re.compile(r'^(MRP|Finish|Length|Mill|SILVER|BLACK|SSS|BM|GP|RGP|PSS|Size|Code|Qty|₹|J \d|\d)', re.I)


def section_for(sections, printed):
    for first, last, title, cat in sections:
        if first <= printed <= last:
            return title, cat
    return None, None


def clean(text):
    return re.sub(r'\s+', ' ', text.replace('ﬁ', 'fi').replace('ﬂ', 'fl')).strip()


def parse_price(text):
    m = PRICE.search(text)
    return int(m.group(1).replace(',', '')) if m else None


def rect_distance(a, b):
    dx = max(b.x0 - a.x1, a.x0 - b.x1, 0)
    dy = max(b.y0 - a.y1, a.y0 - b.y1, 0)
    return (dx * dx + dy * dy) ** 0.5


def table_rows(page, table):
    """Rows of (cells, price). Splits merged multi-line rows and repairs prices the cell box cut off."""
    rows = []
    words = page.get_text('words')
    for cells in table.extract():
        cells = [clean(c or '') if c is None or '\n' not in c else c for c in cells]
        parts = [c.split('\n') if c else [''] for c in cells]
        n = max(len(p) for p in parts)
        if n > 1 and all(len(p) in (1, n) for p in parts):
            split = [[(p[i] if len(p) == n else p[0]) for p in parts] for i in range(n)]
        else:
            split = [[clean(c or '') for c in cells]]
        rows.extend([[clean(c) for c in r] for r in split])
    out = []
    header = None
    for r in rows:
        price_idx = next((i for i, c in enumerate(r) if PRICE.search(c)), None)
        if price_idx is None:
            if any(r) and header is None:
                header = [c for c in r]
            continue
        out.append((r, price_idx))
    # Repair truncated prices using full-width words on the same text line.
    price_words = [w for w in words if PRICE.fullmatch(w[4]) or re.fullmatch(r'[0-9][0-9,]{2,}', w[4])]
    return header, out


def extract(key):
    fname, offset, sections = CATALOGS[key]
    doc = pymupdf.open(f'{SRC}\\{fname}')
    products = []
    for pno in range(doc.page_count):
        printed = pno + 1 - offset
        title, cat = section_for(sections, printed)
        if not title:
            continue
        page = doc[pno]
        blocks = page.get_text('blocks')
        codes = []
        for b in blocks:
            lines = [clean(l) for l in b[4].split('\n') if clean(l)]
            if not lines:
                continue
            m = CODE.match(lines[0])
            if not m:
                continue
            code = m.group(1).strip()
            rest = lines[0][len(code):].strip()
            name_lines = ([rest] if rest else []) + [l for l in lines[1:3] if not NOT_NAME.match(l)]
            codes.append({'code': code, 'desc': ' '.join(name_lines)[:80], 'rect': pymupdf.Rect(b[:4])})
        if not codes:
            continue

        # Images big enough to be product photos (skip the finish swatches in the corner).
        images = []
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                if r.width > 25 and r.height > 25 and r.get_area() < page.rect.get_area() * 0.55:
                    images.append(r)

        tables = page.find_tables().tables
        assigned = {i: [] for i in range(len(codes))}
        headers = {}
        for t in tables:
            tr = pymupdf.Rect(t.bbox)
            # The product a table belongs to: its code sits just above (or beside) the table.
            def score(c):
                r = c['rect']
                above = r.y1 <= tr.y0 + 8 and r.x0 < tr.x1 and r.x1 > tr.x0 - 30
                return (0 if above else 1, rect_distance(r, tr))
            owner = min(range(len(codes)), key=lambda i: score(codes[i]))
            header, rows = table_rows(page, t)
            if rows:
                assigned[owner].extend(rows)
                headers.setdefault(owner, header)

        for i, c in enumerate(codes):
            variants = []
            prev = None
            for cells, pi in assigned[i]:
                label_cells = [x for j, x in enumerate(cells) if j != pi and x]
                if not label_cells and prev:
                    label_cells = prev
                price = parse_price(cells[pi])
                if price:
                    variants.append({'label': ' · '.join(label_cells) or 'Standard', 'mrp': price})
                prev = label_cells or prev
            img = min(images, key=lambda r: rect_distance(r, c['rect'])) if images else None
            products.append({
                'catalog': key, 'page': pno + 1, 'printed': printed, 'section': title, 'category': cat,
                'code': c['code'], 'desc': c['desc'],
                'columns': [h for h in (headers.get(i) or []) if h and not re.match(r'^MRP', h, re.I)],
                'variants': variants,
                'image': [round(v, 1) for v in img] if img else None,
            })
    return products


if __name__ == '__main__':
    everything = []
    for key in CATALOGS:
        everything += extract(key)
    with open(f'{OUT}/products.json', 'w', encoding='utf-8') as fh:
        json.dump(everything, fh, ensure_ascii=False, indent=1)
    print('products', len(everything), 'with prices', sum(1 for p in everything if p['variants']))
