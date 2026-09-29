import type { ProductOption, ShopProduct } from './types';

// Complete system kits, typed in from the Taiton Tavic price list (Edition #5, Feb-2026) and
// checked against the printed pages. MRP in rupees.

const FINISHES = {
  normal: 'Normal · Black Matte (BM)',
  normalGold: 'Normal · Brushed Gold / Rose Gold',
  hd: 'Heavy Duty · Black Matte (BM)',
  hdGold: 'Heavy Duty · Brushed Gold / Rose Gold / Grey / Champagne',
};

/** Normal and heavy-duty kits in black matte and gold finishes, as printed on each system page. */
function kitOptions(normalCode: string | null, normal: [number, number] | null, hdCode: string, hd: [number, number]): ProductOption[] {
  const options: ProductOption[] = [];
  if (normalCode && normal) {
    options.push({ label: FINISHES.normal, code: normalCode, mrp: normal[0] }, { label: FINISHES.normalGold, code: normalCode, mrp: normal[1] });
  }
  options.push({ label: FINISHES.hd, code: hdCode, mrp: hd[0] }, { label: FINISHES.hdGold, code: hdCode, mrp: hd[1] });
  return options;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const systemSpecs = (type: string, weight: string) => [
  { label: 'System type', value: type },
  { label: 'Max panel size', value: '950 mm (W) × 3000 mm (H)' },
  { label: 'Max weight capacity', value: weight },
  { label: 'Glass thickness', value: '5 mm to 10 mm' },
  { label: 'Security', value: 'Handle with latch / lock' },
  { label: 'Profile', value: '35 × 16 mm' },
];
const NORMAL_HD_WEIGHT = '60 kg (Normal), 80 kg (HD)';

const telescopicImages = [
  require('../../../assets/images/telescopic/tile-01.jpg'),
  require('../../../assets/images/telescopic/tile-02.jpg'),
  require('../../../assets/images/telescopic/tile-03.jpg'),
  require('../../../assets/images/telescopic/tile-04.jpg'),
  require('../../../assets/images/telescopic/tile-05.jpg'),
  require('../../../assets/images/telescopic/tile-06.jpg'),
  require('../../../assets/images/telescopic/tile-07.jpg'),
  require('../../../assets/images/telescopic/tile-08.jpg'),
];
const synchroImages = [
  require('../../../assets/images/synchronized/tile-01.jpg'),
  require('../../../assets/images/synchronized/tile-02.jpg'),
  require('../../../assets/images/synchronized/tile-03.jpg'),
  require('../../../assets/images/synchronized/tile-04.jpg'),
  require('../../../assets/images/synchronized/tile-05.jpg'),
  require('../../../assets/images/synchronized/tile-06.jpg'),
];

const telescopic = (
  index: number,
  config: string,
  page: number,
  options: ProductOption[],
  weight = NORMAL_HD_WEIGHT,
): ShopProduct => ({
  id: `telescopic-${slug(config)}`,
  code: `TAV-${config.replace(' HD', '')}${config.includes('HD') ? '-HD' : ''}-SYS`,
  name: `${config} Telescopic Sliding System`,
  category: 'telescopic',
  section: 'Telescopic Sliding Systems',
  image: telescopicImages[index],
  catalogPage: { source: 'tavic', page },
  options,
  specs: systemSpecs(`${config} telescopic sliding`, weight),
  featured: true,
});

const synchro = (index: number, config: string, page: number, options: ProductOption[], weight = '80 kg'): ShopProduct => ({
  id: `synchro-${slug(config)}`,
  code: `TAV-${config}-OPP${config === '2+0' || config === '2+2' ? '' : '-HD'}-SYS`,
  name: `${config} Synchro Sliding System`,
  category: 'synchro',
  section: 'Synchro Sliding Systems',
  image: synchroImages[index],
  catalogPage: { source: 'tavic', page },
  options,
  specs: systemSpecs(`${config} OPP synchro sliding`, weight),
  featured: true,
});

const foldingKit = (doors: number, prices: [number, number, number, number]): ShopProduct => ({
  id: `folding-kit-${doors}-door`,
  code: `TAV-SFS-${doors} DOOR-8/10`,
  name: `${doors} Door Sliding Folding Kit`,
  category: 'folding',
  section: 'Sliding Folding System',
  image: require('../../../assets/shop/systems/sliding-folding.webp'),
  catalogPage: { source: 'tavic', page: 40 },
  options: [
    { label: 'Black Matte (BM) · 700 mm × 8 ft', mrp: prices[0] },
    { label: 'Black Matte (BM) · 700 mm × 10 ft', mrp: prices[1] },
    { label: 'Brushed Gold / Champagne · 700 mm × 8 ft', mrp: prices[2] },
    { label: 'Brushed Gold / Champagne · 700 mm × 10 ft', mrp: prices[3] },
  ],
  specs: [
    { label: 'Panels', value: `${doors} doors` },
    { label: 'Panel size', value: '700 mm wide, 8 ft or 10 ft high' },
    { label: 'Finishes', value: 'Black Matte, Brushed Gold, Champagne' },
  ],
  featured: doors <= 4,
});

const frameless = (doors: 2 | 3 | 4, mrp: number): ShopProduct => ({
  id: `frameless-telescopic-${doors}-door`,
  code: `TSL-FL-0${doors}`,
  name: `Frameless Telescopic ${doors} Door System`,
  category: 'telescopic',
  section: 'Frameless Telescopic Sliding',
  image: [
    require('../../../assets/shop/systems/frameless-2.webp'),
    require('../../../assets/shop/systems/frameless-3.webp'),
    require('../../../assets/shop/systems/frameless-4.webp'),
  ][doors - 2],
  catalogPage: { source: 'tavic', page: 25 },
  options: [
    { label: 'Silver', mrp },
    { label: 'Black Matte (BM)', mrp },
  ],
  specs: [
    { label: 'Glass thickness', value: '8 mm to 12 mm' },
    { label: 'Door width', value: '550 mm to 1200 mm' },
  ],
});

export const systemProducts: ShopProduct[] = [
  telescopic(0, '1+0', 7, [
    { label: 'Black Matte (BM)', code: 'TAV-1+0-35-AL KIT', mrp: 28200 },
    { label: 'Brushed Gold / Rose Gold', code: 'TAV-1+0-35-AL KIT', mrp: 30000 },
  ]),
  telescopic(1, '1+1', 8, kitOptions('TAV-1+1-35HK-AL KIT', [45750, 52200], 'TAV-1+1-HD-35HK-AL KIT', [47300, 53600])),
  telescopic(2, '2+0', 9, kitOptions('TAV-2+0-35HK-AL KIT', [58700, 65900], 'TAV-2+0-HD-35HK-AL KIT', [68500, 75400])),
  telescopic(3, '2+1', 10, kitOptions('TAV-2+1-35HK-AL KIT', [78100, 83500], 'TAV-2+1-HD-35HK-AL KIT', [88800, 93800])),
  telescopic(4, '3+0', 11, kitOptions('TAV-3+0-35HK-AL KIT', [90800, 97900], 'TAV-3+0-HD-35HK-AL KIT', [104700, 110600])),
  telescopic(5, '3+1', 12, kitOptions('TAV-3+1-35HK-AL KIT', [113000, 122700], 'TAV-3+1-HD-35HK-AL KIT', [127500, 136400])),
  telescopic(6, '4+0 HD', 13, kitOptions(null, null, 'TAV-4+0-HD-35HK-AL KIT', [156200, 167200]), '80 kg'),
  telescopic(7, '4+1 HD', 14, kitOptions(null, null, 'TAV-4+1-HD-35HK-AL KIT', [186800, 198200]), '80 kg'),
  frameless(2, 48600),
  frameless(3, 60500),
  frameless(4, 71000),
  {
    id: 'frameless-top-track',
    code: 'TAV-HD-TT',
    name: 'Frameless Top Track',
    category: 'telescopic',
    section: 'Frameless Telescopic Sliding',
    catalogPage: { source: 'tavic', page: 25 },
    options: [
      { label: '5 m · Silver', mrp: 11500 },
      { label: '5 m · Black Matte (BM)', mrp: 12080 },
      { label: '6 m · Silver', mrp: 13800 },
      { label: '6 m · Black Matte (BM)', mrp: 14500 },
    ],
  },
  {
    id: 'frameless-top-track-cover',
    code: 'TAV-HD-TT-COVER-FL',
    name: 'Frameless Top Track Cover',
    category: 'telescopic',
    section: 'Frameless Telescopic Sliding',
    catalogPage: { source: 'tavic', page: 25 },
    options: [
      { label: '5 m · Silver', mrp: 6700 },
      { label: '5 m · Black Matte (BM)', mrp: 7200 },
      { label: '6 m · Silver', mrp: 8000 },
      { label: '6 m · Black Matte (BM)', mrp: 8700 },
    ],
  },
  {
    id: 'linkage-3-door',
    code: 'TAV-3B',
    name: 'Three Linkage Moving Door',
    category: 'telescopic',
    section: 'Linkage Inter-moving Doors',
    image: require('../../../assets/shop/systems/linkage-3.webp'),
    catalogPage: { source: 'tavic', page: 27 },
    options: [
      { label: 'Hardware kit (AL)', code: 'TAV-3B-AL KIT', mrp: 30200 },
      { label: 'Full kit 35×16 · Black Matte (BM)', code: 'TAV-3B-FULL KIT (35X16)', mrp: 98500 },
      { label: 'Full kit 35×16 · Brushed Gold (BG)', code: 'TAV-3B-FULL KIT (35X16)', mrp: 104500 },
    ],
    specs: [{ label: 'Operation', value: '3 telescopic soft-close panels sliding in both directions, with bottom wheel' }],
  },
  {
    id: 'linkage-4-door',
    code: 'TAV-4B',
    name: 'Four Linkage Moving Door',
    category: 'telescopic',
    section: 'Linkage Inter-moving Doors',
    image: require('../../../assets/shop/systems/linkage-4.webp'),
    catalogPage: { source: 'tavic', page: 27 },
    options: [
      { label: 'Hardware kit (AL)', code: 'TAV-4B-AL KIT', mrp: 36700 },
      { label: 'Full kit 35×16 · Black Matte (BM)', code: 'TAV-4B-FULL KIT (35X16)', mrp: 131500 },
      { label: 'Full kit 35×16 · Brushed Gold (BG)', code: 'TAV-4B-FULL KIT (35X16)', mrp: 142000 },
    ],
    specs: [{ label: 'Operation', value: '4 telescopic soft-close panels sliding in both directions, with bottom wheel' }],
  },

  synchro(0, '2+0', 16, kitOptions('TAV-OPP-2+0-35-AL KIT', [54100, 60700], 'TAV-OPP-2+0-HD-35-AL KIT', [63700, 70150]), NORMAL_HD_WEIGHT),
  synchro(1, '2+2', 17, kitOptions('TAV-OPP-2+2-35HK-AL KIT', [92300, 100200], 'TAV-OPP-2+2-HD-35HK-AL KIT', [103600, 111200]), NORMAL_HD_WEIGHT),
  synchro(2, '4+0', 18, kitOptions(null, null, 'TAV-OPP-4+0-HD-35HK-AL KIT', [135800, 144700])),
  synchro(3, '4+2', 19, kitOptions(null, null, 'TAV-OPP-4+2-HD-35HK-AL KIT', [176400, 186300])),
  synchro(4, '6+0', 20, kitOptions(null, null, 'TAV-OPP-6+0-HD-35HK-AL KIT', [208500, 220100])),
  synchro(5, '6+2', 21, kitOptions(null, null, 'TAV-OPP-6+2-HD-35HK-AL KIT', [254000, 271700])),
  {
    id: 'frameless-synchro-2-door',
    code: 'TSL-FL-OPP-2',
    name: 'Frameless Synchro 2 Door System',
    category: 'synchro',
    section: 'Frameless Synchro Sliding',
    image: require('../../../assets/shop/systems/frameless-synchro.webp'),
    catalogPage: { source: 'tavic', page: 26 },
    options: [
      { label: 'Silver', mrp: 54000 },
      { label: 'Black Matte (BM)', mrp: 54000 },
    ],
    specs: [{ label: 'Operation', value: 'Frameless telescopic sliding, 2 glass doors opening in opposite directions' }],
  },

  foldingKit(2, [70000, 74000, 77000, 83000]),
  foldingKit(3, [101000, 108000, 113000, 121000]),
  foldingKit(4, [129000, 138000, 144000, 155000]),
  foldingKit(5, [166000, 178000, 186000, 200000]),
  foldingKit(6, [195000, 209000, 218000, 234000]),
  foldingKit(7, [225000, 241000, 251000, 270000]),
  foldingKit(8, [259000, 278000, 290000, 312000]),
  foldingKit(9, [302000, 323000, 337000, 362000]),
  foldingKit(10, [322000, 345000, 360000, 387000]),
];
