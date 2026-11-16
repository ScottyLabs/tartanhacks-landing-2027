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

/* ---------- Bedtime ---------- */

/**
 * Runs Bark while the visitor does nothing: `from` seconds idle already, and
 * a frame's worth more with every frame.
 */
function idle(mind: Mind, seconds: number, from: number, night = false): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    mind.rest(from + i / 60, night);
    frames.push(mind.step(1 / 60, ground));
  }
  return frames;
}

/** Bark standing at 400, left alone until he is sound asleep. */
function asleep(): Mind {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  idle(mind, 12, 58);
  return mind;
}

const snoring = (frame: Frame): number => frame.snores.length;

test('left alone for a minute he yawns, turns about, lies down and sleeps', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);

  // For most of a minute he is the mark, standing.
  for (const f of idle(mind, 59.5, 0)) {
    assert.ok(Math.abs(f.lift) < 0.01 && Math.abs(f.pitch) < 0.001, 'standing');
    assert.equal(f.asleep, false);
    assert.equal(snoring(f), 0);
    assert.ok(Math.abs(f.pose.beard) < 0.05, 'mouth shut');
  }

  // Then he goes to bed.
  const bedtime = idle(mind, 6, 59.5);
  const lay = bedtime.findIndex((f) => f.lift < -0.02 * ground.size);
  assert.ok(lay > 0, 'he lies down');
  const before = bedtime.slice(0, lay);
  assert.ok(before.some((f) => f.pose.beard > 0.35 && f.pose.head < -0.1), 'a yawn first: jaw down, head back');
  const about = before.findIndex((f) => f.facing === -1);
  assert.ok(about > 0, 'then a turn about');
  assert.ok(before.slice(about).some((f) => f.facing === 1), 'and back, before he lies down');

  const down = last(bedtime);
  assert.equal(down.asleep, true);
  assert.ok(down.pitch > 0.2 && down.pitch < 0.3, `onto his chest: ${down.pitch}`);
  assert.ok(down.lift < -0.2 * ground.size, 'and down');
  assert.ok(Math.abs(down.x - 400) < 1, 'where he stood');
  assert.equal(down.facing, 1, 'facing as he was');
});

test('lying down, the mark goes down whole: only where his head rests changes', () => {
  const mind = asleep();
  const f = last(idle(mind, 1, 70));
  // His legs are as they are in the mark, out of sight under him; his head
  // is the mark's head, set down a little and barely turned.
  assert.ok(Math.abs(f.pose.hindReach) < 1 && Math.abs(f.pose.foreReach) < 1);
  assert.ok(f.pose.hindLift < 1 && f.pose.foreLift < 1);
  assert.ok(Math.abs(f.pose.head) < 0.1, `head turned ${f.pose.head}`);
  assert.ok(f.pose.headDown > 0 && f.pose.headDown < 40);
  assert.ok(Math.abs(f.pose.beard) < 0.1, 'mouth shut');
  // His ear lies back a little; it twitches now and then as he dreams.
  assert.ok(f.pose.ear < 0.05 && f.pose.ear > -0.5, `ear at ${f.pose.ear}`);
  assert.equal(f.props.card, 0);
});

test('asleep he breathes slowly and snores a string of Zs that grow as they rise', () => {
  const mind = asleep();
  const frames = idle(mind, 9, 70);
  const swell = frames.map((f) => f.squash);
  assert.ok(Math.min(...swell) > 0.94 && Math.max(...swell) < 1.06, 'gently');
  assert.ok(Math.max(...swell) - Math.min(...swell) > 0.03, 'but visibly');
  assert.ok(frames.every((f) => f.asleep));
  assert.ok(frames.some((f) => snoring(f) >= 2), 'more than one in the air at once');
  assert.ok(frames.every((f) => snoring(f) <= 3));
  for (const f of frames) {
    for (const s of f.snores) {
      // Above his head, and with all of the letter within his own standing height.
      assert.ok(s.y > 0.55 * ground.size && s.y + s.size * 0.4 < ground.size, `at ${s.y}, ${s.size} tall`);
      assert.ok(s.x > 400, 'ahead of him');
      assert.ok(s.size >= 0 && s.size < 0.3 * ground.size);
    }
    // Of two in the air, the higher is the bigger, until it shrinks away at the very top.
    for (const low of f.snores) {
      for (const high of f.snores) {
        if (high.y - low.y > 0.1 * ground.size && high.y < 0.895 * ground.size) {
          assert.ok(high.size > low.size, 'growing as they rise');
        }
      }
    }
  }
  // They rise: from one frame to the next, the lowest one in the air is
  // never lower, except when a new one has just left him.
  let lowest = Infinity;
  let count = 0;
  for (const f of frames) {
    const now = Math.min(Infinity, ...f.snores.map((s) => s.y));
    if (f.snores.length <= count && now !== Infinity) assert.ok(now >= lowest - 1e-6, 'rising');
    lowest = now;
    count = f.snores.length;
  }
});

