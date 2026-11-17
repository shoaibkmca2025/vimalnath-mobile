import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { distinct, Image, Required, Text } from './catalogue.ts';
import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';
import { claimList, Seen } from './versions.ts';

// The app's calculator code is written for exactly these three systems, so they can be edited but never added or removed.
const SYSTEM_IDS = ['telescopic', 'synchronized', 'folding'] as const;

const Configurations = z
  .array(z.object({ name: Required(80, 'Enter the configuration’s name, e.g. 2+1 Sliding System.'), image: Image }))
  .max(50)
  .refine(distinct('name'), 'Each configuration in a system needs a different name.');

const Cutlist = z.object({
  systems: z
    .array(z.object({ id: z.enum(SYSTEM_IDS), name: Required(80, 'Enter the system’s name.'), subtitle: Text(200), photo: Image.nullable() }))
    .length(SYSTEM_IDS.length, 'Send all three systems.')
    .refine(distinct('id'), 'A system is listed twice.'),
  configurations: z.object({ telescopic: Configurations, synchronized: Configurations, folding: Configurations }),
});

// Same rules as the admin's Bar Sections form.
const Section = z.object({
  code: Required(40, 'Enter the section code, e.g. S-101.'),
  name: Required(120, 'Enter the section’s name.'),
  system: Text(80),
  bar: z.number().int('Enter the standard bar length in mm, between 500 and 12,000.').min(500, 'Enter the standard bar length in mm, between 500 and 12,000.').max(12_000, 'Enter the standard bar length in mm, between 500 and 12,000.'),
  dimensions: Text(80),
  description: Text(500),
});
const Sections = z
  .array(Section)
  .max(500)
  // "s-101" and "S-101" are the same section to the people choosing one in the app.
  .refine((sections) => new Set(sections.map((section) => section.code.toLowerCase())).size === sections.length, 'Two sections have the same code.');

/** Module 8: the cutlist cards and configurations, and the bar sections. Every signed-in person reads them; Owners and Catalogue editors change them. */
export function calculatorRoutes(sql: Sql) {
  const calculators = new Hono<Env>();
  const editors = only('owner', 'catalogue');

  calculators.get('/calculators', async (c) => {
    const [systems, configurations, sections] = await Promise.all([
      sql`select id, name, subtitle, photo from cutlist_systems order by sort_order`,
      sql`select system_id, name, image from cutlist_configurations order by system_id, sort_order`,
      sql`select code, name, system, bar_mm as bar, dimensions, description from bar_sections order by sort_order`,
    ]);
    const bySystem = Object.fromEntries(SYSTEM_IDS.map((id) => [id, configurations.filter((row) => row.system_id === id).map(({ name, image }) => ({ name, image }))]));
    return c.json({ cutlist: { systems, configurations: bySystem }, sections });
  });

  // The whole cutlist at once: three cards and a couple of dozen configurations, in the order the app shows them.
  calculators.put('/cutlist', editors, jsonBody(z.object({ cutlist: Cutlist, version: Seen })), async (c) => {
    const { cutlist, version } = c.req.valid('json');
    const { systems, configurations } = cutlist;
    await sql.begin(async (tx) => {
      await claimList(tx, 'cutlist', version);
      for (const [sort_order, system] of systems.entries()) {
        await tx`update cutlist_systems set name = ${system.name}, subtitle = ${system.subtitle}, photo = ${system.photo}, sort_order = ${sort_order} where id = ${system.id}`;
      }
      await tx`delete from cutlist_configurations`;
      const rows = SYSTEM_IDS.flatMap((system_id) => configurations[system_id].map((item, sort_order) => ({ system_id, name: item.name, image: item.image, sort_order })));
      if (rows.length) await tx`insert into cutlist_configurations ${tx(rows)}`;
    });
    return c.body(null, 204);
  });

  // The whole section library at once: it is short, and the order is the order people see.
  calculators.put('/bar-sections', editors, jsonBody(z.object({ sections: Sections, version: Seen })), async (c) => {
    const { sections, version } = c.req.valid('json');
    const rows = sections.map(({ bar, ...section }, sort_order) => ({ ...section, bar_mm: bar, sort_order }));
    await sql.begin(async (tx) => {
      await claimList(tx, 'sections', version);
      await tx`delete from bar_sections`;
      if (rows.length) await tx`insert into bar_sections ${tx(rows)}`;
    });
    return c.body(null, 204);
  });

  return calculators;
}
