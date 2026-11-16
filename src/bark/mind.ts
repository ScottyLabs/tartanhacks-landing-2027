import { REST, type Pose } from './pose.ts';

/**
 * How Bark behaves: he follows the pointer along the ground, turns to face
 * it, trots or runs depending on how far behind he is, and jumps when
 * pressed. Left alone long enough he lies down and sleeps; wound up, he gets
 * the zoomies; pressed over and over, he turns a backflip. This file knows
 * nothing about the page; it turns time and a pointer position into a pose
 * to draw, which keeps it testable.
 *
 * Distances are in CSS pixels unless they are part of a Pose.
 */

/** Where Bark may stand, and how big he is. */
export interface Ground {
  /** The range his middle may reach. */
  left: number;
  right: number;
  /** His height, ground to ear tip. Speeds and jumps scale with it. */
  size: number;
}

/** A part Bark can dress for. */
export type Role = 'judge' | 'hacker';

/** What he has with him, each from 0 (put away) to 1 (fully out). */
export interface Props {
  /** A judge's scorecard, held up in his mouth. */
  card: number;
  /** A laptop, open on the ground in front of him. */
  laptop: number;
}

/** One snore, drawn as a letter that drifts up from his head. */
export interface Snore {
  /** Its middle: along the ground, and above it. */
  x: number;
  y: number;
  /** Its height in pixels. */
  size: number;
  /** Its lean, in degrees. */
  tilt: number;
}

/** What to draw for one frame. */
export interface Frame {
  /** His middle, along the ground. */
  x: number;
  /** How far his soles are above the ground. Below zero he has sunk onto his chest to sleep. */
  lift: number;
  /** 1 facing right, -1 facing left, in between while he turns round. */
  facing: number;
  /** Vertical stretch of the whole body; 1 at rest. Width makes up for it. */
  squash: number;
  /** Lean of the whole body in radians; positive tips the nose down. */
  pitch: number;
  pose: Pose;
  props: Props;
  /** True while he is lying asleep. */
  asleep: boolean;
  /** The snores now in the air: none, or a few. */
  snores: readonly Snore[];
}

const TAU = Math.PI * 2;

/** Body heights per second at a full run. */
const TOP_SPEED = 5.6;
/** He stops once the pointer is this close to his middle, in body heights. */
const STOP_WITHIN = 0.16;
/** Time spent gathering before a jump. */
const CROUCH_S = 0.1;
/** How high he jumps, in body heights, and how long the way up takes. */
const JUMP_HEIGHT = 1.12;
const JUMP_RISE_S = 0.27;
const GRAVITY = (2 * JUMP_HEIGHT) / JUMP_RISE_S ** 2;
const LAUNCH = GRAVITY * JUMP_RISE_S;

/** His whole body leans about a point this far up his height. */
export const LEAN_ABOUT = 0.35;
/** From the drawing: how far his hind soles are behind his middle, in body heights. */
const HIND_BEHIND = 0.475;

/* ---------- Bedtime. Times are in seconds, distances in body heights. ---------- */

/** Left alone this long he goes to bed; in the small hours, much sooner. */
const BEDTIME_S = 60;
const BEDTIME_AT_NIGHT_S = 15;
/** Left alone this much longer still, he is found already asleep. */
const LONG_GONE_S = 20;
/** Going to bed: a yawn, a turn about on the spot and back, and then down. */
const YAWN_S = 1.3;
const TURN_S = 0.42;
/**
 * Lying down. He tips forward onto his chest, by this many radians, his hind
 * feet staying where they are; then his hips come down by this much. Nothing
 * of the drawing changes shape: the mark lies down whole.
 */
const LIE_TILT = 0.27;
const HIPS_DOWN = 0.15;
/** His head settles onto the ground by this much, in the mark's units: down, out ahead, and turned. */
const HEAD_DOWN = 20;
const HEAD_OUT = 30;
const HEAD_TURN = 0.04;
/** Asleep his ear lies back a little, by this many radians. */
const EAR_BACK = 0.2;
/** One breath in and out, and how much his body swells with it. */
const BREATH_S = 4.2;
const BREATH = 0.045;
/** He snores this many times to a breath; each snore lasts this long, so a few are in the air at once. */
const SNORES_A_BREATH = 3;
const SNORE_S = 3.4;
const SNORES = 3;
/** Startled awake, he is on his feet with a hop this high. */
const STARTLE = 0.2;