test('anything the visitor does wakes him with a start', () => {
  const mind = asleep();
  const sleeping = last(idle(mind, 3, 70));
  assert.ok(snoring(sleeping) > 0);

  mind.watch({ x: 800, y: 0 });
  const waking = idle(mind, 1.2, 0);
  assert.equal(waking[0]!.asleep, false, 'awake at once');
  assert.ok(waking.slice(15).every((f) => snoring(f) === 0), 'his snores burst');
  assert.ok(waking[2]!.snores.every((s) => s.size < 0.1 * ground.size), 'shrinking away at once');
  const hop = Math.max(...waking.map((f) => f.lift));
  assert.ok(hop > 0.1 * ground.size && hop < 0.4 * ground.size, `a hop to his feet: ${hop}`);
  assert.ok(waking.slice(0, 6).every((f) => Math.abs(f.x - 400) < 1), 'he is up before he sets off');

  // Then he is himself: after the pointer, and standing as the mark.
  const end = last(idle(mind, 4, 1.2));
  assert.ok(Math.abs(end.x - 800) < ground.size * 0.2);
  assert.ok(Math.abs(end.lift) < 0.5 && Math.abs(end.pitch) < 0.005);
  assert.ok(Math.abs(end.pose.headDown) < 0.01 && Math.abs(end.pose.headOut) < 0.01);
  assert.ok(Math.abs(end.pose.head) < 0.06, 'his head as the mark has it');
  assert.equal(end.asleep, false);
});

test('a press wakes him rather than making him jump', () => {
  const mind = asleep();
  mind.jump();
  const waking = idle(mind, 1.5, 0);
  assert.equal(waking[0]!.asleep, false);
  const peak = Math.max(...waking.map((f) => f.lift));
  assert.ok(peak < 0.5 * ground.size, `a start, not a full jump: ${peak}`);
  assert.ok(Math.abs(last(waking).lift) < 0.5);
});

test('in the small hours he goes to bed after a quarter of a minute', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  assert.ok(idle(mind, 14.5, 0, true).every((f) => !f.asleep && Math.abs(f.lift) < 0.01));
  assert.equal(last(idle(mind, 6, 14.5, true)).asleep, true);

  // By day the same wait leaves him standing.
  const day = new Mind(400);
  day.watch({ x: 400, y: 0 });
  run(day, 0.5);
  assert.ok(idle(day, 21, 0).every((f) => !f.asleep && Math.abs(f.lift) < 0.01));
});

test('a visitor long gone comes back to find him already asleep', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  // The page was hidden for ten minutes; this is the first frame back.
  const back = idle(mind, 2, 600);
  assert.equal(back[0]!.asleep, true, 'no yawning and turning for nobody to see');
  assert.ok(back.every((f) => Math.abs(f.pose.beard) < 0.1 && f.facing === 1));
  assert.ok(back.some((f) => snoring(f) > 0), 'and he is snoring');
  assert.equal(mind.calm, true);
  assert.equal(mind.resting, false);
});

test('stirring while he yawns or turns about just leaves him up', () => {
  for (const until of [60.6, 61.6]) {
    const mind = new Mind(400);
    mind.watch({ x: 400, y: 0 });
    run(mind, 0.5);
    idle(mind, until - 59, 59);
    const after = idle(mind, 2, 0);
    assert.ok(after.every((f) => f.lift > -0.01 * ground.size && !f.asleep), 'he never lies down');
    const end = last(after);
    assert.equal(end.facing, 1, 'facing as he was');
    assert.ok(Math.abs(end.pose.beard) < 0.05 && Math.abs(end.pose.head) < 0.05, 'as the mark');
  }
});

test('dressed for a part, he puts it away to sleep and takes it up again on waking', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  mind.dress('judge');
  run(mind, 1.5);
  const down = last(idle(mind, 8, 58));
  assert.equal(down.asleep, true);
  assert.equal(down.props.card, 0);
  const up = last(idle(mind, 2.5, 0));
  assert.ok(up.props.card > 0.95, 'the card is up again');
});

test('asleep or going to bed he never strays far from the mark', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  const frames = [...idle(mind, 20, 55), ...idle(mind, 3, 0)];
  for (const f of frames) {
    assert.ok(f.squash >= 0.7 && f.squash <= 1.2);
    assert.ok(f.pitch > -0.2 && f.pitch < 0.3, `pitch ${f.pitch}`);
    assert.ok(Math.abs(f.pose.head) < 0.35 && Math.abs(f.pose.ear) < 0.9);
    assert.ok(f.pose.beard < 0.7);
    assert.ok(f.lift > -0.35 * ground.size, `lift ${f.lift}`);
  }
});

