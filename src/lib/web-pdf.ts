/**
 * Web only: turns one of the app's PDF pages (HTML) into a real PDF file and hands it to the phone's share sheet, since a
 * home-screen web app can't print. The browser lays the HTML out at A4 width, this paints that layout onto a canvas page
 * by page, and each page goes into the PDF as an image. It paints what those pages use: plain, gradient and striped
 * backgrounds, rounded corners, borders and text (in the phone's own font, so ₹ and Hindi or Marathi names show).
 */

// A4 in CSS pixels (96 per inch) and PDF points (72 per inch); the pages ask for a 28px margin (@page).
const PAGE = { width: 794, height: 1123 };
const POINTS = { width: 595, height: 842 };
const MARGIN = 28;
const CONTENT = { width: PAGE.width - 2 * MARGIN, height: PAGE.height - 2 * MARGIN };
// Sharp enough to zoom into on a phone.
const SCALE = 2;

/** Opens the share sheet (WhatsApp, Mail, Files…) with the page as a PDF; a browser that can't share files downloads it. */
export async function shareHtmlAsPdf(html: string, fileName: string): Promise<void> {
  const file = new File([await htmlToPdf(html)], fileName, { type: 'application/pdf' });
  if (!navigator.canShare?.({ files: [file] })) return download(file);
  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'AbortError') return; // Closed the share sheet.
    if (name !== 'NotAllowedError') throw error;
    // A phone opens the share sheet only straight after a tap, and making the PDF took longer: ask for one more tap.
    await shareOnTap(file);
  }
}

