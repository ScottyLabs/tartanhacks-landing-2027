import { MAX_FACETS } from './shader.ts';

/**
 * A facet is one fold in the sheet: a regular polygon inside which the rules
 * are mirrored around its centre. Facets open where the pointer travels, hold
 * briefly, and close again, leaving the sheet as it was.
 *
 * Positions and sizes are in CSS pixels, relative to the stage.
 */
interface Facet {
  x: number;
  y: number;
  /** Circumradius when fully open. */
  radius: number;
  /** Number of mirrored wedges. */
  order: number;
  /** Rotation of the mirrors, and how fast they turn (radians, radians per second). */
  mirror: number;
  mirrorRate: number;
  /** Rotation of the sheet seen through the mirrors. */
  source: number;
  sourceRate: number;
  /** A slow sway of the sheet under the mirrors, so the figure keeps changing. */
  swayAngle: number;
  swayReach: number;
  swayRate: number;
  born: number;
  /** When the facet starts closing. Infinity while it is held open. */
  released: number;
}

const OPEN_MS = 420;
const CLOSE_MS = 560;
const FOLLOWER_IDLE_MS = 380;
const ORDERS = [6, 4, 8, 5, 12, 3, 10] as const;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const between = (min: number, max: number): number => min + Math.random() * (max - min);
const either = (): number => (Math.random() < 0.5 ? -1 : 1);

/** Ease out with a slight overshoot, so a facet snaps open. */
function easeOutBack(t: number): number {
  const c = 1.35;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function openness(facet: Facet, now: number): number {
  const opening = easeOutBack(clamp01((now - facet.born) / OPEN_MS));
  const closing = clamp01((now - facet.released) / CLOSE_MS);
  return opening * (1 - closing * closing * closing);
}

export class FacetPool {
  /** Scales every facet; set from the size of the stage. */
  unit = 1;

  private wake: Facet[] = [];
  private follower: Facet | null = null;
  private lastMove = 0;
  private last: { x: number; y: number; time: number } | null = null;
  private sinceStamp = 0;
  private nextStamp = 0;
  private orderIndex = Math.floor(Math.random() * ORDERS.length);

  /** True while any facet is open, i.e. while the field needs redrawing. */
  get active(): boolean {
    return this.follower !== null || this.wake.length > 0;
  }

  /**
   * Reports pointer travel. A mouse or pen keeps one facet under the pointer
   * and leaves others in its wake; a finger only leaves a wake.
   */
  pointerMoved(x: number, y: number, now: number, follows: boolean): void {
    const last = this.last;
    this.last = { x, y, time: now };
    this.lastMove = now;

    let distance = 0;
    let speed = 0;
    if (last && now - last.time < 120) {
      distance = Math.hypot(x - last.x, y - last.y);
      speed = distance / Math.max(1, now - last.time);
    }

    if (follows) {
      if (!this.follower || this.follower.released !== Infinity) {
        this.follower = this.create(x, y, 112 * this.unit, now, Infinity);
      }
      this.follower.x = x;
      this.follower.y = y;
      // Travel turns the figure under the pointer.
      this.follower.source += distance * 0.005;
    }

    this.sinceStamp += distance;
    if (!last || this.sinceStamp >= this.nextStamp) {
      this.sinceStamp = 0;
      this.nextStamp = between(90, 170) * this.unit;
      const size = (46 + 54 * Math.random() + 36 * clamp01(speed / 2.4)) * this.unit;
      this.stamp(x, y, size, now, between(560, 1240));
    }
  }

  /** The pointer left the page: let the facet under it go. */
  pointerLeft(now: number): void {
    if (this.follower && this.follower.released === Infinity) this.follower.released = now;
    this.last = null;
  }

  /** Opens a single facet that closes on its own after `hold` milliseconds. */
  stamp(x: number, y: number, radius: number, now: number, hold: number): void {
    const room = MAX_FACETS - 1;
    if (this.wake.length >= room) this.wake.splice(0, this.wake.length - room + 1);
    this.wake.push(this.create(x, y, radius, now, now + OPEN_MS + hold));
  }

  /** Advances time: releases an idle follower and drops facets that have closed. */
  update(now: number): void {
    const follower = this.follower;
    if (follower) {
      if (follower.released === Infinity && now - this.lastMove > FOLLOWER_IDLE_MS) {
        follower.released = now;
      }
      if (now - follower.released >= CLOSE_MS) this.follower = null;
    }
    this.wake = this.wake.filter((facet) => now - facet.released < CLOSE_MS);
  }

  /**
   * Writes the open facets into the shader's uniform arrays, topmost first,
   * converting to backing-store pixels. Returns how many were written.
   */
  write(a: Float32Array, b: Float32Array, now: number, scale: number): number {
    let count = 0;
    const put = (facet: Facet): void => {
      const open = openness(facet, now);
      if (open <= 0.001 || count >= MAX_FACETS) return;
      const age = (now - facet.born) / 1000;
      const sway = Math.sin(age * facet.swayRate) * facet.swayReach * scale;
      const i = count * 4;
      a[i] = facet.x * scale;
      a[i + 1] = facet.y * scale;
      a[i + 2] = facet.radius * open * scale;
      a[i + 3] = facet.order;
      b[i] = facet.mirror + facet.mirrorRate * age;
      b[i + 1] = facet.source + facet.sourceRate * age;
      b[i + 2] = Math.cos(facet.swayAngle) * sway;
      b[i + 3] = Math.sin(facet.swayAngle) * sway;
      count++;
    };

    if (this.follower) put(this.follower);
    for (let i = this.wake.length - 1; i >= 0; i--) {
      const facet = this.wake[i];
      if (facet) put(facet);
    }
    return count;
  }

  private create(x: number, y: number, radius: number, now: number, released: number): Facet {
    this.orderIndex = (this.orderIndex + 1 + Math.floor(Math.random() * 2)) % ORDERS.length;
    return {
      x,
      y,
      radius,
      order: ORDERS[this.orderIndex] ?? 6,
      mirror: between(0, Math.PI * 2),
      mirrorRate: either() * between(0.05, 0.3),
      source: between(0, Math.PI * 2),
      sourceRate: either() * between(0.25, 0.8),
      swayAngle: between(0, Math.PI * 2),
      swayReach: between(10, 34),
      swayRate: between(0.8, 1.9),
      born: now,
      released,
    };
  }
}