/** What a frame carries when he is not snoring: the same empty list every time. */
const NO_SNORES: Snore[] = [];

/* ---------- The zoomies and the backflip. Distances are in body heights. ---------- */

/** With the zoomies he runs this many times as fast as his full run. */
const ZOOM = 1.7;
/**
 * He tears back and forth past where he stood: out this far one way, back
 * past it the other, and so on, ending where he began.
 */
const ZOOM_RUNS = [2.6, -2.2, 2.4, -1.8, 0];
/** A run that has not got there in this long is given up: he has met the edge of his ground. */
const ZOOM_RUN_S = 1.1;
/** They end with a hop this high. */
const HAPPY_HOP = 0.22;
/** This many presses, each within this long of the last, earn a backflip. */
const PRESSES = 5;
const QUICK_S = 0.5;
/** The backflip: he gathers longer, goes higher, and turns right over backwards. */
const FLIP_CROUCH_S = 0.16;
const FLIP_HEIGHT = 1.35;

const smooth01 = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
/** The fraction of the way to a target to move in `dt`, settling in about `time` seconds. */
const toward = (dt: number, time: number): number => 1 - Math.exp(-dt / time);

/** A value on a spring: it overshoots and settles, which is what makes soft parts look soft. */
class Spring {
  value: number;
  velocity = 0;

  constructor(value: number) {
    this.value = value;
  }

  step(target: number, stiffness: number, damping: number, dt: number): void {
    // Two half steps keep a stiff spring stable on a slow frame.
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      this.velocity += ((target - this.value) * stiffness - this.velocity * damping) * h;
      this.value += this.velocity * h;
    }
  }
}

export class Mind {
  private x: number;
  private speed = 0;
  /** Which way he means to face, and how far round he has turned. */
  private heading: 1 | -1 = 1;
  private facing = 1;

  private mode: 'grounded' | 'crouching' | 'airborne' = 'grounded';
  private modeTime = 0;
  private height = 0;
  private rise = 0;

  /** Where he is in his stride, and how much of a stride he is taking (0 standing .. 1). */
  private stride = 0;
  private gait = 0;

  private readonly squash = new Spring(1);
  private readonly ear = new Spring(0);
  private readonly beard = new Spring(0);
  private readonly gaze = new Spring(0);

  /** The part he is dressed for, if any, and how far out its props are. */
  private role: Role | null = null;
  private readonly card = new Spring(0);
  private laptop = 0;
  /** Time spent at the keys, and how hard he is typing just now (0 pausing .. 1). */
  private typing = 0;
  private keys = 0;

  private pointer: { x: number; y: number } | null = null;
  private clock = 0;
  private nextTwitch = 2;
  private wasMoving = false;

  /** How long the visitor has done nothing, and whether it is the small hours. */
  private idle = 0;
  private night = false;
  /**
   * Where he is in going to bed: up and about; yawning; turning about; or
   * down, which is lying, asleep or on his way there.
   */
  private bed: 'up' | 'yawning' | 'turning' | 'down' = 'up';
  private bedTime = 0;
  private turnedBack = false;
  /** How far he has lain down (0 standing .. 1 lying), and how wide his yawn is. */
  private readonly lie = new Spring(0);
  private readonly yawn = new Spring(0);
  /** Time asleep, the breaths he has snored at, and when each snore began. */
  private slept = 0;
  private snored = 0;
  private readonly snoreBorn: number[] = Array.from({ length: SNORES }, () => -Infinity);
  /** Woken with a start, he has a hop still to come once he is off the ground. */
  private startled = false;
  private nextDream = 0;

  /**
   * The zoomies: which run he is on (none when below zero), where they began,
   * which way the first run went, which way this one goes, and how long it has taken.
   */
  private zoomRun = -1;
  private zoomHome = 0;
  private zoomWay: 1 | -1 = 1;
  private zoomDir = 0;
  private zoomTime = 0;
  /** Quick presses counted, and when the last one was. */
  private presses = 0;
  private pressedAt = -Infinity;
  /** A backflip owed; one under way; how long he has been in the air, and will be. */
  private flipDue = false;
  private flipping = false;
  private airFor = 0;
  private airTotal = 1;