/* ---------- The zoomies and the backflip ---------- */

/** How fast he is going in each frame, in pixels a second, and how often he turned back. */
function dashes(frames: Frame[]): { fastest: number; turns: number } {
  let fastest = 0;
  let turns = 0;
  let way = 0;
  for (let i = 1; i < frames.length; i++) {
    const moved = frames[i]!.x - frames[i - 1]!.x;
    fastest = Math.max(fastest, Math.abs(moved) * 60);
    if (Math.abs(moved) * 60 < 1.5 * ground.size) continue;
    const now = Math.sign(moved);
    if (way !== 0 && now !== way) turns += 1;
    way = now;
  }
  return { fastest, turns };
}

test('given the zoomies he tears back and forth past where he stood, and stops', () => {
  const mind = new Mind(500);
  mind.watch({ x: 500, y: 0 });
  run(mind, 0.5);
  mind.zoom();
  // The pointer goes off to one side meanwhile: he has no time for it.
  mind.watch({ x: 900, y: 0 });
  const frames = run(mind, 2.8);
  assert.equal(mind.resting, false);

  const { fastest, turns } = dashes(frames);
  const fullRun = 5.6 * ground.size;
  assert.ok(fastest > 1.4 * fullRun && fastest < 2 * fullRun, `faster than he ever runs: ${fastest / fullRun} of a full run`);
  assert.ok(turns >= 3, `back and forth: ${turns} turns`);
  const xs = frames.map((f) => f.x);
  assert.ok(Math.max(...xs) > 500 + 2 * ground.size && Math.min(...xs) < 500 - 1.5 * ground.size, 'either side of where he stood');
  // All of it over in a couple of seconds.
  const hop = frames.findIndex((f) => f.lift > 0.1 * ground.size);
  assert.ok(hop > 0 && hop / 60 < 2.6, `done in ${hop / 60} seconds`);
  assert.ok(Math.min(...xs) < 500 - ground.size, 'away from the pointer too');
  for (const f of frames) {
    assert.ok(f.x >= ground.left - 1 && f.x <= ground.right + 1);
    assert.ok(f.squash >= 0.7 && f.squash <= 1.2);
    assert.ok(Math.abs(f.pitch) < 0.2);
    // On the ground his legs reach no further than at a full run: they go quicker instead.
    if (f.lift < 0.5) assert.ok(Math.abs(f.pose.hindReach) < 70 && Math.abs(f.pose.foreReach) < 70);
    assert.ok(f.lift < 0.3 * ground.size, 'no more than a hop');
  }
  assert.ok(Math.max(...frames.map((f) => f.lift)) > 0.1 * ground.size, 'they end with a hop');

  // Then he is himself: after the pointer, and standing as the mark.
  const end = last(run(mind, 4));
  assert.ok(Math.abs(end.x - 900) < ground.size * 0.2);
  assert.ok(Math.abs(end.lift) < 0.5 && Math.abs(end.pitch) < 0.005);
  assert.ok(Math.abs(end.pose.hindReach) < 1 && Math.abs(end.pose.foreReach) < 1);
});

test('at the edge of his ground the zoomies turn back where the ground ends', () => {
  const mind = new Mind(900);
  mind.watch({ x: 900, y: 0 });
  run(mind, 0.5);
  mind.zoom();
  const frames = run(mind, 3.5);
  assert.ok(frames.every((f) => f.x <= ground.right + 1 && f.x >= ground.left - 1));
  assert.ok(dashes(frames).turns >= 2);
  assert.ok(Math.abs(last(frames).x - 900) < ground.size * 0.2, 'and he ends where the pointer is');
});

test('dressed for a part, or in bed, he does not get the zoomies', () => {
  const judge = new Mind(500);
  judge.watch({ x: 500, y: 0 });
  judge.dress('judge');
  run(judge, 1.5);
  judge.zoom();
  const dressed = run(judge, 1.5);
  assert.ok(dressed.every((f) => Math.abs(f.x - 500) < 2 && f.props.card > 0.9));

  const sleeper = asleep();
  sleeper.zoom();
  assert.ok(idle(sleeper, 1.5, 70).every((f) => f.asleep && Math.abs(f.x - 400) < 1));
});

/** Presses Bark a number of times, so many seconds apart, and returns every frame until he is done. */
function pressed(mind: Mind, times: number, apart: number, then = 3): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < times; i++) {
    mind.jump();
    frames.push(...run(mind, apart));
  }
  frames.push(...run(mind, then));
  return frames;
}