export async function htmlToPdf(html: string): Promise<Blob> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${CONTENT.width}px;height:${CONTENT.height}px;border:0`;
  const loaded = new Promise((resolve) => (frame.onload = resolve));
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await loaded;
    const doc = frame.contentDocument!;
    await doc.fonts.ready;
    const pages: Uint8Array[] = [];
    for (const [top, bottom] of pageSlices(doc)) pages.push(await paintPage(doc, top, bottom));
    return pdfOfImages(pages);
  } finally {
    frame.remove();
  }
}

/** Where each page starts and ends down the document: breaks fall between lines of text and between blocks, never through them. */
function pageSlices(doc: Document): [number, number][] {
  const height = doc.documentElement.scrollHeight;
  const solid: [number, number][] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const line of range.getClientRects()) solid.push([line.top, line.bottom]);
  }
  for (const el of doc.body.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    if ((el.tagName === 'TR' || !el.childElementCount) && box.height < CONTENT.height / 2) solid.push([box.top, box.bottom]);
  }
  // Half a pixel of slack: neighbouring rows meet at fractional positions.
  const fits = (y: number) => !solid.some(([top, bottom]) => top + 0.5 < y && y < bottom - 0.5);

  const slices: [number, number][] = [];
  for (let top = 0; top < height; ) {
    let bottom = Math.min(top + CONTENT.height, height);
    if (bottom < height && !fits(bottom)) {
      // The lowest clean break in the page's lower half: the bottom of a line or block that nothing straddles.
      // A page that is one tall block has none, and is cut at the page's end.
      const clean = solid.map(([, end]) => end).filter((y) => y <= bottom && y > top + CONTENT.height / 2 && fits(y));
      if (clean.length) bottom = Math.max(...clean);
    }
    slices.push([top, bottom]);
    top = bottom;
  }
  return slices;
}

async function paintPage(doc: Document, top: number, bottom: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.width * SCALE;
  canvas.height = PAGE.height * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  ctx.translate(MARGIN, MARGIN - top);
  ctx.beginPath();
  ctx.rect(0, top, CONTENT.width, bottom - top);
  ctx.clip();
  paint(ctx, doc.body);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!jpeg) throw new Error('Couldn’t draw the PDF page.');
  return new Uint8Array(await jpeg.arrayBuffer());
}

/** Paints an element and everything in it, in document order, the way the browser laid it out. */
function paint(ctx: CanvasRenderingContext2D, el: Element) {
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  const box = el.getBoundingClientRect();
  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  ctx.save();
  paintBackground(ctx, style, box, radius);
  for (const [side, edge] of [
    ['top', (w: number) => [box.left, box.top, box.width, w]],
    ['right', (w: number) => [box.right - w, box.top, w, box.height]],
    ['bottom', (w: number) => [box.left, box.bottom - w, box.width, w]],
    ['left', (w: number) => [box.left, box.top, w, box.height]],
  ] as const) {
    const width = parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
    const color = style.getPropertyValue(`border-${side}-color`);
    if (width && visible(color)) {
      ctx.fillStyle = color;
      ctx.fillRect(...(edge(width) as [number, number, number, number]));
    }
  }
  if (style.overflow === 'hidden') {
    outline(ctx, box, radius);
    ctx.clip();
  }
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) paintText(ctx, child as Text, style);
    else if (child.nodeType === Node.ELEMENT_NODE) paint(ctx, child as Element);
  }
  ctx.restore();
}

function paintBackground(ctx: CanvasRenderingContext2D, style: CSSStyleDeclaration, box: DOMRect, radius: number) {
  const colors = style.backgroundImage.match(/rgba?\([^)]*\)/g);
  if (colors && style.backgroundImage.startsWith('repeating-linear-gradient')) {
    // The bar plan's waste: diagonal stripes of its two colours.
    ctx.save();
    outline(ctx, box, radius);
    ctx.clip();
    ctx.fillStyle = colors[0];
    ctx.fillRect(box.left, box.top, box.width, box.height);
    ctx.fillStyle = colors[colors.length - 1];
    for (let x = box.left - box.height; x < box.right; x += 11.3) {
      ctx.beginPath();
      ctx.moveTo(x, box.top);
      ctx.lineTo(x + 5.65, box.top);
      ctx.lineTo(x + 5.65 + box.height, box.bottom);
      ctx.lineTo(x + box.height, box.bottom);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (colors) {
    // Top to bottom, the only direction the pages use.
    const gradient = ctx.createLinearGradient(0, box.top, 0, box.bottom);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[colors.length - 1]);
    ctx.fillStyle = gradient;
  } else if (visible(style.backgroundColor)) {
    ctx.fillStyle = style.backgroundColor;
  } else {
    return;
  }
  outline(ctx, box, radius);
  ctx.fill();
}

/** Each word where the browser put it, so wrapping, alignment and columns match the HTML. */
function paintText(ctx: CanvasRenderingContext2D, node: Text, style: CSSStyleDeclaration) {
  if (!node.data.trim()) return;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const upper = style.textTransform === 'uppercase';
  const range = node.ownerDocument.createRange();
  for (const word of node.data.matchAll(/\S+/g)) {
    range.setStart(node, word.index!);
    range.setEnd(node, word.index! + word[0].length);
    const at = range.getBoundingClientRect();
    if (at.width) ctx.fillText(upper ? word[0].toUpperCase() : word[0], at.left, at.top + at.height / 2);
  }
}

function outline(ctx: CanvasRenderingContext2D, box: DOMRect, radius: number) {
  ctx.beginPath();
  if (radius && ctx.roundRect) ctx.roundRect(box.left, box.top, box.width, box.height, radius);
  else ctx.rect(box.left, box.top, box.width, box.height);
}

const visible = (color: string) => Boolean(color) && color !== 'transparent' && !/,\s*0\)$/.test(color);

/** A PDF of A4 pages, each one JPEG filling the page. */
function pdfOfImages(jpegs: Uint8Array[]): Blob {
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let length = 0;
  // PDF syntax here is plain ASCII, so a string's length is its size in bytes.
  const add = (part: string | Uint8Array) => {
    parts.push(part as BlobPart);
    length += part.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${body}\n`);
    if (stream) {
      add('stream\n');
      add(stream);
      add('\nendstream\n');
    }
    add('endobj\n');
  };

  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${jpegs.length} >>`);
  const draw = `q ${POINTS.width} 0 0 ${POINTS.height} 0 0 cm /Im Do Q`;
  jpegs.forEach((jpeg, i) => {
    const [page, content, image] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${POINTS.width} ${POINTS.height}] /Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    object(content, `<< /Length ${draw.length} >>`, new TextEncoder().encode(draw));
    object(image, `<< /Type /XObject /Subtype /Image /Width ${PAGE.width * SCALE} /Height ${PAGE.height * SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });
  const count = 3 + jpegs.length * 3;
  const xref = length;
  add(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function download(file: File) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** An iPhone-style action sheet whose button is a fresh tap, which the share sheet needs. */
function shareOnTap(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;padding:12px 12px calc(12px + env(safe-area-inset-bottom));background:rgba(0,0,0,0.3);font-family:-apple-system,system-ui,sans-serif';
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'PDF ready');
    sheet.style.cssText = 'width:100%;max-width:420px;display:grid;gap:8px';
    const button = (label: string, bold: boolean) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.style.cssText = `min-height:56px;border:0;border-radius:14px;background:#fff;color:#2458e8;font:inherit;font-size:17px;font-weight:${bold ? 600 : 400}`;
      return element;
    };
    const share = button('Share PDF', true);
    const cancel = button('Cancel', false);
    share.onclick = () => {
      backdrop.remove();
      navigator.share({ files: [file] }).then(resolve, (error: Error) => (error.name === 'AbortError' ? resolve() : reject(error)));
    };
    cancel.onclick = () => {
      backdrop.remove();
      resolve();
    };
    sheet.append(share, cancel);
    backdrop.append(sheet);
    document.body.append(backdrop);
    share.focus();
  });
}
