import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Heist, type Home, type Place, type Plan, type Point, type Thief } from './heist.ts';
import type { Ground } from './mind.ts';

const ground: Ground = { left: 40, right: 1160, size: 80 };
/** Under his ground, as the countdown is under the band. */
const home: Home = { x: 600, y: -300, tall: 40 };
const DT = 1 / 60;
/** His full run, in pixels a second. */
const TOP = 5.6 * ground.size;

/**
 * A dog that does as a plan says, as simply as can be: he goes where he is
 * sent at the pace he is given, faces the way he is told, and hops on the
 * spot. His mouth is ahead of his middle, as in the drawing.
 */
class Dog implements Thief {
  x: number;
  pace = 0;
  facing = 1;
  /** Time left in the air. */
  air = 0;
  hops = 0;
  /** What he was last told to do. */
  told: Plan | null = null;

  constructor(x: number, facing = 1) {
    this.x = x;
    this.facing = facing;
  }

  get settled(): boolean {
    return this.air <= 0 && Math.abs(this.pace) < 0.1;
  }

  get mouth(): Point {
    return { x: this.x + this.facing * 0.51 * ground.size, y: 0.56 * ground.size };
  }

  obey(plan: Plan): void {
    this.told = plan;
    const gap = Math.min(ground.right, Math.max(ground.left, plan.goal)) - this.x;
    const speed = Math.sign(gap) * Math.min(TOP * plan.pace, Math.abs(gap) * 9);
    this.x += speed * DT;
    this.pace = speed / TOP;
    if (Math.abs(this.pace) > 0.04) this.facing = Math.sign(speed);
    else if (plan.face !== 0) this.facing = plan.face;
    else if (plan.eye && Math.abs(plan.eye.x - this.x) > 0.45 * ground.size) {
      this.facing = plan.eye.x > this.x ? 1 : -1;
    }
    this.air = Math.max(0, this.air - DT);
    if (plan.hop > 0 && this.air <= 0) {
      this.air = 0.2;
      this.hops += 1;
    }
  }
}

interface Moment {
  t: number;
  dog: { x: number; facing: number; mouth: Point };
  plan: Plan;
  /** Where the thing was; null once it was home. */
  place: Place | null;
}

/**
 * Plays a theft out for up to `seconds`, with the pointer wherever `pointer`
 * says, and returns every frame up to and including the one it ended on.
 */
function play(
  heist: Heist,
  dog: Dog,
  pointer: (dog: Dog, t: number) => Point | null,
  seconds: number,
  each?: (moment: Moment) => void,
): Moment[] {
  const moments: Moment[] = [];
  for (let i = 0; i < Math.round(seconds / DT) && heist.on; i++) {
    const t = i * DT;
    const plan = { ...heist.step(DT, dog, pointer(dog, t), ground) };
    dog.obey(plan);
    const place = heist.place(dog.mouth, dog.facing);
    const moment = {
      t,
      dog: { x: dog.x, facing: dog.facing, mouth: dog.mouth },
      plan,
      place: place && { ...place },
    };
    moments.push(moment);
    each?.(moment);
  }
  return moments;
}

const nobody = (): null => null;
/** Out of the way: far above the middle of his ground, near nothing. */
const elsewhere = (): Point => ({ x: 600, y: 900 });

/** True when the thing is where he would hold it: just ahead of his mouth. */
const inMouth = (m: Moment): boolean =>
  m.place !== null &&
  Math.hypot(m.place.x - (m.dog.mouth.x + m.dog.facing * 0.36 * home.tall), m.place.y - (m.dog.mouth.y + 0.1 * home.tall)) < 1.5;

/** The frame on which it came to rest on his ground. */
function atRest(moments: Moment[]): Moment {
  const rest = moments.find(
    (m, i) => i > 0 && m.place !== null && m.place.y === home.tall / 2 && moments[i - 1]!.place!.y === m.place.y,
  );
  assert.ok(rest, 'it came to rest on his ground');
  return rest;
}

test('knocked loose, it starts from exactly where it belongs', () => {
  const heist = new Heist();
  assert.equal(heist.on, false);
  assert.equal(heist.place({ x: 0, y: 0 }, 1), null);
  assert.equal(heist.begin(home, { x: 600, facing: 1 }, ground), true);
  assert.equal(heist.on, true);
  assert.deepEqual(heist.place({ x: 0, y: 0 }, 1), { x: 600, y: -300, turn: 0, flat: 1 });
  // One at a time.
  assert.equal(heist.begin(home, { x: 600, facing: 1 }, ground), false);
});

