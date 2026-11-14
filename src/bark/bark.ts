import { Mind, type Frame, type Ground } from './mind.ts';
import { draw, REST } from './pose.ts';
import { HEIGHT, LEFT, MITER_LIMIT, RIGHT, STROKE } from './shape.ts';

export interface BarkOptions {
  /** The element positions are measured from; Bark is added to it. */
  stage: HTMLElement;
  /** Bark stands on this element's top edge. */
  ground: HTMLElement;
  /** An element as tall as Bark should be. */
  sizer: HTMLElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Far enough to cover the drawing in every pose, and the page at any size. */
const FAR = 4000;

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/**
 * Bark on the page: he walks along the top edge of the ground element after
 * the pointer, and jumps when pressed. The drawing is rebuilt from his pose
 * every frame. Squashing and turning move its points; the only transform on
 * it is a uniform one, so his line keeps its weight however he moves.
 */
export class Bark {
  private readonly stage: HTMLElement;
  private readonly ground: HTMLElement;
  private readonly sizer: HTMLElement;

  private readonly root: HTMLDivElement;
  private readonly body: SVGGElement;
  private readonly fill: SVGPathElement;
  private readonly lines: SVGPathElement[];
  private readonly soles: SVGPathElement;
  private readonly floor: SVGRectElement;
  private readonly button: HTMLButtonElement;

  private mind: Mind | null = null;
  /** The pointer in viewport coordinates, once it has been seen. */
  private pointer: { x: number; y: number } | null = null;
  /** Where he waits until the pointer shows up, as a fraction of the ground. */
  private readonly home = 0.14;

  private lastStep = 0;

  constructor(options: BarkOptions) {
    this.stage = options.stage;
    this.ground = options.ground;
    this.sizer = options.sizer;

    this.root = document.createElement('div');
    this.root.className = 'bark';
    this.root.hidden = true;

    const art = svg('svg', { class: 'bark__art', 'aria-hidden': 'true', focusable: 'false' });
    // Each pair of feet is cut level with its own soles, as the mark cuts them
    // level with the ground. The clip is one path with a step under his middle.
    // It must stay a single shape: given two, Safari clips through a buffer
    // sized without his line, and shaves the outer half of it off his rump
    // and nose.
    const soles = svg('clipPath', { id: 'bark-soles' });
    this.soles = svg('path');
    soles.append(this.soles);
    // Nothing of him shows below the ground, however he leans on a planted foot.
    const above = svg('clipPath', { id: 'bark-above-ground' });
    this.floor = svg('rect', { x: String(-FAR), y: String(-FAR), width: String(FAR * 3), height: String(FAR) });
    above.append(this.floor);
    const defs = svg('defs');
    defs.append(soles, above);

    const grounded = svg('g', { 'clip-path': 'url(#bark-above-ground)' });
    this.body = svg('g');
    const clipped = svg('g', { 'clip-path': 'url(#bark-soles)' });
    this.fill = svg('path', { class: 'bark__fill' });
    this.lines = [0, 1, 2].map(() =>
      svg('path', {
        class: 'bark__line',
        'stroke-width': String(STROKE),
        'stroke-miterlimit': String(MITER_LIMIT),
      }),
    );
    clipped.append(this.fill, ...this.lines);
    this.body.append(clipped);
    grounded.append(this.body);
    art.append(defs, grounded);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'bark__button';
    this.button.setAttribute('aria-label', 'Bark, the ScottyLabs dog. Press to make him jump.');

    this.root.append(art, this.button);
    this.stage.append(this.root);
  }

  /** Shows Bark standing still, for visitors who asked for less motion. */
  stand(): void {
    const place = (): void => {
      const ground = this.measure();
      this.render(
        {
          x: ground.left + (ground.right - ground.left) * this.home,
          lift: 0,
          facing: 1,
          squash: 1,
          pitch: 0,
          pose: REST,
        },
        ground,
      );
    };
    this.root.hidden = false;
    place();
    // Keep him on the ground when the layout changes.
    new ResizeObserver(place).observe(this.stage);
  }

