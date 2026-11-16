import { Band } from './band.ts';

export interface RedactionOptions {
  /** The element positions are measured from; the stretched bar is drawn over it. */
  stage: HTMLElement;
  /** The bar itself. */
  bar: HTMLElement;
  /**
   * Called with the middle of the bar, in the window's coordinates, while it
   * is being pulled about, and with null once it is at rest again.
   */
  onHold?: (at: { x: number; y: number } | null) => void;
  /** Called when a pulled bar is let go, with how far it was pulled, in its own thicknesses. */
  onSnap?: (pulled: number) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** What is written under the bar. Not the theme: that is not anywhere in this code. */
const UNDER = 'nice try';
/** Pulled less than this, in its own thicknesses, it was only touched: letting go is not a snap. */
const A_PULL = 0.8;

/**
 * The bar over the theme can be taken hold of and pulled, like rubber. It is
 * stuck down at both ends, so it never comes off; pulled clear of the middle,
 * it shows what is written underneath. Let go, it snaps back.
 *
 * At rest nothing here is on screen: the bar is the plain block the
 * stylesheet draws. Only while it is out of shape is it drawn as a shape,
 * on a layer over the stage, so that it can stretch past the edges of the
 * line it sits in.
 */
export class Redaction {
  private readonly stage: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly onHold: RedactionOptions['onHold'];
  private readonly onSnap: RedactionOptions['onSnap'];

  private readonly layer: SVGSVGElement;
  private readonly shape: SVGPathElement;
  private readonly band = new Band({ left: 0, right: 1, y: 0, height: 1 });

  /** The pointer that has hold of it, and where that pointer is in the window. */
  private holder: number | null = null;
  private readonly at = { x: 0, y: 0 };
  private lastFrame = 0;
  private live = false;

  constructor(options: RedactionOptions) {
    this.stage = options.stage;
    this.bar = options.bar;
    this.onHold = options.onHold;
    this.onSnap = options.onSnap;

    // Under the bar, in ink on ink until the bar is pulled away from it.
    const under = document.createElement('span');
    under.className = 'redacted__under';
    under.textContent = UNDER;
    this.bar.append(under);
    this.bar.classList.add('redacted--rubber');

    this.layer = document.createElementNS(SVG_NS, 'svg');
    this.layer.setAttribute('class', 'rubber');
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.setAttribute('focusable', 'false');
    this.shape = document.createElementNS(SVG_NS, 'path');
    this.shape.setAttribute('class', 'rubber__band');
    this.layer.append(this.shape);
    this.layer.toggleAttribute('hidden', true);
    this.stage.append(this.layer);

    this.bar.addEventListener('pointerdown', this.press);
    this.bar.addEventListener('pointermove', this.move);
    this.bar.addEventListener('pointerup', this.lift);
    this.bar.addEventListener('pointercancel', this.lift);
    this.bar.addEventListener('lostpointercapture', this.lift);
  }

  /** Where the bar lies on the stage. */
  private place(): { originX: number; originY: number } {
    const stage = this.stage.getBoundingClientRect();
    const bar = this.bar.getBoundingClientRect();
    this.band.place({
      left: bar.left - stage.left,
      right: bar.right - stage.left,
      y: bar.top + bar.height / 2 - stage.top,
      height: bar.height,
    });
    return { originX: stage.left, originY: stage.top };
  }

  private readonly press = (event: PointerEvent): void => {
    if (this.holder !== null || !event.isPrimary || event.button !== 0) return;
    // Taking hold of it is not the start of selecting the words around it.
    event.preventDefault();
    this.holder = event.pointerId;
    try {
      this.bar.setPointerCapture(event.pointerId);
    } catch {
      // Without capture it still follows the pointer while the pointer is over it.
    }
    const { originX, originY } = this.place();
    this.at.x = event.clientX;
    this.at.y = event.clientY;
    this.band.grab(event.clientX - originX, event.clientY - originY);
    this.bar.classList.add('redacted--held');
    this.start();
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.holder) return;
    this.at.x = event.clientX;
    this.at.y = event.clientY;
  };

  private readonly lift = (event: PointerEvent): void => {
    if (event.pointerId !== this.holder) return;
    this.holder = null;
    if (this.bar.hasPointerCapture(event.pointerId)) this.bar.releasePointerCapture(event.pointerId);
    this.bar.classList.remove('redacted--held');
    const pulled = this.band.pulled;
    this.band.release();
    if (pulled >= A_PULL) this.onSnap?.(pulled);
  };

  /** Starts drawing it as a shape. */
  private start(): void {
    if (this.live) return;
    this.live = true;
    this.layer.toggleAttribute('hidden', false);
    this.bar.classList.add('redacted--out');
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Back at rest: the plain bar again, and nothing left running. */
  private stop(): void {
    this.live = false;
    this.layer.toggleAttribute('hidden', true);
    this.bar.classList.remove('redacted--out');
    this.shape.setAttribute('d', '');
    this.onHold?.(null);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const band = this.band;
    const { originX, originY } = this.place();
    if (band.held) band.pull(this.at.x - originX, this.at.y - originY);
    else band.step(dt);

    if (!band.moving) {
      this.stop();
      return;
    }
    const o = band.outline();
    let d = '';
    for (let i = 0; i < o.length; i += 2) {
      d += `${i === 0 ? 'M' : 'L'}${o[i]!.toFixed(2)},${o[i + 1]!.toFixed(2)}`;
    }
    this.shape.setAttribute('d', `${d}Z`);
    const bar = this.bar.getBoundingClientRect();
    this.onHold?.({ x: bar.left + bar.width / 2, y: bar.top + bar.height / 2 });
    requestAnimationFrame(this.frame);
  };
}