  constructor(x: number) {
    this.x = x;
  }

  /** Tells Bark where the pointer is: x along the ground, y above it. Null when unknown. */
  watch(pointer: { x: number; y: number } | null): void {
    this.pointer = pointer;
  }

  /** Dresses Bark for a part, or with null lets him be himself again. */
  dress(role: Role | null): void {
    if (role === this.role) return;
    this.role = role;
    if (role) this.ear.velocity += 1.6; // his ear pricks: something to do
  }

  /**
   * Tells Bark how long the visitor has done nothing, in seconds, and whether
   * it is the small hours where he lives. Anything the visitor does brings
   * the time back to zero, which is what wakes him.
   */
  rest(idle: number, night: boolean): void {
    this.idle = idle;
    this.night = night;
  }

  /**
   * Asks for a jump. Ignored unless he is standing on the ground. Asleep, it
   * wakes him instead. Asked five times in quick succession he turns a
   * backflip, as soon as his feet are on the ground to take off from.
   */
  jump(): void {
    this.presses = this.clock - this.pressedAt <= QUICK_S ? this.presses + 1 : 1;
    this.pressedAt = this.clock;
    if (this.presses >= PRESSES) {
      this.presses = 0;
      this.flipDue = true;
    }
    if (this.bed !== 'up') {
      this.rouse();
      return;
    }
    if (this.mode !== 'grounded') return;
    this.mode = 'crouching';
    this.modeTime = 0;
  }

  /**
   * Gives him the zoomies: he tears back and forth past where he stands, a
   * few times, and stops. Ignored if he has them already, is in bed, or is
   * dressed for a part.
   */
  zoom(): void {
    if (this.zoomRun >= 0 || this.bed !== 'up' || this.role !== null) return;
    this.zoomRun = 0;
    this.zoomHome = this.x;
    this.zoomWay = this.heading;
    this.zoomDir = 0;
    this.zoomTime = 0;
    this.ear.velocity += 3;
  }

  /** Gets him up. From lying down it is with a start: his snores burst, and he hops to his feet. */
  private rouse(): void {
    if (this.bed === 'up') return;
    if (this.bed === 'turning' && !this.turnedBack) this.heading = this.heading === 1 ? -1 : 1;
    if (this.bed === 'down' && this.lie.value > 0.5) {
      this.startled = true;
      this.ear.velocity += 4.5;
      this.beard.velocity += 2;
      // His snores go at once, whatever their age.
      for (let i = 0; i < SNORES; i++) {
        this.snoreBorn[i] = Math.min(this.snoreBorn[i]!, this.clock - SNORE_S * 0.94);
      }
    }
    this.bed = 'up';
    // Until the visitor is idle again from nothing, he stays up.
    this.idle = 0;
  }

  /** True when only his breathing is moving, so frames can come less often. */
  get resting(): boolean {
    return (
      this.mode === 'grounded' &&
      this.gait < 0.01 &&
      Math.abs(this.facing - this.heading) < 0.01 &&
      Math.abs(this.squash.velocity) < 0.02 &&
      Math.abs(this.ear.velocity) < 0.05 &&
      this.role === null &&
      this.card.value < 0.003 &&
      this.laptop === 0 &&
      this.bed === 'up' &&
      Math.abs(this.lie.value) < 0.004 &&
      Math.abs(this.yawn.value) < 0.01 &&
      this.zoomRun < 0 &&
      !this.flipDue
    );
  }

  /** True when nothing is moving fast: standing and breathing, or sound asleep. */
  get calm(): boolean {
    return this.resting || (this.bed === 'down' && this.slept > 0.5);
  }

