import { REST, type Pose } from './pose.ts';

/**
 * How Bark behaves: he follows the pointer along the ground, turns to face
 * it, trots or runs depending on how far behind he is, and jumps when
 * pressed. This file knows nothing about the page; it turns time and a
 * pointer position into a pose to draw, which keeps it testable.
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

/** What to draw for one frame. */
export interface Frame {
  /** His middle, along the ground. */
  x: number;
  /** How far his soles are above the ground. */
  lift: number;
  /** 1 facing right, -1 facing left, in between while he turns round. */
  facing: number;
  /** Vertical stretch of the whole body; 1 at rest. Width makes up for it. */
  squash: number;
  /** Lean of the whole body in radians; positive tips the nose down. */
  pitch: number;
  pose: Pose;
  props: Props;
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

  /** Asks for a jump. Ignored unless he is standing on the ground. */
  jump(): void {
    if (this.mode !== 'grounded') return;
    this.mode = 'crouching';
    this.modeTime = 0;
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
      this.laptop === 0
    );
  }

  /** Advances time by `dt` seconds and returns what to draw. */
  step(dt: number, ground: Ground): Frame {
    this.clock += dt;
    const size = ground.size;
    const top = TOP_SPEED * size;

    // --- Chase: head for the pointer, slowing as he closes in.
    let want = 0;
    if (this.pointer && this.mode !== 'crouching') {
      const goal = clamp(this.pointer.x, ground.left, ground.right);
      const gap = goal - this.x;
      // Dressed for a part he holds his ground while the pointer wanders
      // nearby, so a small move of the mouse does not make him pack up.
      const reach = (this.role ? 0.9 : STOP_WITHIN) * size;
      if (Math.abs(gap) > reach) {
        want = Math.sign(gap) * Math.min(top, (Math.abs(gap) - reach * 0.5) * 4.2);
      }
    }
    // In the air he cannot push off, so his speed changes slowly.
    this.speed += (want - this.speed) * toward(dt, this.mode === 'airborne' ? 0.35 : 0.1);
    this.x += this.speed * dt;
    const pace = Math.abs(this.speed) / top;

    // --- Facing: the way he is going, or toward the pointer when standing.
    if (pace > 0.04) {
      this.heading = this.speed > 0 ? 1 : -1;
    } else if (this.pointer && Math.abs(this.pointer.x - this.x) > 0.45 * size) {
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

    // --- Jump.
    let stretch = 1;
    if (this.mode === 'crouching') {
      this.modeTime += dt;
      stretch = 0.85;
      if (this.modeTime >= CROUCH_S) {
        this.mode = 'airborne';
        this.rise = LAUNCH * size;
        this.squash.velocity += 2.8;
      }
    } else if (this.mode === 'airborne') {
      this.height += this.rise * dt;
      this.rise -= GRAVITY * size * dt;
      stretch = 1 + 0.06 * clamp(Math.abs(this.rise) / (LAUNCH * size), 0, 1);
      if (this.height <= 0 && this.rise < 0) {
        const impact = clamp(-this.rise / (LAUNCH * size), 0, 1.2);
        this.height = 0;
        this.rise = 0;
        this.mode = 'grounded';
        this.squash.velocity -= 2.9 * impact;
        this.ear.velocity += 3 * impact;
        this.beard.velocity += 2.2 * impact;
      }
    } else if (this.gait < 0.05) {
      // Standing still, he breathes.
      stretch = 1 + 0.007 * Math.sin(this.clock * 2.1);
    }
    const flight = this.mode === 'airborne' ? clamp(this.rise / (LAUNCH * size), -1, 1) : 0;
    this.squash.step(stretch, this.mode === 'crouching' ? 900 : 320, this.mode === 'crouching' ? 42 : 15, dt);

    // --- Ear: swept back at speed, trailing in the air, and now and then it twitches.
    if (this.resting && this.clock > this.nextTwitch) {
      this.ear.velocity += Math.random() < 0.5 ? -2.8 : 2.4;
      this.nextTwitch = this.clock + 2.5 + Math.random() * 4.5;
    }
    this.ear.step(-0.16 * pace - 0.2 * flight, 210, 13, dt);
    this.beard.step(0.1 * flight, 260, 14, dt);

    // --- Gaze: standing, he looks up at a pointer that is above and near him.
    let look = 0;
    if (this.pointer && this.mode === 'grounded') {
      const ahead = Math.abs(this.pointer.x - this.x);
      const above = this.pointer.y - 0.8 * size;
      const near = 1 - clamp((ahead - 1.2 * size) / (2 * size), 0, 1);
      look = clamp(Math.atan2(above, Math.max(0.5 * size, ahead)), -0.15, 0.9) * 0.2 * near * (1 - this.gait);
    }
    this.gaze.step(look, 60, 13, dt);

    // --- Dressing the part. The card comes up at once and he may carry it;
    // the laptop only opens once he has stopped, and shuts when he moves on.
    this.card.step(this.role === 'judge' ? 1 : 0, 170, 17, dt);
    if (this.card.value < 0) {
      this.card.value = 0;
      this.card.velocity = 0;
    }
    const settled = this.mode === 'grounded' && this.gait < 0.12;
    const wanted = this.role === 'hacker' && settled ? 1 : 0;
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
    const reach = (20 + 38 * pace) * this.gait;
    const lift = (18 + 26 * pace) * this.gait;
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
    pose.head = -this.gaze.value + this.gait * (0.03 * bounce + 0.045 * pace) - 0.12 * flight;
    // He looks down at the screen and nods as he types; with the card he holds his head up.
    pose.head += 0.12 * this.laptop + 0.026 * atKeys * this.keys * Math.sin(this.typing * TAU * 4.75);
    pose.head -= 0.07 * held;
    pose.ear = this.ear.value + this.gait * 0.05 * Math.sin(this.stride * 2 - 1);
    pose.ear += 0.03 * atKeys * this.keys * Math.sin(this.typing * TAU * 9.5 + 1);
    pose.beard = this.beard.value + this.gait * 0.07 * Math.sin(this.stride * 2 + 0.7);

    // The body rises between footfalls, a little more the faster he goes.
    const bob = this.gait * (0.006 + 0.014 * pace) * size * (0.5 - 0.5 * Math.cos(this.stride * 2));

    return {
      x: this.x,
      lift: this.height + bob,
      facing: this.facing,
      squash: clamp(this.squash.value, 0.7, 1.2),
      pitch: 0.05 * pace * this.gait - 0.09 * flight,
      pose,
      props: { card: clamp(this.card.value, 0, 1.15), laptop: this.laptop },
    };
  }
}