test('it comes up onto his ground beside him, never on him, wherever he stands', () => {
  for (const facing of [1, -1]) {
    for (const x of [40, 90, 300, 560, 600, 640, 700, 900, 1120, 1160]) {
      const heist = new Heist();
      const dog = new Dog(x, facing);
      heist.begin(home, dog, ground);
      const moments = play(heist, dog, nobody, 1.6);
      const rest = atRest(moments);
      const where = `with him at ${x} facing ${facing}`;
      assert.ok(rest.place!.x >= ground.left && rest.place!.x <= ground.right, `on his ground ${where}`);
      assert.equal(rest.place!.turn, 0, `the right way up ${where}`);
      // From the moment it comes up through his ground, no part of it is over any part of him.
      for (const m of moments) {
        if (m.place!.y < -home.tall / 2 || m.t > rest.t) continue;
        const apart = Math.abs(m.place!.x - m.dog.x) - home.tall / 2;
        assert.ok(apart > 0.6 * ground.size, `clear of him ${where}: ${apart}`);
      }
    }
  }
});

test('with him standing over it, it lands in front of his nose', () => {
  for (const facing of [1, -1]) {
    const heist = new Heist();
    const dog = new Dog(610, facing);
    heist.begin(home, dog, ground);
    const rest = atRest(play(heist, dog, nobody, 1.6));
    assert.equal(Math.sign(rest.place!.x - dog.x), facing);
    assert.ok(Math.abs(rest.place!.x - dog.x) < 3 * ground.size, 'and not far off');
  }
});

test('it flies as a thrown thing does: up from under his ground, over the top, and down', () => {
  const heist = new Heist();
  const dog = new Dog(200);
  heist.begin(home, dog, ground);
  const moments = play(heist, dog, nobody, 1.6);
  const rest = atRest(moments);
  const flight = moments.filter((m) => m.t < rest.t);
  const heights = flight.map((m) => m.place!.y);
  const top = Math.max(...heights);
  assert.ok(Math.abs(top - 1.05 * ground.size) < 1, `tops out a little over his height: ${top}`);
  // Rising all the way to the top, without a hitch.
  const peak = heights.indexOf(top);
  for (let i = 1; i <= peak; i++) assert.ok(heights[i]! > heights[i - 1]!);
  // It goes up fast and slows: quicker through the first tenth of a second than the last before the top.
  assert.ok(heights[6]! - heights[0]! > 2 * (heights[peak]! - heights[peak - 6]!));
  // Turning one whole turn the way it travels, so that it lands the right way up.
  const landing = flight.findIndex((m, i) => i > peak && m.place!.y <= home.tall / 2);
  const turns = flight.slice(0, landing).map((m) => m.place!.turn);
  for (let i = 1; i < turns.length; i++) assert.ok(turns[i]! < turns[i - 1]!, 'it turns one way only');
  assert.ok(Math.abs(turns[turns.length - 1]! + 360) < 12, 'a whole turn, leftward as it travels left');
  // Then one small bounce, and it is still.
  const bounce = Math.max(...flight.slice(landing).map((m) => m.place!.y)) - home.tall / 2;
  assert.ok(bounce > 5 && bounce < 0.2 * ground.size, `one small bounce: ${bounce}`);
  assert.ok(rest.t < 1.4, `at rest in ${rest.t}s`);
});