  /** Brings Bark in from the left edge; from then on he follows the pointer. */
  enter(): void {
    if (this.mind) return;
    const ground = this.measure();
    this.mind = new Mind(-ground.size);
    this.root.hidden = false;

    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        this.pointer = { x: event.clientX, y: event.clientY };
      },
      { passive: true },
    );
    const touched = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch) this.pointer = { x: touch.clientX, y: touch.clientY };
    };
    window.addEventListener('touchstart', touched, { passive: true });
    window.addEventListener('touchmove', touched, { passive: true });

    // A click covers mouse, touch and keyboard alike.
    this.button.addEventListener('click', () => this.mind?.jump());

    this.lastStep = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Where the ground is and how big Bark should be, in stage coordinates. */
  private measure(): Ground & { y: number; originX: number; originY: number } {
    const stage = this.stage.getBoundingClientRect();
    const band = this.ground.getBoundingClientRect();
    const size = this.sizer.getBoundingClientRect().height || 64;
    const half = ((RIGHT - LEFT) / HEIGHT) * size * 0.5;
    return {
      left: half + 6,
      right: stage.width - half - 6,
      size,
      y: band.top - stage.top,
      originX: stage.left,
      originY: stage.top,
    };
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const mind = this.mind;
    if (!mind) return;

    // Breathing alone does not need every frame.
    const elapsed = now - this.lastStep;
    if (mind.resting && elapsed < 45) return;
    this.lastStep = now;

    const ground = this.measure();
    if (this.pointer) {
      mind.watch({
        x: this.pointer.x - ground.originX,
        y: ground.y - (this.pointer.y - ground.originY),
      });
    } else {
      mind.watch({ x: ground.left + (ground.right - ground.left) * this.home, y: ground.size * 0.8 });
    }
    this.render(mind.step(Math.min(0.05, elapsed / 1000), ground), ground);
  };

  private render(frame: Frame, ground: Ground & { y: number }): void {
    const scale = ground.size / HEIGHT;

    // Squashing keeps his volume: what he loses in height he gains in width.
    const drawing = draw(frame.pose, {
      wide: frame.facing * (1 + (1 - frame.squash) * 0.55),
      tall: frame.squash,
    });
    this.fill.setAttribute('d', drawing.fill);
    drawing.lines.forEach((d, i) => this.lines[i]?.setAttribute('d', d));
    // Everything above the soles: down to one height left of his middle, and
    // to the other right of it, whichever pair of feet is on that side.
    const left = drawing.hindSide < 0 ? drawing.hindSole : drawing.foreSole;
    const right = drawing.hindSide < 0 ? drawing.foreSole : drawing.hindSole;
    this.soles.setAttribute(
      'd',
      `M${-FAR},${-FAR}H${FAR}V${(-right).toFixed(1)}H0V${(-left).toFixed(1)}H${-FAR}Z`,
    );
    this.floor.setAttribute('height', (FAR + ground.y).toFixed(2));

    // The only transform is a uniform one, so the line scales with him and
    // nothing else: every browser then agrees on how far the drawing extends.
    const lean = (frame.pitch * frame.facing * 180) / Math.PI;
    const top = ground.y - frame.lift;
    this.body.setAttribute(
      'transform',
      `translate(${frame.x.toFixed(2)} ${top.toFixed(2)}) ` +
        `rotate(${lean.toFixed(2)} 0 ${(-0.35 * ground.size).toFixed(1)}) ` +
        `scale(${scale.toFixed(5)})`,
    );

    // The button follows him: it is what is pressed, and what takes focus.
    const width = ((RIGHT - LEFT) / HEIGHT) * ground.size;
    this.button.style.width = `${width.toFixed(1)}px`;
    this.button.style.height = `${ground.size.toFixed(1)}px`;
    this.button.style.translate = `${(frame.x - width / 2).toFixed(1)}px ${(top - ground.size).toFixed(1)}px`;
  }
}
