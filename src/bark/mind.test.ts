import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Mind, type Frame, type Ground } from './mind.ts';
import { draw, REST } from './pose.ts';
import { STROKES } from './shape.ts';

const ground: Ground = { left: 50, right: 950, size: 70 };

/** Runs Bark for a while at 60 frames a second and returns every frame. */
function run(mind: Mind, seconds: number): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) frames.push(mind.step(1 / 60, ground));
  return frames;
}

const last = (frames: Frame[]): Frame => frames[frames.length - 1]!;

test('at rest the drawing is the mark, point for point', () => {
  const drawing = draw(REST);
  // The back stroke starts at the end of the nose and its first curve ends at the nose's corner.
  assert.ok(drawing.lines[0].startsWith('M408.6,-428.7C413.0,-446.5 419.8,-467.0 422.4,-486.0'));
  // Standing, every sole is on the ground.
  assert.equal(drawing.hindSole, 0);
  assert.equal(drawing.foreSole, 0);
});

test('every moving part leaves some of the drawing alone', () => {
  for (const stroke of STROKES) {
    for (const weights of [stroke.head, stroke.ear, stroke.beard, stroke.hindLift, stroke.foreLift]) {
      assert.ok(weights.every((w) => w >= 0 && w <= 1));
    }
  }
  // The belly line never lifts with the legs.
  const belly = STROKES[2]!;
  for (let p = 0; p < belly.rest.length / 2; p++) {
    if (belly.rest[p * 2 + 1] === -89) {
      assert.equal(belly.hindLift[p], 0);
      assert.equal(belly.foreLift[p], 0);
    }
  }
});

test('he runs to the pointer, stops under it, and faces the way he came', () => {
  const mind = new Mind(100);
  mind.watch({ x: 800, y: 200 });
  const frames = run(mind, 4);
  const end = last(frames);
  assert.ok(Math.abs(end.x - 800) < ground.size * 0.2, `stopped at ${end.x}`);
  assert.equal(end.facing, 1);
  assert.ok(frames.some((f) => f.pose.hindLift > 5), 'his feet leave the ground while he runs');
  // Standing again, his legs are back where the mark has them.
  assert.ok(Math.abs(end.pose.hindReach) < 1 && Math.abs(end.pose.foreReach) < 1);
  assert.ok(end.pose.hindLift < 1 && end.pose.foreLift < 1);
});

test('he turns round to chase a pointer behind him', () => {
  const mind = new Mind(800);
  mind.watch({ x: 100, y: 0 });
  const end = last(run(mind, 4));
  assert.equal(end.facing, -1);
  assert.ok(Math.abs(end.x - 100) < ground.size * 0.2);
});

test('he never leaves the ground he is given', () => {
  const mind = new Mind(500);
  mind.watch({ x: 5000, y: 0 });
  assert.ok(last(run(mind, 5)).x <= ground.right + 1);
  mind.watch({ x: -5000, y: 0 });
  assert.ok(last(run(mind, 6)).x >= ground.left - 1);
});

test('a press makes him jump about his own height and land where he stood', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  mind.jump();
  const frames = run(mind, 1.5);
  const peak = Math.max(...frames.map((f) => f.lift));
  assert.ok(peak > ground.size * 0.9 && peak < ground.size * 1.3, `peak ${peak}`);
  const end = last(frames);
  assert.ok(end.lift < 0.5, 'back on the ground');
  assert.ok(Math.abs(end.squash - 1) < 0.03, 'and back in shape');
  assert.ok(frames.some((f) => f.squash < 0.9), 'he gathers before he jumps');
});

test('a second press in the air does nothing', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  mind.jump();
  run(mind, 0.2);
  mind.jump();
  const frames = run(mind, 1.5);
  const landings = frames.filter((f, i) => i > 0 && f.lift < 0.5 && frames[i - 1]!.lift >= 0.5);
  assert.equal(landings.length, 1);
});

test('his body never stretches far from the mark', () => {
  const mind = new Mind(100);
  mind.watch({ x: 900, y: 0 });
  const frames = run(mind, 1);
  mind.jump();
  frames.push(...run(mind, 2));
  for (const f of frames) {
    assert.ok(f.squash >= 0.7 && f.squash <= 1.2);
    assert.ok(Math.abs(f.pitch) < 0.2);
    assert.ok(Math.abs(f.pose.head) < 0.35 && Math.abs(f.pose.ear) < 0.9);
  }
});