test('he starts when it lands, looks at it, then puts his nose down and has it', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  const moments = play(heist, dog, nobody, 3);
  const rest = atRest(moments);
  assert.equal(dog.hops >= 1, true, 'a hop as it lands');
  // Until it is at rest, and for a moment after, he stays where he is and watches it.
  for (const m of moments.filter((m) => m.t <= rest.t + 0.15)) {
    assert.equal(m.plan.nose, 0);
    assert.equal(m.plan.eye !== null, true);
    assert.ok(Math.abs(m.dog.x - 610) < 2, 'he has not gone for it yet');
  }
  const down = moments.find((m) => m.plan.nose === 1);
  assert.ok(down && down.t > rest.t + 0.19, 'then his nose goes down');
  // It lies just in front of his nose when it does, not under his feet.
  const nose = down.dog.x + 0.58 * ground.size;
  const nearSide = rest.place!.x - home.tall / 2;
  assert.ok(Math.abs(nearSide - nose) < 0.16 * ground.size, `its near side is ${nearSide - nose}px past his nose`);
  // And within half a second it is in his mouth, having come up from where it lay without a jump.
  const taken = moments.findIndex((m) => m.t > down.t && inMouth(m));
  assert.ok(taken > 0 && moments[taken]!.t - down.t < 0.5, 'it is in his mouth');
  for (let i = moments.indexOf(down); i <= taken; i++) {
    const a = moments[i - 1]!.place!;
    const b = moments[i]!.place!;
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 14, 'no jump on the way up');
  }
});

test('left to himself he makes off with it, bows to play, and then brings it home', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  const moments = play(heist, dog, nobody, 30);
  assert.equal(heist.on, false, 'it ended');
  const end = moments[moments.length - 1]!;
  assert.equal(end.place, null);
  assert.ok(end.t < 12, `in ${end.t}s`);

  const took = moments.find(inMouth)!;
  const far = Math.max(...moments.filter((m) => m.t > took.t).map((m) => Math.abs(m.dog.x - took.dog.x)));
  assert.ok(far > 3 * ground.size, `he made off with it: ${far}`);
  assert.ok(moments.some((m) => m.plan.pace > 1.2), 'at more than his full run');
  const bows = moments.filter((m) => m.plan.bow === 1 && inMouth(m));
  assert.ok(bows.length > 60, 'and bowed with it in his mouth');

  // He comes back to stand with his mouth over where it belongs, and throws it home.
  const thrown = moments.findLast((m) => inMouth(m))!;
  assert.ok(Math.abs(thrown.place!.x - home.x) < 0.12 * ground.size, 'from right above where it belongs');
  assert.ok(moments.some((m) => m.t > thrown.t && m.plan.nose === -1), 'with a toss of his head');
  // It arrives exactly, the right way up.
  const arriving = moments[moments.length - 2]!.place!;
  assert.ok(Math.hypot(arriving.x - home.x, arriving.y - home.y) < 30, 'arriving where it belongs');
  assert.ok(Math.abs(Math.abs(arriving.turn) - 360) < 15, 'having turned right over once');
  assert.equal(arriving.flat, 1);
});

test('thrown home, it arrives even at a home that has moved', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  let falling = false;
  let lastPlace: Place | null = null;
  play(heist, dog, nobody, 30, (m) => {
    if (m.plan.nose === -1 && !falling) {
      falling = true;
      // The page is resized under it.
      heist.belongs({ x: 520, y: -260, tall: 40 });
    }
    if (m.place) lastPlace = m.place;
  });
  assert.equal(heist.on, false);
  assert.ok(lastPlace !== null);
  const end = lastPlace as Place;
  assert.ok(Math.hypot(end.x - 520, end.y + 260) < 30, `it follows its home: ${end.x}, ${end.y}`);
});

/** A pointer that comes after him along his ground at a steady speed, in body heights a second. */
const chaser = (speed: number, from = 600) => {
  let x = from;
  return (dog: Dog): Point => {
    x += Math.sign(dog.x - x) * Math.min(Math.abs(dog.x - x), speed * ground.size * DT);
    return { x, y: 0.5 * ground.size };
  };
};

/** True while he stands off with the thing in his mouth, bowing to play. */
const teasing = (plan: Plan | null): boolean => plan !== null && plan.bow > 0 && plan.nose === 0;

/** The frames on which he set off at a dash. */
const dashes = (moments: Moment[]): number[] =>
  moments.flatMap((m, i) => (i > 0 && m.plan.pace > 1.2 && moments[i - 1]!.plan.pace <= 1.2 ? [i] : []));

