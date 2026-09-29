"""Product thumbnails from the photo embedded in the PDF (not a page render), so price boxes and
labels printed over the page never end up in the picture. Every thumbnail is the product trimmed to
its edges and centred on the same white square with the same margin."""
import pymupdf
from PIL import Image, ImageChops, ImageStat

SIZE = 720          # output square, px
MARGIN = 0.08       # empty border on each side, as a share of SIZE
MIN_SIDE = 60       # embedded images smaller than this are icons/swatches, not product photos


def page_images(page):
    """(rect on page, xref, smask xref) for every embedded image that can be a product photo."""
    found = []
    area = page.rect.get_area()
    for img in page.get_images(full=True):
        xref, smask, width, height = img[0], img[1], img[2], img[3]
        if min(width, height) < MIN_SIDE:
            continue
        for r in page.get_image_rects(xref):
            if r.width > 25 and r.height > 25 and r.get_area() > 900 and 0.18 < r.width / r.height < 4 and r.get_area() < area * 0.55:
                found.append((r, xref, smask))
    return found


def _load(doc, xref, smask):
    pix = pymupdf.Pixmap(doc, xref)
    if smask:
        try:
            pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, smask))
        except Exception:
            pass
    if pix.colorspace and pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    mode = {1: 'L', 3: 'RGB'}.get(pix.n - pix.alpha, 'RGB')
    im = Image.frombytes(mode + ('A' if pix.alpha else ''), (pix.width, pix.height), pix.samples)
    white = Image.new('RGBA', im.size, (255, 255, 255, 255))
    return Image.alpha_composite(white, im.convert('RGBA')).convert('RGB')


def _trim(im):
    """Crop away the near-white border around the product."""
    bg = Image.new('RGB', im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 18 else 0)
    box = diff.getbbox()
    return im.crop(box) if box else im


def product_image(doc, xref, smask):
    """Square, centred, high-resolution product image — or None if the embedded image is blank."""
    im = _load(doc, xref, smask)
    if max(ImageStat.Stat(im.convert('L')).stddev) <= 12:
        return None
    im = _trim(im)
    inner = int(SIZE * (1 - 2 * MARGIN))
    scale = inner / max(im.size)
    # Upscale small photos a little at most, so they stay sharp instead of blurry.
    scale = min(scale, 3.0)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGB', (SIZE, SIZE), (255, 255, 255))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    return canvas


def save(im, path):
    im.save(path, 'WEBP', quality=86, method=6)
