/**
 * Notices the visitor whirling the pointer round and round, fast: the thing
 * people do to wind a dog up, and what gives Bark the zoomies.
 *
 * The pointer's path is read a short step at a time, and each step's turn
 * from the last is added up. Circling adds turn after turn the same way; a
 * straight sweep adds nothing; shaking the pointer to and fro is all sharp
 * reversals, which are thrown out. What has been added up fades, so only
 * circling kept up at speed gets there.
 *
 * Times are milliseconds; positions are CSS pixels.
 */

/** The path is read in steps this long. */
const STEP = 14;
/** Slower than this, in pixels a second, is not whirling. */
const FAST = 450;
/** A turn sharper than this in one step, in radians, is a reversal and not part of a circle. */
const SHARP = 1.4;
/** What has been turned through fades over about this long. */
const FADE_MS = 800;
/** This much turning still in hand, in radians, is a whirl: a couple of fast circles. */
const ENOUGH = 2.5 * Math.PI;
/** A pause this long, and the count starts again. */
const PAUSE_MS = 180;
/** After a whirl, nothing counts for this long. */
const REST_MS = 1500;

export class Whirl {
  private fromX = NaN;
  private fromY = NaN;
  private fromTime = 0;
  private heading: number | null = null;
  private turned = 0;
  private restUntil = -Infinity;

  /** Notes where the pointer is at a time. Returns true, once, when it has been whirled enough. */
  move(x: number, y: number, time: number): boolean {
    const elapsed = time - this.fromTime;
    if (Number.isNaN(this.fromX) || elapsed > PAUSE_MS || elapsed < 0) {
      // The first reading, or the first after a pause: nothing to compare it with.
      this.fromX = x;
      this.fromY = y;
      this.fromTime = time;
      this.heading = null;
      this.turned = 0;
      return false;
    }
    const dx = x - this.fromX;
    const dy = y - this.fromY;
    const far = Math.hypot(dx, dy);
    if (far < STEP) return false;

    this.fromX = x;
    this.fromY = y;
    this.fromTime = time;
    const heading = Math.atan2(dy, dx);
    const before = this.heading;
    this.heading = heading;
    this.turned *= Math.exp(-elapsed / FADE_MS);
    if (time < this.restUntil || (far / Math.max(1, elapsed)) * 1000 < FAST) {
      this.heading = null;
      return false;
    }
    if (before === null) return false;

    let turn = heading - before;
    if (turn > Math.PI) turn -= 2 * Math.PI;
    else if (turn <= -Math.PI) turn += 2 * Math.PI;
    if (Math.abs(turn) > SHARP) {
      this.turned *= 0.4;
      return false;
    }
    this.turned += turn;
    if (Math.abs(this.turned) < ENOUGH) return false;

    this.turned = 0;
    this.heading = null;
    this.restUntil = time + REST_MS;
    return true;
  }
}