  /** Takes him a step further into going to bed, or gets him up the moment the visitor stirs. */
  private bedtime(dt: number): void {
    const after = this.night ? BEDTIME_AT_NIGHT_S : BEDTIME_S;
    if (this.idle < after) {
      this.rouse();
      return;
    }
    this.bedTime += dt;
    const about = this.heading === 1 ? -1 : 1;
    switch (this.bed) {
      case 'up':
        // Only from standing quietly, and not while he is still getting up.
        if (this.mode !== 'grounded' || this.gait > 0.05 || this.lie.value > 0.05) break;
        if (this.idle > after + LONG_GONE_S) {
          // The visitor has been away a long while, and comes back to find him asleep.
          this.bed = 'down';
          this.lie.value = 1;
          this.lie.velocity = 0;
          this.slept = BREATH_S * 0.6;
          this.snored = 0;
        } else {
          this.bed = 'yawning';
          this.bedTime = 0;
        }
        break;
      case 'yawning':
        if (this.bedTime > YAWN_S) {
          // He turns about on the spot, as a dog does before it lies down.
          this.bed = 'turning';
          this.bedTime = 0;
          this.turnedBack = false;
          this.heading = about;
        }
        break;
      case 'turning':
        if (!this.turnedBack && this.bedTime > TURN_S) {
          this.turnedBack = true;
          this.heading = about;
        }
        if (this.bedTime > TURN_S * 2 + 0.15) {
          this.bed = 'down';
          this.slept = 0;
          this.snored = 0;
        }
        break;
      case 'down':
        break;
    }
  }