test('five quick presses earn a backflip: right over backwards, higher than a jump', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  const frames = pressed(mind, 5, 0.13);

  const over = frames.filter((f) => f.pitch < -0.5);
  assert.ok(over.length > 10, 'he goes over');
  assert.ok(Math.min(...over.map((f) => f.pitch)) < -6, 'all the way round');
  // Backwards the whole way: the turn only ever grows, until he lands.
  for (let i = 1; i < over.length; i++) assert.ok(over[i]!.pitch <= over[i - 1]!.pitch + 1e-9);
  const height = Math.max(...over.map((f) => f.lift)) / ground.size;
  assert.ok(height > 1.2 && height < 1.5, `higher than a jump: ${height} of his height`);
  // Upside down, every part of him is clear of the ground.
  for (const f of over) {
    if (f.pitch < -2.2 && f.pitch > -4.1) assert.ok(f.lift > 0.5 * ground.size, `upside down at ${f.lift}`);
  }
  // Once only.
  let flips = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.pitch < -Math.PI && frames[i - 1]!.pitch >= -Math.PI) flips += 1;
  }
  assert.equal(flips, 1);

  const end = last(frames);
  assert.ok(Math.abs(end.lift) < 0.5 && Math.abs(end.pitch) < 0.005, 'on his feet, upright');
  assert.ok(Math.abs(end.x - 400) < 2, 'where he stood');
  assert.ok(Math.abs(end.squash - 1) < 0.03);
});

test('four quick presses, or five slow ones, are only jumps', () => {
  for (const [times, apart] of [
    [4, 0.13],
    [5, 0.7],
    [9, 0.7],
  ] as const) {
    const mind = new Mind(400);
    mind.watch({ x: 400, y: 0 });
    run(mind, 0.5);
    const frames = pressed(mind, times, apart);
    assert.ok(frames.every((f) => Math.abs(f.pitch) < 0.2), `${times} presses ${apart}s apart`);
    assert.ok(Math.max(...frames.map((f) => f.lift)) < 1.25 * ground.size);
  }
});

test('pressed five times as he sleeps, he wakes and then flips', () => {
  const mind = asleep();
  const frames: Frame[] = [];
  for (let i = 0; i < 5; i++) {
    mind.jump();
    frames.push(...idle(mind, 0.12, 0));
  }
  frames.push(...idle(mind, 3, 0.6));
  assert.equal(frames[0]!.asleep, false);
  assert.ok(Math.min(...frames.map((f) => f.pitch)) < -6, 'over he goes');
  const end = last(frames);
  assert.ok(Math.abs(end.lift) < 0.5 && Math.abs(end.pitch) < 0.005);
});

/* ---------- Keeping watch, and barking ---------- */

test('set to guard something under his ground, he stands over it and looks down at it', () => {
  const mind = new Mind(200);
  mind.watch({ x: 200, y: 0 });
  run(mind, 0.5);
  // Something well below the ground, off to his right. The pointer is there too, lower still.
  mind.watch({ x: 620, y: -200 });
  mind.guard({ x: 600, y: -210 });
  const watching = last(run(mind, 3));
  assert.ok(Math.abs(watching.x - 600) < ground.size * 0.2, `over it, at ${watching.x}`);
  assert.ok(watching.pose.head > 0.15 && watching.pose.head < 0.35, `looking down: ${watching.pose.head}`);
  assert.ok(watching.barkAim < 0, 'and that is where a bark would go');
  assert.equal(mind.resting, false);

  // Let be, he looks up again and is the mark.
  mind.guard(null);
  mind.watch({ x: 600, y: 0 });
  const after = last(run(mind, 2));
  assert.ok(Math.abs(after.pose.head) < 0.06);
  assert.ok(after.barkAim > 0);
});

test('he barks as many times as he is asked, the first with a start', () => {
  const mind = new Mind(400);
  mind.watch({ x: 400, y: 0 });
  run(mind, 0.5);
  mind.bark(2);
  const frames = run(mind, 2);
  // Each bark begins at full voice and dies away.
  let barks = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.bark > frames[i - 1]!.bark) barks += 1;
  }
  assert.equal(barks + (frames[0]!.bark === 1 ? 1 : 0), 2);
  assert.equal(frames[0]!.bark, 1, 'at once');
  assert.ok(frames.every((f) => f.bark >= 0 && f.bark <= 1));
  const hop = Math.max(...frames.map((f) => f.lift));
  assert.ok(hop > 0.08 * ground.size && hop < 0.3 * ground.size, `a start: ${hop}`);
  assert.ok(frames.some((f) => f.pose.head < -0.05), 'his head goes back with it');
  const end = last(frames);
  assert.equal(end.bark, 0);
  assert.ok(Math.abs(end.lift) < 0.5 && Math.abs(end.x - 400) < 2);
});

test('asleep, he wakes to bark', () => {
  const mind = asleep();
  mind.bark(1);
  const frames = idle(mind, 1.5, 0);
  assert.equal(frames[0]!.asleep, false);
  assert.ok(frames.some((f) => f.bark === 1));
});
