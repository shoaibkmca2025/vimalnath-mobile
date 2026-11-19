import assert from 'node:assert/strict';
import test from 'node:test';

import { customerKey } from '../src/data/orders.ts';
import { planBars } from '../src/generated/app-lib/bar-optimizer.ts';
import { computeGlassPlan } from '../src/generated/app-lib/glass-calculator.ts';

/** The result for a size that must work; the app's own calculator, copied in by the seed. */
function plan(system: string, width: number, height: number, panels = 1) {
  const outcome = computeGlassPlan(system, width, height, panels);
  assert.ok('result' in outcome, `${system} ${width}×${height} should work`);
  return outcome.result;
}

/** A bar plan that must work. */
function bars(request: Parameters<typeof planBars>[0]) {
  const outcome = planBars(request);
  assert.ok('plan' in outcome, 'the plan should work');
  return outcome.plan;
}

test('telescopic sizes match the confirmed rule', () => {
  const known: [string, number, number, number, number][] = [
    ['1+0', 900, 916, 895, 1],
    ['1+1', 1820, 918, 897, 2],
    ['2+0', 1820, 926, 905, 2],
    ['2+1', 2730, 921, 900, 3],
    ['3+0', 2730, 926, 905, 3],
    ['3+1', 3640, 922, 901, 4],
    ['4+0', 3640, 926, 905, 4],
    ['4+1', 4550, 923, 902, 5],
  ];
  for (const [system, width, cutting, glass, quantity] of known) {
    const result = plan(`${system} Sliding System`, width, 2400);
    assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [cutting, 2307, glass, 2286, quantity], system);
  }
});

test('the 2+1 material list follows its rules', () => {
  const materials = Object.fromEntries(plan('2+1 Sliding System', 2730, 2400).materials.map((item) => [item.label, item.value]));
  assert.equal(materials['Vertical Profile'], '6 nos (2.5 m)');
  assert.equal(materials['Horizontal Profile'], '2 nos (118″)');
  assert.equal(materials['Top Track'], '3 nos (10 ft)');
  assert.equal(materials['Gasket'], '8 nos (8mm)');
  assert.equal(materials['Connector'], '12 nos');
});

test('an opening outside the allowed size is refused', () => {
  assert.ok('error' in computeGlassPlan('2+1 Sliding System', 1000, 2400, 3));
  assert.ok('error' in computeGlassPlan('2+1 Sliding System', 2730, 3100, 3));
  // 1+1 takes openings from 1200 to 2400 mm wide.
  assert.ok('error' in computeGlassPlan('1+1 Sliding System', 2438, 2400, 2));
});

test('a panel over the printed 950 mm limit warns, and one within it does not', () => {
  assert.equal(plan('1+1 Sliding System', 1880, 2400).warning, undefined);
  assert.match(plan('1+1 Sliding System', 2000, 2400).warning ?? '', /over the 950 mm/);
});

test('synchro sizes follow their confirmed formula', () => {
  const result = plan('2+2 Synchro Sliding System', 2400, 2400, 4);
  assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [608, 2307, 587, 2286, 4]);
  assert.equal(result.warning, undefined);
});

test('2 door sliding folding: (length − 63) ÷ 2 by height − 60, glass 3 and 54 mm smaller, within 600–1800 × 1000–3000', () => {
  const name = '2 Door Sliding Folding System';
  const result = plan(name, 1200, 2100, 2);
  assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [569, 2040, 566, 1986, 2]);
  const row = (label: string, from = result) => from.materials.find((item) => item.label.startsWith(label))?.value;
  assert.deepEqual([row('Vertical Profile'), row('Horizontal Profile'), row('Top Track'), row('Gasket'), row('Top and Bottom Hinge')], ['4 nos (2.5 m)', '1 nos (96″)', '1 nos (2.5 m)', '5 nos (8mm)', '2 pair']);
  // Over a 2400 mm cutting height the vertical profiles are 3 m.
  const tall = plan(name, 1800, 3000, 2);
  assert.deepEqual([tall.cuttingWidth, tall.cuttingHeight, row('Vertical Profile', tall), row('Horizontal Profile', tall)], [869, 2940, '4 nos (3 m)', '2 nos (96″)']);
  for (const [width, height] of [[599, 2000], [1801, 2000], [1200, 999], [1200, 3001]] as const) assert.ok('error' in computeGlassPlan(name, width, height, 2));
});

