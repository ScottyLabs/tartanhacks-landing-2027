/**
 * The bar over the theme, as a strip of rubber stuck down at both ends.
 *
 * Taken hold of anywhere along it and pulled, it stretches after the hand:
 * two straight runs from its ends to the hand, thinning as they lengthen. It
 * resists more the further it goes, and cannot be pulled off or along past
 * its own ends. Let go, it snaps back and twangs to rest. At rest it is
 * exactly the bar.
 *
 * This file knows nothing about the page, which keeps it testable. Lengths
 * are CSS pixels in whatever frame the caller measures in; times are seconds.
 */

/** Where the bar lies: its two ends, the height of its middle line, and its thickness. */
export interface Strip {
  left: number;
  right: number;
  y: number;
  height: number;
}

/** However hard it is pulled, the held point goes no further than this many bar lengths. */
const REACH = 1;
/**
 * The held point keeps this share of the bar's length away from either end,
 * when it is taken hold of and however it is pulled: stuck down at both
 * ends, the bar can be drawn out from its line but not along past them.
 */
const FROM_END = 0.12;
/** Let go, it swings back and forth this many times a second, losing this share of its swing as it goes. */
const TWANG_HZ = 6.5;
const DAMPING = 0.15;
/** Stretched as far as it goes, it is still this share of its thickness at the hand. */
const THINNEST = 0.4;
/** Closer to rest than this, and slower than this, it has come to rest. */
const AT_REST = 0.3;
const STILL = 6;

export class Band {
  private strip: Strip;
  /** How far along the bar it is held (0 its left end .. 1 its right). */
  private along = 0.5;
  /** Where the hand was when it took hold. */
  private fromX = 0;
  private fromY = 0;
  /** How far the held point is from where it lies at rest, and how fast it is moving. */
  private offX = 0;
  private offY = 0;
  private velX = 0;
  private velY = 0;
  private holding = false;

  constructor(strip: Strip) {
    this.strip = strip;
  }

  /** Tells it where the bar lies now: the page may have moved under it. */
  place(strip: Strip): void {
    this.strip = strip;
  }

  /** True while a hand has hold of it. */
  get held(): boolean {
    return this.holding;
  }

  /** True while it is held or still twanging: there is something to draw. */
  get moving(): boolean {
    return this.holding || this.offX !== 0 || this.offY !== 0;
  }

  /** How far the held point is from rest, in bar thicknesses. */
  get pulled(): number {
    return Math.hypot(this.offX, this.offY) / this.strip.height;
  }

  /** Takes hold of it where the hand is. */
  grab(x: number, y: number): void {
    const { left, right } = this.strip;
    this.along = Math.min(1 - FROM_END, Math.max(FROM_END, (x - left) / (right - left)));
    this.fromX = x;
    this.fromY = y;
    this.velX = 0;
    this.velY = 0;
    this.holding = true;
  }

  /** Follows the hand. The further the hand goes, the less of the way the rubber follows. */
  pull(x: number, y: number): void {
    if (!this.holding) return;
    const dx = x - this.fromX;
    const dy = y - this.fromY;
    const far = Math.hypot(dx, dy);
    if (far === 0) {
      this.offX = 0;
      this.offY = 0;
      return;
    }
    const most = REACH * (this.strip.right - this.strip.left);
    const gone = most * (1 - Math.exp(-far / most));
    this.offX = (dx / far) * gone;
    this.offY = (dy / far) * gone;
  }

  /** Lets go. */
  release(): void {
    this.holding = false;
  }

  /** Lets it snap back for `dt` seconds. */
  step(dt: number): void {
    if (this.holding || (this.offX === 0 && this.offY === 0)) return;
    const stiff = (2 * Math.PI * TWANG_HZ) ** 2;
    const drag = 2 * DAMPING * 2 * Math.PI * TWANG_HZ;
    // Short steps keep a stiff spring steady on a slow frame.
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velX += (-stiff * this.offX - drag * this.velX) * h;
      this.velY += (-stiff * this.offY - drag * this.velY) * h;
      this.offX += this.velX * h;
      this.offY += this.velY * h;
    }
    if (Math.hypot(this.offX, this.offY) < AT_REST && Math.hypot(this.velX, this.velY) < STILL) {
      this.offX = 0;
      this.offY = 0;
      this.velX = 0;
      this.velY = 0;
    }
  }

  /**
   * Its outline: six corners, as x, y pairs, going round. Its two ends are
   * stuck down at full thickness; at the held point it is as thin as its
   * stretch has made it.
   */
  outline(): number[] {
    const { left, right, y, height } = this.strip;
    const half = height / 2;
    const length = right - left;
    const px = Math.min(
      right - FROM_END * length,
      Math.max(left + FROM_END * length, left + length * this.along + this.offX),
    );
    const py = y + this.offY;

    // Its two runs, and how much longer than the bar they are together.
    let ax = px - left;
    let ay = py - y;
    let bx = right - px;
    let by = y - py;
    const a = Math.hypot(ax, ay) || 1;
    const b = Math.hypot(bx, by) || 1;
    ax /= a;
    ay /= a;
    bx /= b;
    by /= b;
    const thin = Math.min(1, Math.max(THINNEST, ((right - left) / (a + b)) ** 0.8));

    // Across the bend at the held point: halfway between the two runs' own
    // crossways, and no longer than twice the thickness however sharp the bend.
    let mx = ay + by;
    let my = -ax - bx;
    const m = Math.hypot(mx, my);
    if (m < 1e-6) {
      mx = ay;
      my = -ax;
    } else {
      mx /= m;
      my /= m;
    }
    const across = (half * thin) / Math.max(0.5, mx * ay - my * ax);
    return [
      left, y - half,
      px + mx * across, py + my * across,
      right, y - half,
      right, y + half,
      px - mx * across, py - my * across,
      left, y + half,
    ];
  }
}