  /** Advances time by `dt` seconds and returns what to draw. */
  step(dt: number, ground: Ground): Frame {
    this.clock += dt;
    const size = ground.size;
    const top = TOP_SPEED * size;

    // --- Bedtime. In bed, or getting up from it, he neither follows the
    // pointer nor dresses for a part.
    this.bedtime(dt);
    const up = this.bed === 'up' && this.lie.value < 0.12;

    // --- The zoomies: one run after another, flat out, turning on the spot
    // where each ends. With them he has no time for the pointer or a part.
    let dash: number | null = null;
    // A run that would take him off his ground stops at its edge instead, and
    // so does the last, which ends where he began: those he slows into.
    let slowing = false;
    if (this.zoomRun >= 0) {
      const aim = (): number => this.zoomHome + this.zoomWay * ZOOM_RUNS[this.zoomRun]! * size;
      const to = (): number => clamp(aim(), ground.left, ground.right);
      const short = (): boolean => this.zoomRun === ZOOM_RUNS.length - 1 || to() !== aim();
      if (this.zoomDir === 0) this.zoomDir = to() >= this.x ? 1 : -1;
      this.zoomTime += dt;
      const left = (to() - this.x) * this.zoomDir;
      if (left < (short() ? 0.12 : 0.3) * size || this.zoomTime > ZOOM_RUN_S) {
        this.zoomRun += 1;
        this.zoomTime = 0;
        this.zoomDir = 0;
        if (this.zoomRun >= ZOOM_RUNS.length) {
          // Done: a hop, and he is himself again.
          this.zoomRun = -1;
          if (this.mode === 'grounded') {
            this.mode = 'airborne';
            this.rise = Math.sqrt(2 * GRAVITY * HAPPY_HOP) * size;
            this.squash.velocity += 2;
          }
          this.ear.velocity += 3;
        } else {
          // He digs in to turn.
          this.squash.velocity -= 1.4;
        }
      }
      if (this.zoomRun >= 0) {
        dash = to();
        slowing = short();
      }
    }
    const zooming = dash !== null;
    const free = up && !zooming;
    const part = free ? this.role : null;

    // --- Chase: head for the pointer, slowing as he closes in.
    let want = 0;
    if (dash !== null) {
      // Flat out, turning at the last moment; or slowing to a stop.
      const gap = dash - this.x;
      want = Math.sign(gap) * Math.min(top * ZOOM, slowing ? Math.abs(gap) * 8 : Infinity);
    } else if (this.pointer && this.mode !== 'crouching' && up) {
      const goal = clamp(this.pointer.x, ground.left, ground.right);
      const gap = goal - this.x;
      // Dressed for a part he holds his ground while the pointer wanders
      // nearby, so a small move of the mouse does not make him pack up.
      const reach = (part ? 0.9 : STOP_WITHIN) * size;
      if (Math.abs(gap) > reach) {
        want = Math.sign(gap) * Math.min(top, (Math.abs(gap) - reach * 0.5) * 4.2);
      }
    }
    // In the air he cannot push off, so his speed changes slowly.
    this.speed += (want - this.speed) * toward(dt, this.mode === 'airborne' ? 0.35 : 0.1);
    this.x += this.speed * dt;
    const pace = Math.abs(this.speed) / top;

    // --- Facing: the way he is going, or toward the pointer when standing.
    // Going to bed he turns as that takes him.
    if (!up) {
      // Left as it is.
    } else if (pace > 0.04) {
      this.heading = this.speed > 0 ? 1 : -1;
    } else if (free && this.pointer && Math.abs(this.pointer.x - this.x) > 0.45 * size) {
      this.heading = this.pointer.x > this.x ? 1 : -1;
    }
    this.facing += (this.heading - this.facing) * toward(dt, 0.055);
    if (Math.abs(this.heading - this.facing) < 0.002) this.facing = this.heading;

    // --- Stride: tied to the ground he covers, so his feet do not slide.
    // Steps lengthen with speed, and fade out as he stops.
    this.stride = (this.stride + (Math.abs(this.speed) * dt * TAU) / (size * (0.34 + 0.36 * pace))) % TAU;
    this.gait += (clamp(pace / 0.09, 0, 1) - this.gait) * toward(dt, 0.09);

    const moving = pace > 0.05;
    if (moving && !this.wasMoving) this.ear.velocity += 2; // ears prick as he sets off
    this.wasMoving = moving;

    // --- Lying down takes its time; getting up with a start does not.
    const down = this.bed === 'down';
    this.lie.step(down ? 1 : 0, down ? 30 : 420, down ? 10 : 30, dt);
    if (this.lie.value < -0.05) {
      this.lie.value = -0.05;
      this.lie.velocity = 0;
    }
    const lying = clamp(this.lie.value, 0, 1.04);
    this.yawn.step(this.bed === 'yawning' && this.bedTime < YAWN_S * 0.68 ? 1 : 0, 60, 13, dt);
    const yawning = clamp(this.yawn.value, 0, 1.1);
    this.slept = down && lying > 0.92 ? this.slept + dt : down ? this.slept : 0;
    if (this.startled && this.mode === 'grounded' && this.lie.value < 0.3) {
      // On his feet with a hop.
      this.startled = false;
      this.mode = 'airborne';
      this.rise = Math.sqrt(2 * GRAVITY * STARTLE) * size;
      this.squash.velocity += 2.2;
    }

    // --- Jump. A backflip is a jump he gathers longer for and goes higher in.
    let stretch = 1;
    if (this.mode === 'grounded' && this.flipDue && up) {
      // A backflip is owed, and his feet are on the ground to take off from.
      this.mode = 'crouching';
      this.modeTime = 0;
    }
    if (this.mode === 'crouching') {
      const flip = this.flipDue;
      this.modeTime += dt;
      stretch = flip ? 0.78 : 0.85;
      if (this.modeTime >= (flip ? FLIP_CROUCH_S : CROUCH_S)) {
        this.mode = 'airborne';
        this.rise = (flip ? Math.sqrt(2 * GRAVITY * FLIP_HEIGHT) : LAUNCH) * size;
        this.squash.velocity += flip ? 3.4 : 2.8;
        this.airFor = 0;
        this.airTotal = (2 * this.rise) / (GRAVITY * size);
        this.flipping = flip;
        this.flipDue = false;
      }
    } else if (this.mode === 'airborne') {
      this.airFor += dt;
      this.height += this.rise * dt;
      this.rise -= GRAVITY * size * dt;
      stretch = 1 + 0.06 * clamp(Math.abs(this.rise) / (LAUNCH * size), 0, 1);
      if (this.height <= 0 && this.rise < 0) {
        const impact = clamp(-this.rise / (LAUNCH * size), 0, 1.2);
        this.height = 0;
        this.rise = 0;
        this.mode = 'grounded';
        this.flipping = false;
        this.squash.velocity -= 2.9 * impact;
        this.ear.velocity += 3 * impact;
        this.beard.velocity += 2.2 * impact;
      }
    } else if (zooming) {
      // With the zoomies he runs low.
      stretch = 0.95;
    } else if (down) {
      // Asleep, he breathes slow and deep.
      stretch =
        1 + BREATH * Math.sin((this.slept * TAU) / BREATH_S) * smooth01(this.slept / 1.5);
    } else if (this.gait < 0.05) {
      // Standing still, he breathes; a yawn stretches him.
      stretch = 1 + 0.007 * Math.sin(this.clock * 2.1) + 0.03 * yawning;
    }
    const flight = this.mode === 'airborne' ? clamp(this.rise / (LAUNCH * size), -1, 1) : 0;
    this.squash.step(stretch, this.mode === 'crouching' ? 900 : 320, this.mode === 'crouching' ? 42 : 15, dt);

    // --- Ear: swept back at speed, trailing in the air, and now and then it twitches.
    if (this.resting && this.clock > this.nextTwitch) {
      this.ear.velocity += Math.random() < 0.5 ? -2.8 : 2.4;
      this.nextTwitch = this.clock + 2.5 + Math.random() * 4.5;
    }
    // Asleep it lies back a little, and twitches when he dreams.
    if (this.slept > 2 && this.clock > this.nextDream) {
      this.ear.velocity += Math.random() < 0.5 ? -2.2 : 2.2;
      this.nextDream = this.clock + 3.5 + Math.random() * 5;
    }
    this.ear.step(-0.16 * pace - 0.2 * flight - EAR_BACK * lying, 210, 13, dt);
    this.beard.step(0.1 * flight, 260, 14, dt);

    // --- Snores: a string of them, drifting up from his head and growing as they go.
    if (down && this.slept >= ((this.snored + 1) * BREATH_S) / SNORES_A_BREATH) {
      this.snoreBorn[this.snored % SNORES] = this.clock;
      this.snored += 1;
    }
    let snores: Snore[] = NO_SNORES;
    for (let i = 0; i < SNORES; i++) {
      const age = this.clock - this.snoreBorn[i]!;
      if (age < 0 || age >= SNORE_S) continue;
      const t = age / SNORE_S;
      const risen = 1 - (1 - t) * (1 - t);
      if (snores === NO_SNORES) snores = [];
      snores.push({
        x:
          this.x +
          this.facing * (0.4 + 0.42 * t) * size +
          0.025 * size * Math.sin(age * 2.4 + i * 2.1),
        // They stay within his own height of the ground, under whatever is set above him.
        y: (0.58 + 0.33 * risen) * size,
        // It grows from nothing as it leaves him, and shrinks to nothing at the top.
        size: size * (0.13 + 0.13 * t) * smooth01(t / 0.12) * smooth01((1 - t) / 0.16),
        tilt: 8 * Math.sin(age * 1.9 + i),
      });
    }

    // --- Gaze: standing, he looks up at a pointer that is above and near him.
    let look = 0;
    if (this.pointer && this.mode === 'grounded' && free) {
      const ahead = Math.abs(this.pointer.x - this.x);
      const above = this.pointer.y - 0.8 * size;
      const near = 1 - clamp((ahead - 1.2 * size) / (2 * size), 0, 1);
      look = clamp(Math.atan2(above, Math.max(0.5 * size, ahead)), -0.15, 0.9) * 0.2 * near * (1 - this.gait);
    }
    this.gaze.step(look, 60, 13, dt);

    // --- Dressing the part. The card comes up at once and he may carry it;
    // the laptop only opens once he has stopped, and shuts when he moves on.
    this.card.step(part === 'judge' ? 1 : 0, 170, 17, dt);
    if (this.card.value < 0) {
      this.card.value = 0;
      this.card.velocity = 0;
    }
    const settled = this.mode === 'grounded' && this.gait < 0.12;
    const wanted = part === 'hacker' && settled ? 1 : 0;
    this.laptop += (wanted - this.laptop) * toward(dt, wanted ? 0.11 : 0.06);
    if (this.laptop < 0.003) this.laptop = 0;
    // His paws come up once the lid is most of the way open.
    const atKeys = clamp((this.laptop - 0.55) / 0.45, 0, 1);
    if (atKeys > 0) this.typing += dt;
    // He types in bursts, with short pauses to think.
    const bursting = Math.sin(this.typing * 3.1) + Math.sin(this.typing * 1.3) > -0.9 ? 1 : 0;
    this.keys += (bursting - this.keys) * toward(dt, 0.05);
    const tap = 0.5 + 0.5 * Math.sin(this.typing * TAU * 9.5);
    const held = clamp(this.card.value, 0, 1);

    // --- Compose the pose.
    const pose: Pose = { ...REST };
    // Faster than a full run, his legs go quicker, not further.
    const swing = Math.min(pace, 1.1);
    const reach = (20 + 38 * swing) * this.gait;
    const lift = (18 + 26 * swing) * this.gait;
    const hind = this.stride;
    const fore = this.stride + Math.PI;
    // A foot travels back along the ground, then lifts and swings forward.
    pose.hindReach = reach * Math.cos(hind);
    pose.hindLift = lift * Math.max(0, -Math.sin(hind));
    pose.foreReach = reach * Math.cos(fore);
    pose.foreLift = lift * Math.max(0, -Math.sin(fore));

    // Off the ground the legs reach out fore and aft, then come back under him to land.
    const tuck = clamp(this.height / (0.3 * size), 0, 1);
    pose.hindReach += -30 * tuck;
    pose.foreReach += 34 * tuck;
    pose.hindLift += 26 * tuck;
    pose.foreLift += 30 * tuck;

    // At the laptop his forepaws come up onto the near edge of the keys and
    // drum on them. The lift is kept small against the length of his legs.
    pose.foreReach += 16 * atKeys;
    pose.foreLift += atKeys * (20 + 20 * tap * this.keys);

    const bounce = Math.sin(this.stride * 2);
    pose.head = -this.gaze.value + this.gait * (0.03 * bounce + 0.045 * swing) - 0.12 * flight;
    // He looks down at the screen and nods as he types; with the card he holds his head up.
    pose.head += 0.12 * this.laptop + 0.026 * atKeys * this.keys * Math.sin(this.typing * TAU * 4.75);
    pose.head -= 0.07 * held;
    pose.ear = this.ear.value + this.gait * 0.05 * Math.sin(this.stride * 2 - 1);
    pose.ear += 0.03 * atKeys * this.keys * Math.sin(this.typing * TAU * 9.5 + 1);
    pose.beard = this.beard.value + this.gait * 0.07 * Math.sin(this.stride * 2 + 0.7);

    // A yawn: his head goes back and his jaw drops, and his ear with it.
    pose.head -= 0.2 * yawning;
    pose.beard += 0.55 * yawning;
    pose.ear -= 0.2 * yawning;

    // The body rises between footfalls, a little more the faster he goes.
    const bob = this.gait * (0.006 + 0.014 * swing) * size * (0.5 - 0.5 * Math.cos(this.stride * 2));

    // Lying down, he goes onto his chest first, tipping forward about his
    // hind feet, which stay where they are; then his hips come down, and his
    // head settles onto the ground.
    const chest = smooth01(lying / 0.6);
    const hips = smooth01((lying - 0.35) / 0.65);
    const tilt = LIE_TILT * chest;
    const turned = Math.abs(this.facing);
    const sunk =
      size *
      (HIND_BEHIND * turned * Math.sin(tilt * turned) +
        LEAN_ABOUT * (1 - Math.cos(tilt * turned)) +
        HIPS_DOWN * hips);
    pose.headDown = HEAD_DOWN * hips;
    pose.headOut = HEAD_OUT * hips;
    pose.head += HEAD_TURN * lying;

    // A backflip turns him right over backwards, once, between taking off
    // and landing: slowly at first, fastest at the top, and slowly again to
    // meet the ground feet first.
    let over = 0;
    if (this.flipping) {
      const t = clamp(this.airFor / this.airTotal, 0, 1);
      over = -TAU * t * t * t * (t * (6 * t - 15) + 10);
    }

    return {
      x: this.x,
      lift: this.height + bob - sunk,
      facing: this.facing,
      squash: clamp(this.squash.value, 0.7, 1.2),
      pitch: 0.05 * swing * this.gait - 0.09 * flight + tilt + over,
      pose,
      props: { card: clamp(this.card.value, 0, 1.15), laptop: this.laptop },
      asleep: down && lying > 0.9,
      snores,
    };
  }
}
