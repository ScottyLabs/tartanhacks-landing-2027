import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Whirl } from './whirl.ts';

/**
 * Moves the pointer along a path given as a function of time, sampled as a
 * mouse is, and reports when the whirl was noticed (in seconds), if it was.
 */
function follow(
  whirl: Whirl,
  path: (t: number) => [number, number],
  seconds: number,
  every = 1 / 120,
  from = 0,
): number[] {
  const noticed: number[] = [];
  for (let t = 0; t < seconds; t += every) {
    const [x, y] = path(t);
    if (whirl.move(x, y, (from + t) * 1000)) noticed.push(t);
  }
  return noticed;
}

/** A circle of a given radius, taken at so many turns a second. */
const circle =
  (radius: number, turns: number, way: 1 | -1 = 1) =>
  (t: number): [number, number] => [
    600 + radius * Math.cos(t * turns * 2 * Math.PI * way),
    300 + radius * Math.sin(t * turns * 2 * Math.PI * way),
  ];

test('whirling the pointer fast is noticed after a couple of circles, either way round', () => {
  for (const way of [1, -1] as const) {
    const at = follow(new Whirl(), circle(70, 3, way), 2);
    assert.ok(at.length >= 1, 'noticed');
    assert.ok(at[0]! > 0.35 && at[0]! < 1, `after ${at[0]} seconds: between one and three circles`);
  }
  // Small circles and big ones alike, and whatever the mouse's rate of reporting.
  assert.equal(follow(new Whirl(), circle(35, 3.5), 2).length >= 1, true);
  assert.equal(follow(new Whirl(), circle(160, 2.5), 2.5).length >= 1, true);
  assert.equal(follow(new Whirl(), circle(70, 3), 2, 1 / 60).length >= 1, true);
  assert.equal(follow(new Whirl(), circle(70, 3), 2, 1 / 500).length >= 1, true);
});

test('circling slowly is not whirling, however long it goes on', () => {
  assert.deepEqual(follow(new Whirl(), circle(70, 1.2), 8), []);
  assert.deepEqual(follow(new Whirl(), circle(30, 1.5), 8), []);
});

test('neither is sweeping the pointer about, or shaking it to and fro', () => {
  // Straight across the page and back, fast.
  assert.deepEqual(
    follow(new Whirl(), (t) => [200 + 800 * Math.abs(((t * 2) % 2) - 1), 300], 6),
    [],
  );
  // Shaken hard, side to side and up and down.
  assert.deepEqual(follow(new Whirl(), (t) => [600 + 90 * Math.sin(t * 40), 300], 6), []);
  assert.deepEqual(follow(new Whirl(), (t) => [600, 300 + 90 * Math.sin(t * 40)], 6), []);
  // A wide lazy figure of eight.
  assert.deepEqual(
    follow(new Whirl(), (t) => [600 + 300 * Math.sin(t * 3), 300 + 120 * Math.sin(t * 6)], 8),
    [],
  );
});

test('one whirl is noticed once, and he gets a rest before the next', () => {
  const whirl = new Whirl();
  const at = follow(whirl, circle(70, 3.5), 6);
  assert.ok(at.length >= 2, 'kept up, it comes round again');
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i]! - at[i - 1]! > 1.5, `not before a second and a half: ${at[i]! - at[i - 1]!}`);
  }
});

test('a pause in the middle starts the count again', () => {
  const whirl = new Whirl();
  // One fast circle, a stop, one more: not two together.
  assert.deepEqual(follow(whirl, circle(70, 3), 0.33), []);
  assert.deepEqual(follow(whirl, circle(70, 3), 0.33, 1 / 120, 0.9), []);
});