test('3 door sliding folding: (length − 92) ÷ 3 by height − 60, within 900–2700 × 1000–3000, with the outer vertical gaskets', () => {
  const name = '3 Door Sliding Folding System';
  const result = plan(name, 1800, 2100, 3);
  assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [569, 2040, 566, 1986, 3]);
  const row = (label: string, from = result) => from.materials.find((item) => item.label.startsWith(label))?.value;
  assert.deepEqual(
    ['Vertical Profile', 'Horizontal Profile', 'Top Track', 'Profile Corner End Cap', 'Anti-Collision Magnet', 'Hanging Wheel', 'Gasket', 'Outer Vertical Gasket', 'Top and Bottom Hinge'].map((label) => row(label)),
    ['6 nos (2.5 m)', '2 nos (96″)', '1 nos (6 ft)', '12 nos', '8 pair', '1 nos', '8 nos (8mm)', '15 m each', '4 pair'],
  );
  const tall = plan(name, 2700, 3000, 3);
  assert.deepEqual([tall.cuttingWidth, tall.cuttingHeight, row('Vertical Profile', tall), row('Outer Vertical Gasket', tall)], [869, 2940, '6 nos (3 m)', '18 m each']);
  for (const [width, height] of [[899, 2000], [2701, 2000], [1800, 999], [1800, 3001]] as const) assert.ok('error' in computeGlassPlan(name, width, height, 3));
  assert.equal(row('Lock and Rod'), '2 nos');
  // 2 doors keeps its own counts and a 2.5 m top track.
  const two = plan('2 Door Sliding Folding System', 1200, 2100, 2);
  assert.deepEqual(
    ['Vertical Profile', 'Top Track', 'Lock and Rod', 'Anti-Collision Magnet', 'Hanging Wheel', 'Outer Vertical Gasket'].map((label) => row(label, two)),
    ['4 nos (2.5 m)', '1 nos (2.5 m)', '1 nos', '4 pair', '1 nos', '10 m each'],
  );
});

test('4 door sliding folding: (length − 121) ÷ 4 by height − 60, within 1200–3600 × 1000–3000', () => {
  const name = '4 Door Sliding Folding System';
  const result = plan(name, 2400, 2100, 4);
  assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [570, 2040, 567, 1986, 4]);
  const row = (label: string, from = result) => from.materials.find((item) => item.label.startsWith(label))?.value;
  assert.deepEqual(
    ['Vertical Profile', 'Top Track', 'Lock and Rod', 'Profile Corner End Cap', 'Anti-Collision Magnet', 'Hanging Wheel', 'Outer Vertical Gasket', 'Top and Bottom Hinge'].map((label) => row(label)),
    ['8 nos (2.5 m)', '1 nos (8 ft)', '2 nos', '16 nos', '12 pair', '2 nos', '20 m each', '6 pair'],
  );
  const tall = plan(name, 3600, 3000, 4);
  assert.deepEqual([tall.cuttingWidth, tall.cuttingHeight, row('Vertical Profile', tall), row('Top Track', tall), row('Outer Vertical Gasket', tall)], [870, 2940, '8 nos (3 m)', '1 nos (12 ft)', '24 m each']);
  for (const [width, height] of [[1199, 2000], [3601, 2000], [2400, 999], [2400, 3001]] as const) assert.ok('error' in computeGlassPlan(name, width, height, 4));
});

