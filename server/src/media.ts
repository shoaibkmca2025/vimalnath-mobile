import { randomBytes } from 'node:crypto';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import sharp from 'sharp';

import { only, type Env } from './staff.ts';

// PDFs are capped at 25 MB by the upload body limit in app.ts.
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Longest side of each copy: large is sharp enough to zoom into a catalogue page.
const SIZES = { data: 2400, medium: 800, small: 240 } as const;
// A file can be small yet decode huge (a blank 0.4 MB PNG scan took 310 MB). 150 MP still fits an A4 page scanned at 1200 dpi.
const MAX_PIXELS = 150_000_000;
const toWebp = (input: Buffer, side: number) =>
  sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });

/** POST /v1/admin/media: the file itself as the body, its type as Content-Type, its name in X-File-Name. */
export function mediaAdminRoutes(sql: Sql) {
  const media = new Hono<Env>();

  media.post('/', only('owner', 'catalogue'), async (c) => {
    const type = c.req.header('content-type')?.split(';')[0]?.trim() ?? '';
    const kind = IMAGE_TYPES.includes(type) ? 'image' : type === 'application/pdf' ? 'pdf' : null;
    if (!kind) throw new HTTPException(400, { message: 'Choose a JPG, PNG or WebP photo, or a PDF.' });
    const body = Buffer.from(await c.req.arrayBuffer());
    if (kind === 'image' && body.length > MAX_IMAGE) throw new HTTPException(413, { message: 'Choose a photo under 5 MB.' });
    if (!body.length) throw new HTTPException(400, { message: 'That file is empty.' });

    let file: { type: string; data: Buffer; width: number | null; height: number | null; small: Buffer | null; medium: Buffer | null };
    if (kind === 'pdf') {
      if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HTTPException(400, { message: 'That file isn’t a readable PDF.' });
      file = { type: 'application/pdf', data: body, width: null, height: null, small: null, medium: null };
    } else {
      // Decoding proves it's a real image; rotate() turns phone photos upright before the camera details are dropped.
      // Only the large copy reads the original; the smaller ones come from it, which halves the memory an upload needs.
      const large = await toWebp(body, SIZES.data).catch((error: Error) => {
        const message = /pixel limit/i.test(error.message) ? 'That photo is too large. Save it under 150 megapixels and try again.' : 'That file isn’t a readable photo.';
        throw new HTTPException(400, { message });
      });
      const [medium, small] = await Promise.all([toWebp(large.data, SIZES.medium), toWebp(large.data, SIZES.small)]);
      file = { type: 'image/webp', data: large.data, width: large.info.width, height: large.info.height, medium: medium.data, small: small.data };
    }

    const id = randomBytes(12).toString('hex');
    const name = (() => {
      try {
        return decodeURIComponent(c.req.header('x-file-name') ?? '').slice(0, 200);
      } catch {
        return '';
      }
    })();
    await sql`insert into media_files ${sql({ id, kind, name: name || 'file', bytes: file.data.length, uploaded_by: c.get('staff').id, ...file })}`;
    return c.json({ id, url: `/v1/media/${id}.${kind === 'pdf' ? 'pdf' : 'webp'}`, width: file.width, height: file.height }, 201);
  });

  return media;
}

/** GET /v1/media/<id>.webp (also -md and -sm) and /v1/media/<id>.pdf: public, because the app shows them. */
export function mediaRoutes(sql: Sql) {
  const media = new Hono();

  media.get('/:file', async (c) => {
    const match = /^([a-f0-9]{24})(?:-(sm|md))?\.(webp|pdf)$/.exec(c.req.param('file'));
    if (!match) throw new HTTPException(404, { message: 'That file does not exist.' });
    const [, id, size, extension] = match;
    const column = size === 'sm' ? 'small' : size === 'md' ? 'medium' : 'data';
    const [file] = await sql`select ${sql(column)} as body from media_files where id = ${id!} and type = ${extension === 'pdf' ? 'application/pdf' : 'image/webp'}`;
    if (!file?.body) throw new HTTPException(404, { message: 'That file does not exist.' });
    // An address never changes what it points to (a replaced file gets a new one), so phones and CDNs may keep it for good.
    return c.body(file.body as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': extension === 'pdf' ? 'application/pdf' : 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  return media;
}
