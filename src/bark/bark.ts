import { smallHours } from './hours.ts';
import { LEAN_ABOUT, Mind, type Frame, type Ground, type Role } from './mind.ts';
import { draw, REST } from './pose.ts';
import { drawProps } from './props.ts';
import { Whirl } from './whirl.ts';
import { HEIGHT, LEFT, MITER_LIMIT, RIGHT, STROKE } from './shape.ts';

export interface BarkOptions {
  /** The element positions are measured from; Bark is added to it. */
  stage: HTMLElement;
  /** Bark stands on this element's top edge. */
  ground: HTMLElement;
  /** An element as tall as Bark should be. */
  sizer: HTMLElement;
  /**
   * Elements Bark dresses for while the pointer is over them, or while they
   * have the keyboard's focus.
   */
  parts?: readonly { element: HTMLElement; role: Role }[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Far enough to cover the drawing in every pose, and the page at any size. */
const FAR = 4000;

/** What his button says he is for: awake, and asleep. */
const AWAKE = 'Bark, the ScottyLabs dog. Press to make him jump.';
const ASLEEP = 'Bark, the ScottyLabs dog, asleep. Press to wake him.';

/** How often the time where he lives is looked up, in milliseconds. */
const CLOCK_EVERY_MS = 60_000;

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
 * the pointer, jumps when pressed, gets the zoomies when the pointer is
 * whirled about, and goes to sleep when the visitor has done nothing for a
 * while. The drawing is rebuilt from his pose every frame.
 * Squashing and turning move its points; the only transform on it is a
 * uniform one, so his line keeps its weight however he moves.
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
  private readonly stick: SVGPathElement;
  private readonly plate: SVGPathElement;
  private readonly score: SVGTextElement;
  private readonly laptop: SVGPathElement;
  private readonly snores: SVGTextElement[];
  private readonly button: HTMLButtonElement;

  private readonly parts: readonly { element: HTMLElement; role: Role }[];
  /** The part the pointer or the keyboard is asking for, and the element in focus. */
  private hovered: Role | null = null;
  private focused: { element: HTMLElement; role: Role } | null = null;

  private mind: Mind | null = null;
  /** The pointer in viewport coordinates, once it has been seen. */
  private pointer: { x: number; y: number } | null = null;
  /** Where he waits until the pointer shows up, as a fraction of the ground. */
  private readonly home = 0.14;

  private lastStep = 0;

  /** When the visitor last did anything, and where the pointer was then. */
  private stirred = performance.now();
  private readonly last = { x: NaN, y: NaN };
  /** Whether it is night where he lives, and when that was last looked up. */
  private night = false;
  private clockRead = -Infinity;
  private asleep = false;
  /** Watches for the pointer being whirled round, which gives him the zoomies. */
  private readonly whirl = new Whirl();

  constructor(options: BarkOptions) {
    this.stage = options.stage;
    this.ground = options.ground;
    this.sizer = options.sizer;
    this.parts = options.parts ?? [];

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

    // What he can have with him, drawn in his line. They sit outside the
    // clip that cuts his feet level, and are empty until he is dressed.
    const line = { class: 'bark__line', 'stroke-width': String(STROKE), 'stroke-miterlimit': String(MITER_LIMIT) };
    this.laptop = svg('path', line);
    this.stick = svg('path', line);
    this.plate = svg('path', { ...line, class: 'bark__line bark__plate' });
    this.score = svg('text', { class: 'bark__score' });
    this.score.textContent = '10';

    this.body.append(clipped, this.laptop, this.stick, this.plate, this.score);
    // His snores are set on the stage, not on him: they drift off as he lies still.
    this.snores = [0, 1, 2].map(() => {
      const snore = svg('text', { class: 'bark__snore', visibility: 'hidden' });
      snore.textContent = 'Z';
      return snore;
    });
    grounded.append(this.body, ...this.snores);
    art.append(defs, grounded);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'bark__button';
    this.button.setAttribute('aria-label', AWAKE);

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
          props: { card: 0, laptop: 0 },
          asleep: false,
          snores: [],
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

    // Wherever the pointer goes he follows; whirled round and round, fast,
    // it gives him the zoomies.
    const whirled = (x: number, y: number, time: number): void => {
      if (this.whirl.move(x, y, time)) this.mind?.zoom();
    };
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        this.pointer = { x: event.clientX, y: event.clientY };
        whirled(event.clientX, event.clientY, event.timeStamp);
      },
      { passive: true },
    );
    const touched = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!touch) return;
      this.pointer = { x: touch.clientX, y: touch.clientY };
      whirled(touch.clientX, touch.clientY, event.timeStamp);
    };
    window.addEventListener('touchstart', touched, { passive: true });
    window.addEventListener('touchmove', touched, { passive: true });

    // A click covers mouse, touch and keyboard alike.
    this.button.addEventListener('click', () => this.mind?.jump());

    // Anything the visitor does keeps him up, or wakes him. The browser can
    // report a pointer movement when it is the page that moved under a still
    // pointer, as it does when he lies down beneath it: only a pointer that
    // has changed place counts.
    const stir = (): void => {
      this.stirred = performance.now();
    };
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.clientX === this.last.x && event.clientY === this.last.y) return;
        this.last.x = event.clientX;
        this.last.y = event.clientY;
        stir();
      },
      { passive: true },
    );
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) {
      window.addEventListener(type, stir, { passive: true });
    }

    // He dresses for a part while the pointer is over its element. A finger
    // does not hover, so touch is left out. Keyboard focus counts too, and
    // brings him over to the element.
    for (const part of this.parts) {
      part.element.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') this.hovered = part.role;
      });
      part.element.addEventListener('pointerleave', () => {
        if (this.hovered === part.role) this.hovered = null;
      });
      part.element.addEventListener('focus', () => {
        if (part.element.matches(':focus-visible')) this.focused = part;
      });
      part.element.addEventListener('blur', () => {
        if (this.focused === part) this.focused = null;
      });
    }

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

    // Breathing alone does not need every frame, awake or asleep.
    const elapsed = now - this.lastStep;
    if (mind.calm && elapsed < 45) return;
    this.lastStep = now;

    if (now - this.clockRead > CLOCK_EVERY_MS) {
      this.clockRead = now;
      this.night = smallHours(new Date());
    }
    mind.rest(Math.max(0, now - this.stirred) / 1000, this.night);

    const ground = this.measure();
    mind.dress(this.hovered ?? this.focused?.role ?? null);
    if (this.focused && !this.hovered) {
      // With the keyboard there is no pointer to follow: go to the element.
      const box = this.focused.element.getBoundingClientRect();
      mind.watch({ x: box.left + box.width / 2 - ground.originX, y: 0 });
    } else if (this.pointer) {
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

    const build = { wide: frame.facing * (1 + (1 - frame.squash) * 0.55), tall: frame.squash };
    const props = drawProps(frame.props, drawing.mouth, frame.pose.head, build);
    this.laptop.setAttribute('d', props.laptop);
    this.stick.setAttribute('d', props.stick);
    this.plate.setAttribute('d', props.plate);
    // The numerals are set upright on the plate and never mirrored, whichever
    // way he faces; their baseline sits so that they are centred on it.
    const { x, y, tilt, size, squeeze } = props.score;
    this.score.setAttribute('visibility', size > 1 ? 'visible' : 'hidden');
    this.score.setAttribute('font-size', size.toFixed(1));
    this.score.setAttribute(
      'transform',
      `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt.toFixed(2)}) ` +
        `scale(${squeeze.toFixed(3)} 1) translate(0 ${(size * 0.36).toFixed(1)})`,
    );

    // The only transform is a uniform one, so the line scales with him and
    // nothing else: every browser then agrees on how far the drawing extends.
    const lean = (frame.pitch * frame.facing * 180) / Math.PI;
    const top = ground.y - frame.lift;
    this.body.setAttribute(
      'transform',
      `translate(${frame.x.toFixed(2)} ${top.toFixed(2)}) ` +
        `rotate(${lean.toFixed(2)} 0 ${(-LEAN_ABOUT * ground.size).toFixed(1)}) ` +
        `scale(${scale.toFixed(5)})`,
    );

    // His snores: the letter Z in the wordmark's type, each set upright where it has drifted to.
    frame.snores.forEach((snore, i) => {
      const letter = this.snores[i];
      if (!letter) return;
      letter.setAttribute('visibility', 'visible');
      letter.setAttribute('font-size', snore.size.toFixed(1));
      letter.setAttribute(
        'transform',
        `translate(${snore.x.toFixed(1)} ${(ground.y - snore.y).toFixed(1)}) ` +
          `rotate(${snore.tilt.toFixed(1)}) translate(0 ${(snore.size * 0.36).toFixed(1)})`,
      );
    });
    for (let i = frame.snores.length; i < this.snores.length; i++) {
      this.snores[i]?.setAttribute('visibility', 'hidden');
    }

    // What his button offers changes when he is asleep.
    if (frame.asleep !== this.asleep) {
      this.asleep = frame.asleep;
      this.button.setAttribute('aria-label', frame.asleep ? ASLEEP : AWAKE);
    }

    // The button follows him: it is what is pressed, and what takes focus. In
    // the air it reaches from his head down to the ground he left, so that
    // quick presses in one place all land on him, wherever in his jump he is.
    // It never goes down past the ground when he lies down: under the ground
    // are the sign-up links.
    const width = ((RIGHT - LEFT) / HEIGHT) * ground.size;
    const raised = Math.max(0, frame.lift);
    this.button.style.width = `${width.toFixed(1)}px`;
    this.button.style.height = `${(ground.size + raised).toFixed(1)}px`;
    this.button.style.translate =
      `${(frame.x - width / 2).toFixed(1)}px ` +
      `${(ground.y - raised - ground.size).toFixed(1)}px`;
  }
}
