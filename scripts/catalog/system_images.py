"""Product photos for the hand-curated system products (assets/shop/systems), from the embedded images."""
import os, sys
import pymupdf

sys.path.insert(0, os.path.dirname(__file__))
import img_util
from extract import SRC

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'shop', 'systems'))
TAVIC = 'EDITION #5 TAVIC WARDROBE SLDING PRICE LIST feb-26.pdf'

# (output, pdf page, area on the page where the product photo sits)
TARGETS = [
    ('sliding-folding.webp', 40, (0, 99, 595, 381)),
    ('linkage-3.webp', 27, (36, 150, 378, 433)),
    ('linkage-4.webp', 27, (36, 464, 380, 794)),
    ('frameless-synchro.webp', 26, (0, 146, 596, 556)),
    ('frameless-2.webp', 25, (228, 120, 366, 258)),
    ('frameless-3.webp', 25, (222, 305, 360, 443)),
    ('frameless-4.webp', 25, (222, 480, 360, 618)),
]

doc = pymupdf.open(os.path.join(SRC, TAVIC))
for name, page, area in TARGETS:
    target = pymupdf.Rect(area)
    candidates = [(r, x, s) for r, x, s in img_util.page_images(doc[page - 1]) if r.intersects(target)]
    candidates.sort(key=lambda c: -(c[0] & target).get_area())
    for r, xref, smask in candidates:
        im = img_util.product_image(doc, xref, smask)
        if im is not None:
            img_util.save(im, os.path.join(OUT, name))
            print('ok', name, [round(v) for v in r])
            break
    else:
        print('kept old', name)
