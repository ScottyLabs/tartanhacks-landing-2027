import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Mind, type Frame, type Ground } from './mind.ts';
import { draw, REST } from './pose.ts';
import { drawProps } from './props.ts';
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
  // The back stroke starts at the end of the nose (408.6, -428.7 in the mark,
  // measured here from his middle at 45.5) and curves up to the nose's corner.
  assert.ok(drawing.lines[0].startsWith('M363.1,-428.7C367.5,-446.5 374.3,-467.0 376.9,-486.0'));
  // Standing, every sole is on the ground, and his hind feet are behind him.
  assert.equal(drawing.hindSole, 0);
  assert.equal(drawing.foreSole, 0);
  assert.equal(drawing.hindSide, -1);
});

test('squashing and turning move his points, never his line', () => {
  const upright = draw(REST);
  const squashed = draw(REST, { wide: 1.1, tall: 0.8 });
  assert.ok(squashed.lines[0].startsWith('M399.4,-343.0'), 'wider and shorter, point by point');
  // Facing left mirrors him about his middle and swaps which side his hind feet are on.
  const turned = draw(REST, { wide: -1, tall: 1 });
  assert.ok(turned.lines[0].startsWith('M-363.1,-428.7'));
  assert.equal(turned.hindSide, 1);
  assert.notEqual(upright.fill, turned.fill);
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

test('as a judge he holds the card up, and puts it away when let be', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  assert.equal(last(run(mind, 0.1)).props.card, 0);

  mind.dress('judge');
  const up = last(run(mind, 1.5));
  assert.ok(Math.abs(up.props.card - 1) < 0.02, `card ${up.props.card}`);
  assert.equal(up.props.laptop, 0);
  assert.ok(up.pose.head < 0, 'he holds his head up');
  assert.equal(mind.resting, false);

  mind.dress(null);
  const away = last(run(mind, 1.5));
  assert.equal(away.props.card, 0);
  assert.ok(Math.abs(away.pose.head) < 0.05);
});

test('as a hacker he opens the laptop only once he has stopped, then types', () => {
  const mind = new Mind(100);
  mind.dress('hacker');
  mind.watch({ x: 800, y: 0 });
  const running = run(mind, 0.6);
  assert.ok(running.every((f) => f.props.laptop === 0), 'no laptop on the run');

  const typing = run(mind, 4).slice(-60);
  assert.ok(last(typing).props.laptop > 0.98, 'open once he is standing');
  const lifts = typing.map((f) => f.pose.foreLift);
  assert.ok(Math.min(...lifts) >= 19, 'his forepaws stay up on the keys');
  assert.ok(Math.max(...lifts) - Math.min(...lifts) > 8, 'and drum on them');
  assert.ok(lifts.every((lift) => lift <= 41), 'without lifting far for his short legs');
  assert.ok(typing.every((f) => f.pose.hindLift < 1), 'his hind feet stay planted');
  assert.ok(last(typing).pose.head > 0.08, 'he looks down at the screen');
});

test('the laptop shuts when he sets off again, and he ends as the mark', () => {
  const mind = new Mind(400);
  mind.dress('hacker');
  mind.watch({ x: 400, y: 0 });
  run(mind, 1.5);
  mind.watch({ x: 900, y: 0 });
  const leaving = run(mind, 0.5);
  assert.ok(last(leaving).props.laptop < 0.05, 'shut before he is far along');

  mind.dress(null);
  const end = last(run(mind, 4));
  assert.equal(end.props.laptop, 0);
  assert.ok(end.pose.foreLift < 1 && Math.abs(end.pose.foreReach) < 1);
});

test('dressed for a part he holds his ground while the pointer wanders nearby', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  mind.dress('hacker');
  run(mind, 1.5);
  mind.watch({ x: 400 + ground.size * 0.6, y: 0 });
  const nearby = run(mind, 1);
  assert.ok(Math.abs(last(nearby).x - 400) < 2, 'a small move does not shift him');
  assert.ok(nearby.every((f) => f.props.laptop > 0.9), 'and he keeps typing');
});

test('his props are drawn only when out, and the score is never mirrored', () => {
  const mouth = { x: 354, y: -388 };
  const away = drawProps({ card: 0, laptop: 0 }, mouth, 0, { wide: 1, tall: 1 });
  assert.deepEqual([away.stick, away.plate, away.laptop], ['', '', '']);

  const right = drawProps({ card: 1, laptop: 1 }, mouth, 0, { wide: 1, tall: 1 });
  assert.ok(right.stick.startsWith('M354.0,-388.0L'));
  assert.ok(right.score.x > mouth.x && right.score.y < mouth.y, 'up and ahead of his mouth');
  assert.ok(right.laptop.startsWith('M283.0,'), 'the base starts by his forepaws');

  const left = drawProps({ card: 1, laptop: 1 }, { x: -354, y: -388 }, 0, { wide: -1, tall: 1 });
  assert.ok(left.score.x < -354, 'ahead of him, now to the left');
  assert.equal(left.score.squeeze, 1, 'the numerals keep their own way round');
  assert.equal(left.score.tilt, -right.score.tilt);
});
