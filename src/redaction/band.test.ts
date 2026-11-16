import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Band, type Strip } from './band.ts';

const strip: Strip = { left: 100, right: 220, y: 50, height: 18 };

/** Lets a band go and runs it at 60 frames a second, reporting each frame. */
function twang(band: Band, seconds: number, each?: (band: Band) => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    band.step(1 / 60);
    each?.(band);
  }
}

/** The lowest and highest points of an outline, and its leftmost and rightmost. */
function bounds(points: number[]): { top: number; bottom: number; left: number; right: number } {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return { top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs) };
}

test('at rest it is exactly the bar', () => {
  const band = new Band(strip);
  assert.equal(band.moving, false);
  assert.deepEqual(bounds(band.outline()), { top: 41, bottom: 59, left: 100, right: 220 });
  // Held but not yet pulled, it is the bar still.
  band.grab(150, 52);
  band.pull(150, 52);
  assert.deepEqual(bounds(band.outline()), { top: 41, bottom: 59, left: 100, right: 220 });
  assert.equal(band.pulled, 0);
});

test('pulled, it stretches after the hand and uncovers what is under it', () => {
  const band = new Band(strip);
  band.grab(160, 50);
  band.pull(160, 110);
  const o = band.outline();
  // Its ends have not moved.
  assert.deepEqual([o[0], o[1], o[10], o[11]], [100, 41, 100, 59]);
  assert.deepEqual([o[4], o[5], o[6], o[7]], [220, 41, 220, 59]);
  // The held point has gone down after the hand, though not all the way.
  const held = (o[3]! + o[9]!) / 2;
  assert.ok(held > 85 && held < 110, `the held point is at ${held}`);
  assert.equal((o[2]! + o[8]!) / 2, 160);
  // Both its edges at the hand are below where the bar lay: its middle is uncovered.
  assert.ok(o[3]! > 59 && o[9]! > 59, 'clear of the bar');
  // And it is thinner there than it was, measured across the run from its left end.
  const run = Math.hypot(o[8]! - o[10]!, o[9]! - o[11]!);
  const thick = Math.abs((o[2]! - o[8]!) * (o[9]! - o[11]!) - (o[3]! - o[9]!) * (o[8]! - o[10]!)) / run;
  assert.ok(thick < 16 && thick > 4, `as thick as ${thick} at the hand`);
  assert.ok(band.pulled > 2);
});

test('the harder it is pulled the more it resists, and it never comes off', () => {
  const band = new Band(strip);
  band.grab(160, 50);
  const reached: number[] = [];
  for (const far of [40, 80, 160, 400, 5000]) {
    band.pull(160, 50 - far);
    reached.push(50 - (band.outline()[3]! + band.outline()[9]!) / 2);
  }
  for (let i = 1; i < reached.length; i++) assert.ok(reached[i]! > reached[i - 1]!, 'further each time');
  assert.ok(reached[0]! > 30, 'a gentle pull is followed nearly all the way');
  assert.ok(reached[4]! < 120 + 1, `at most its own length: ${reached[4]}`);
  assert.ok(reached[4]! - reached[3]! < reached[1]! - reached[0]!, 'and less and less for the effort');
  // Its ends are where they were, however hard it is pulled.
  const o = band.outline();
  assert.deepEqual([o[0], o[1], o[4], o[5]], [100, 41, 220, 41]);
});

test('pulled along its own line it stays between its ends, however far the hand goes', () => {
  for (const [to, side] of [
    [900, 'right'],
    [-600, 'left'],
  ] as const) {
    const band = new Band(strip);
    band.grab(160, 50);
    band.pull(to, 80);
    const o = band.outline();
    const x = (o[2]! + o[8]!) / 2;
    assert.ok(x > 100 + 10 && x < 220 - 10, `pulled ${side}, the hold is at ${x}`);
    // Every corner of it is between its ends too: nothing folds back past them.
    for (let i = 0; i < 12; i += 2) assert.ok(o[i]! >= 100 - 1e-9 && o[i]! <= 220 + 1e-9);
  }
});

test('held near an end, the hold is a little way in from it', () => {
  const band = new Band(strip);
  band.grab(101, 50);
  band.pull(101, 90);
  const x = (band.outline()[2]! + band.outline()[8]!) / 2;
  assert.ok(x > 110 && x < 120, `held at ${x}`);
});

test('let go, it snaps back past where it lay, twangs, and comes to rest as the bar', () => {
  const band = new Band(strip);
  band.grab(160, 50);
  band.pull(160, 130);
  band.release();
  assert.equal(band.held, false);
  let highest = Infinity;
  let crossings = 0;
  let before = 1;
  let frames = 0;
  twang(band, 2, (b) => {
    if (!b.moving) return;
    frames += 1;
    const y = (b.outline()[3]! + b.outline()[9]!) / 2;
    highest = Math.min(highest, y);
    const side = Math.sign(y - 50);
    if (side !== 0 && side !== before) crossings += 1;
    if (side !== 0) before = side;
  });
  assert.ok(highest < 50 - 18, `it swung ${50 - highest} past where it lay`);
  assert.ok(crossings >= 3, `back and forth ${crossings} times`);
  assert.ok(frames / 60 < 1, `at rest within a second: ${frames / 60}`);
  assert.equal(band.moving, false);
  assert.deepEqual(bounds(band.outline()), { top: 41, bottom: 59, left: 100, right: 220 });
});

test('if the page moves under it, it goes with the page', () => {
  const band = new Band(strip);
  band.grab(160, 50);
  band.pull(160, 100);
  const before = band.outline();
  band.place({ left: 130, right: 250, y: 80, height: 18 });
  const after = band.outline();
  for (let i = 0; i < 12; i += 2) {
    assert.ok(Math.abs(after[i]! - before[i]! - 30) < 1e-9);
    assert.ok(Math.abs(after[i + 1]! - before[i + 1]! - 30) < 1e-9);
  }
});
