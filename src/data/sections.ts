export type Section = {
  code: string;
  name: string;
  system: string;
  /** Standard bar length in mm. */
  bar: number;
  dimensions: string;
  description: string;
};

// Sample records carried over from the web prototype — replace with approved Vimalnath section data.
export const sections: Section[] = [
  { code: 'S-101', name: 'Sliding frame', system: 'Sliding', bar: 6000, dimensions: '45 × 25 mm', description: 'Primary frame profile for sliding window assemblies.' },
  { code: 'S-102', name: 'Interlock profile', system: 'Sliding', bar: 6000, dimensions: '38 × 18 mm', description: 'Interlock profile for aligned sliding sashes.' },
  { code: 'P-201', name: 'Slim mullion', system: 'Partition', bar: 6000, dimensions: '25 × 25 mm', description: 'Slim vertical profile for partition modules.' },
  { code: 'P-205', name: 'Partition track', system: 'Partition', bar: 6000, dimensions: '32 × 20 mm', description: 'Top and bottom track for slim partition modules.' },
  { code: 'F-301', name: 'Folding stile', system: 'Folding', bar: 6000, dimensions: '42 × 24 mm', description: 'Vertical stile for folding door panel assemblies.' },
  { code: 'F-305', name: 'Folding rail', system: 'Folding', bar: 6000, dimensions: '30 × 18 mm', description: 'Smooth running rail for folding system panels.' },
  { code: 'SH-401', name: 'Shower channel', system: 'Shower', bar: 6000, dimensions: '25 × 15 mm', description: 'Clean channel profile for frameless shower cubicles.' },
  { code: 'SH-406', name: 'Shower jamb', system: 'Shower', bar: 6000, dimensions: '35 × 22 mm', description: 'Wall jamb profile for shower enclosure glazing.' },
  { code: 'H-501', name: 'Handle rail', system: 'Hardware', bar: 6000, dimensions: 'Ø 25 mm', description: 'Architectural handle rail for sliding and wardrobe systems.' },
  { code: 'H-505', name: 'Wardrobe track', system: 'Hardware', bar: 6000, dimensions: '28 × 16 mm', description: 'Compact track profile for premium wardrobe doors.' },
];

export const sectionTones: [string, string][] = [
  ['#e4ebff', '#9fbaff'],
  ['#f9ebd8', '#e7c18f'],
  ['#e1f2eb', '#8ac9b3'],
  ['#fbe3dc', '#eaa184'],
  ['#e1e5ec', '#8d97aa'],
  ['#efe1fa', '#c49bdd'],
];