test('5 to 10 door sliding folding follow the 2–4 door pattern', () => {
  const row = (result: ReturnType<typeof plan>, label: string) => result.materials.find((item) => item.label.startsWith(label))?.value;
  const five = plan('5 Door Sliding Folding System', 3000, 2100, 5);
  assert.deepEqual([five.cuttingWidth, five.cuttingHeight, five.glassWidth, five.glassHeight, five.glassQuantity], [570, 2040, 567, 1986, 5]);
  assert.deepEqual(
    ['Vertical Profile', 'Top Track', 'Lock and Rod', 'Profile Corner End Cap', 'Anti-Collision Magnet', 'Hanging Wheel', 'Outer Vertical Gasket', 'Top and Bottom Hinge'].map((label) => row(five, label)),
    ['10 nos (2.5 m)', '1 nos (10 ft)', '3 nos', '20 nos', '16 pair', '2 nos', '25 m each', '8 pair'],
  );
  const ten = plan('10 Door Sliding Folding System', 6000, 2100, 10);
  assert.deepEqual([ten.cuttingWidth, ten.glassQuantity, row(ten, 'Vertical Profile'), row(ten, 'Anti-Collision Magnet'), row(ten, 'Hanging Wheel')], [571, 10, '20 nos (2.5 m)', '36 pair', '5 nos']);
  for (const [name, doors, min, max] of [['5 Door Sliding Folding System', 5, 1500, 4500], ['10 Door Sliding Folding System', 10, 3000, 9000]] as const) {
    assert.ok('error' in computeGlassPlan(name, min - 1, 2000, doors));
    assert.ok('error' in computeGlassPlan(name, max + 1, 2000, doors));
  }
});

test('a system without a confirmed formula gives per-panel sizes and a warning', () => {
  const result = plan('Custom Sliding System', 2400, 2400, 5);
  assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [476, 2380, 476, 2380, 5]);
  assert.match(result.warning ?? '', /No confirmed formula/);
});

test('every piece ends up in a bar, and no bar is overfilled', () => {
  const pieces = [
    { length: 1950, qty: 4 },
    { length: 1016, qty: 6 },
    { length: 780, qty: 2 },
  ];
  const kerf = 3;
  const result = bars({ pieces, stock: [{ length: 6000 }], kerf });
  assert.deepEqual(
    result.bars.flatMap((bar) => bar.pieces).sort((a, b) => a - b),
    pieces.flatMap((piece) => Array.from({ length: piece.qty }, () => piece.length)).sort((a, b) => a - b),
  );
  for (const bar of result.bars) assert.ok(bar.pieces.reduce((sum, piece) => sum + piece, 0) + kerf * (bar.pieces.length - 1) <= bar.length);
});

test('cutting loss is counted between pieces', () => {
  assert.equal(bars({ pieces: [{ length: 2000, qty: 3 }], stock: [{ length: 6000 }], kerf: 0 }).bars.length, 1);
  assert.equal(bars({ pieces: [{ length: 2000, qty: 3 }], stock: [{ length: 6000 }], kerf: 3 }).bars.length, 2);
});

test('inch plans work in sixteenths, and running out of stock names no unit', () => {
  assert.equal(bars({ pieces: [{ length: 512, qty: 3 }], stock: [{ length: 1536 }], kerf: 0, unit: 'in' }).bars.length, 1);
  const outcome = planBars({ pieces: [{ length: 760, qty: 3 }], stock: [{ length: 1536, qty: 1 }], kerf: 0, unit: 'in' });
  assert.ok('error' in outcome);
  assert.doesNotMatch(outcome.error, /mm/);
});

test('a mistyped quantity is refused instead of freezing the app', () => {
  const outcome = planBars({ pieces: [{ length: 1000, qty: 200000 }], stock: [{ length: 6000 }], kerf: 0 });
  assert.ok('error' in outcome);
  assert.match(outcome.error, /up to 10000 pieces/);
});

test('customer links work for names in any language', () => {
  assert.equal(customerKey('Patel Glass & Hardware'), 'patel-glass-and-hardware');
  assert.ok(customerKey('शर्मा ग्लास'));
  assert.notEqual(customerKey('शर्मा ग्लास'), customerKey('वर्मा ग्लास'));
});
