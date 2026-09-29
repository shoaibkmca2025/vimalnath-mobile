export type CatalogueTone = 'blue' | 'sand' | 'green' | 'muted';

export type Catalogue = {
  number: string;
  kicker: string;
  title: string;
  meta: string;
  tone: CatalogueTone;
  /** Missing when the catalogue has not been published yet. */
  url?: string;
};

// Taiton price lists, Feb 2026. The PDFs are 37–110 MB, so they are hosted online and opened by link
// rather than bundled into the app. Fill in each `url` with its "Anyone with the link" share link.
export const catalogues: Catalogue[] = [
  {
    number: '01',
    kicker: 'MASTER CATALOGUE',
    title: 'Master Catalogue Price List',
    meta: 'Feb 2026 · PDF',
    tone: 'blue',
  },
  {
    number: '02',
    kicker: 'SPACE SYSTEMS',
    title: 'Office Partition Price List',
    meta: 'Updated Feb 2026 · PDF',
    tone: 'blue',
  },
  {
    number: '03',
    kicker: 'WARDROBE SYSTEMS',
    title: 'Tavic Wardrobe Sliding Price List',
    meta: 'Edition 5 · Feb 2026 · PDF',
    tone: 'blue',
  },
];
