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

const TAITON_CATALOGUES = 'https://taiton.in/wp-content/uploads/2024/catalogues';

export const catalogues: Catalogue[] = [
  {
    number: '01',
    kicker: 'MASTER CATALOGUE',
    title: 'Glass Hardware Master Catalogue',
    meta: 'Edition 9 · PDF',
    tone: 'blue',
    url: `${TAITON_CATALOGUES}/EDITION9%20MASTER%20CATALOGUE%20LATEST%20NOV%202024.pdf`,
  },
  {
    number: '02',
    kicker: 'SPACE SYSTEMS',
    title: 'Office Partition System',
    meta: 'Edition 2 · PDF',
    tone: 'sand',
    url: `${TAITON_CATALOGUES}/OFFICE%20PARTITION%20NEW%20VERSION%20LATEST%20NOV%202024.pdf`,
  },
  {
    number: '03',
    kicker: 'WARDROBE SYSTEMS',
    title: 'Luxury Wardrobes & Sliding Door Systems',
    meta: 'Edition 3 · PDF',
    tone: 'green',
    url: `${TAITON_CATALOGUES}/EDITION3%20TAVIC%20WARDROBE%20SLDING%20LATEST%20NOV%202024a.pdf`,
  },
  {
    number: '04',
    kicker: 'RAILING SYSTEM',
    title: 'Railing System',
    meta: 'Catalogue coming soon',
    tone: 'muted',
  },
];
