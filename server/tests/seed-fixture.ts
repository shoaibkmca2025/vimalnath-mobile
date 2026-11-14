import type { Seed } from '../../admin/src/data/types.ts';

/** A small copy of the app's data, in the shape the admin's seed script writes. */
export const seed: Seed = {
  generatedAt: '2026-11-09',
  categories: [{ id: 'glass', label: 'Glass Hardware', image: '/media/a.webp', fit: 'cover', visible: true }],
  products: [
    {
      id: 'p1',
      code: 'TGH-55',
      name: 'H Type Handle',
      category: 'glass',
      section: 'Door Handles',
      image: null,
      catalogPage: { source: 'master', page: 10 },
      options: [
        { label: 'SSS', code: 'TGH-55-S', mrp: 1500 },
        { label: 'BM', mrp: 1700 },
      ],
      specs: [{ label: 'Finish', value: 'Steel' }],
      featured: true,
      visible: true,
    },
    // The same code on a second product, as the real catalogues have.
    { id: 'p2', code: 'TGH-55', name: '', category: 'glass', section: 'Partition Hardware', image: '/media/b.webp', catalogPage: { source: 'office', page: 21 }, options: [{ label: 'SSS', mrp: 1500 }], specs: [], featured: false, visible: true },
  ],
  catalogPages: { 'master-10': '/media/pages/master-10.webp', 'office-21': '/media/pages/office-21.webp' },
  catalogues: [{ number: '01', kicker: 'MASTER', title: 'Master', meta: 'Feb 2026', tone: 'blue', url: '' }],
  sections: [{ code: 'S-101', name: 'Sliding frame', system: 'Sliding', bar: 6000, dimensions: '45 × 25 mm', description: 'Frame.' }],
  videoSections: [{ title: 'Sliding', videos: [{ title: 'Telescopic', detail: '1+0 to 4+1', url: 'https://youtube.com/x' }] }],
  cutlist: {
    systems: [{ id: 'telescopic', name: 'Telescopic', subtitle: 'Travel', photo: null }],
    configurations: { telescopic: [{ name: '1+0', image: '/media/c.jpg' }], synchronized: [], folding: [] },
  },
  banners: [{ id: 'hero-1', image: '/media/h.webp', kicker: 'New', headline: 'Move', body: 'Text', active: true }],
  settings: { companyName: 'Vimalnath', tagline: 't', phone: '', email: '', website: '', address: '', defaultUnit: 'mm', priceListEdition: 'Feb 2026', developer: '4AM', appVersion: '1.0.0', logo: '/media/l.png' },
};