test('crept up on, he bolts each time from nearer, and in the end lets himself be caught', () => {
  const heist = new Heist();
  const dog = new Dog(200);
  heist.begin({ x: 200, y: -300, tall: 40 }, dog, ground);
  // A pointer that keeps still while he runs, and creeps toward him while he stands and bows.
  let x = -120;
  const seen: number[] = [];
  const moments = play(
    heist,
    dog,
    (d) => {
      if (teasing(d.told)) x += Math.sign(d.x - x) * Math.min(Math.abs(d.x - x), 2.5 * ground.size * DT);
      seen.push(x);
      return { x, y: 0.5 * ground.size };
    },
    30,
  );
  assert.equal(heist.on, false);

  // The dash he makes off with, and then three that he is made to make.
  const starts = dashes(moments);
  assert.equal(starts.length, 4, `four dashes: ${starts.length}`);
  // How near the pointer had come, the frame before he went.
  const nearness = starts
    .slice(1)
    .map((i) => Math.abs(seen[i - 1]! - moments[i - 1]!.dog.x) / ground.size);
  for (const [i, shy] of [2.6, 2.0, 1.4].entries()) {
    assert.ok(nearness[i]! < shy && nearness[i]! > shy - 0.3, `bolt ${i + 1} from ${nearness[i]} heights off`);
  }
  // After the third he stands his ground, the pointer comes right up to him, and he gives it up.
  const reached = moments.findIndex(
    (m, i) => i > starts[3]! && Math.abs(seen[i]! - m.dog.x) < 0.5 * ground.size,
  );
  assert.ok(reached > 0, 'the pointer reached him');
  assert.ok(inMouth(moments[reached]!), 'with it still in his mouth');
  const gaveUp = moments.find((m, i) => i > reached && m.plan.nose === -1);
  assert.ok(gaveUp && gaveUp.t - moments[reached]!.t < 4, 'and he took it back');
});

test('a pointer that is on him wherever he goes still gets three dashes, with a bow between each', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  const moments = play(heist, dog, (d) => ({ x: d.x, y: 0.5 * ground.size }), 30);
  assert.equal(heist.on, false);
  // Each dash, and how long he stood before the next.
  const starts = dashes(moments).map((i) => moments[i]!);
  const stops = moments.filter((m, i) => i > 0 && m.plan.pace <= 1.2 && moments[i - 1]!.plan.pace > 1.2);
  assert.equal(starts.length, 4, 'the dash he makes off with, and three more');
  for (let i = 1; i < starts.length; i++) {
    const stood = starts[i]!.t - stops[i - 1]!.t;
    assert.ok(stood > 0.28 && stood < 0.5, `he pulled up for ${stood}s before dash ${i + 1}`);
  }
  // Then he stands his ground, and with the pointer on him gives it up at once.
  const gaveUp = moments.find((m) => m.t > stops[3]!.t && m.plan.face !== 0 && m.plan.bow === 0);
  assert.ok(gaveUp && gaveUp.t - stops[3]!.t < 0.5, 'caught as soon as he stops');
  assert.ok(moments[moments.length - 1]!.t < 9, 'and the whole thing is over in seconds');
});

test('cornered at the end of his ground, he doubles back past whoever is after him', () => {
  const heist = new Heist();
  const dog = new Dog(900);
  heist.begin({ x: 900, y: -300, tall: 40 }, dog, ground);
  // A pointer that keeps close on his left drives him to the right-hand end of his ground.
  const seen: number[] = [];
  const moments = play(
    heist,
    dog,
    (d) => {
      seen.push(d.x - 1.2 * ground.size);
      return { x: d.x - 1.2 * ground.size, y: 40 };
    },
    30,
  );
  const starts = dashes(moments);
  const back = starts.find((i) => moments[i]!.plan.goal < moments[i]!.dog.x);
  assert.ok(back !== undefined, 'one of his dashes was to the left, toward the pointer');
  const from = moments[back]!.dog.x;
  assert.ok(ground.right - from < 1.6 * ground.size, `with no room left to run on: he was at ${from}`);
  const to = moments[back]!.plan.goal;
  assert.ok(to < seen[back]! - ground.size, `and it took him past the pointer at ${seen[back]} to ${to}`);
});

test('a pointer waiting where the thing belongs calls him back sooner', () => {
  const lasted = (pointer: () => Point | null): number => {
    const heist = new Heist();
    const dog = new Dog(610);
    heist.begin(home, dog, ground);
    const moments = play(heist, dog, pointer, 30);
    assert.equal(heist.on, false);
    return moments[moments.length - 1]!.t;
  };
  const called = lasted(() => ({ x: home.x + 10, y: home.y }));
  const ignored = lasted(elsewhere);
  assert.ok(called < ignored - 1, `called back in ${called}s, left alone ${ignored}s`);
  assert.ok(called > 4, 'but not before he has made off with it and bowed');
});

