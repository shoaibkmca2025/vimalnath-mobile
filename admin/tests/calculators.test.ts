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
    assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [cutting, 2308, glass, 2287, quantity], system);
  }
});

test('the 2+1 material list follows its rules', () => {
  const materials = Object.fromEntries(plan('2+1 Sliding System', 2730, 2400).materials.map((item) => [item.label, item.value]));
  assert.equal(materials['Vertical'], '2 nos (2.5 m)');
  assert.equal(materials['Horizontal'], '2 nos (3 m)');
  assert.equal(materials['Top Track'], '3 nos (9 ft)');
  assert.equal(materials['Gasket'], '9 nos (8mm)');
  assert.equal(materials['Connector'], '12 nos');
});

test('an opening outside the allowed size is refused', () => {
  assert.ok('error' in computeGlassPlan('2+1 Sliding System', 1000, 2400, 3));
  assert.ok('error' in computeGlassPlan('2+1 Sliding System', 2730, 3100, 3));
});

test('a panel over the printed 950 mm limit warns, and one within it does not', () => {
  assert.equal(plan('1+1 Sliding System', 1880, 2400).warning, undefined);
  assert.match(plan('1+1 Sliding System', 2438, 2400).warning ?? '', /over the 950 mm/);
});

test('systems without a confirmed formula give per-panel sizes and a warning', () => {
  for (const system of ['2+2 Synchro Sliding System', '4 Door Sliding Folding System']) {
    const result = plan(system, 2400, 2400, 4);
    assert.deepEqual([result.cuttingWidth, result.cuttingHeight, result.glassWidth, result.glassHeight, result.glassQuantity], [595, 2380, 595, 2380, 4], system);
    assert.match(result.warning ?? '', /No confirmed formula/);
  }
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