test('a press on him while he has it catches him: he starts, and takes it back', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  assert.equal(heist.caught(), false, 'nothing to be caught with yet');
  let hops = 0;
  let pressedAt = -1;
  const moments = play(heist, dog, elsewhere, 30, (m) => {
    if (pressedAt < 0 && inMouth(m) && m.plan.pace > 1.2) {
      // Caught on the run.
      hops = dog.hops;
      assert.equal(heist.caught(), true);
      pressedAt = m.t;
    }
  });
  assert.ok(pressedAt > 0);
  assert.equal(heist.on, false);
  assert.ok(dog.hops > hops, 'he starts');
  const end = moments[moments.length - 1]!.t;
  assert.ok(end - pressedAt < 3.5, `it is home ${end - pressedAt}s after the press`);
  // He bolts no more once caught.
  assert.equal(moments.some((m) => m.t > pressedAt + 0.05 && m.plan.pace > 1.2), false);
});

test('however he is chased, it is home again within a quarter of a minute', () => {
  // A pointer that is always right behind him; one that jumps about at random; one that never moves.
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pointers: ((dog: Dog, t: number) => Point | null)[] = [
    (dog) => ({ x: dog.x - dog.facing * 1.5 * ground.size, y: 40 }),
    (dog) => ({ x: dog.x + 30, y: 40 }),
    () => ({ x: random() * 1200, y: random() * 600 - 300 }),
    chaser(9),
    chaser(1),
    () => ({ x: 1160, y: 0 }),
  ];
  for (const [i, pointer] of pointers.entries()) {
    for (const start of [40, 610, 1160]) {
      const heist = new Heist();
      const dog = new Dog(start);
      heist.begin(home, dog, ground);
      const moments = play(heist, dog, pointer, 40);
      assert.equal(heist.on, false, `pointer ${i} from ${start}: it ended`);
      const end = moments[moments.length - 1]!.t;
      assert.ok(end < 15, `pointer ${i} from ${start}: home in ${end}s`);
      for (const m of moments) {
        assert.ok(m.plan.goal >= ground.left - 1e-9 && m.plan.goal <= ground.right + 1e-9 || m.plan.goal === m.dog.x);
        if (m.place && m.place.y >= 0) assert.ok(m.place.x > 0 && m.place.x < 1200, 'it stays over his ground');
      }
    }
  }
});

test('if he never comes for it, or never gets back, it does not wait for ever', () => {
  const heist = new Heist();
  // A dog who will not move: asleep on his feet at the far end.
  const dog = new Dog(1160);
  heist.begin(home, dog, ground);
  let t = 0;
  for (; t < 40 && heist.on; t += DT) {
    heist.step(DT, { x: 1160, pace: 0, facing: 1, settled: false }, null, ground);
    heist.place(dog.mouth, 1);
  }
  assert.equal(heist.on, false);
  assert.ok(t < 28, `home in ${t}s all the same`);
});

test('in his mouth it goes where his mouth goes, tipped back, and turns round with him', () => {
  const heist = new Heist();
  const dog = new Dog(610);
  heist.begin(home, dog, ground);
  play(heist, dog, nobody, 30, (m) => {
    if (!inMouth(m) || m.plan.pace > 1.2 || Math.abs(m.dog.x - 610) < 200) return;
    // Standing off with it: try his mouth in other places, facing other ways.
    const right = { ...heist.place({ x: 500, y: 50 }, 1)! };
    const left = { ...heist.place({ x: 500, y: 50 }, -1)! };
    const turning = { ...heist.place({ x: 500, y: 50 }, 0.25)! };
    assert.ok(right.x > 500 && left.x < 500, 'ahead of his mouth, whichever way he faces');
    assert.ok(Math.abs(right.x - 500 - (500 - left.x)) < 1e-3, 'the same on both sides');
    assert.ok(right.turn < -5 && left.turn > 5, 'its top tipped back toward him');
    assert.equal(right.flat, 1);
    assert.equal(turning.flat, 0.25);
    heist.place(m.dog.mouth, m.dog.facing);
  });
});
