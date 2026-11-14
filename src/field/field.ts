import { FacetPool } from './facets.ts';
import { ID_STEP, rasteriseInk, type InkGlyph } from './ink.ts';
import { FRAGMENT_SOURCE, MAX_FACETS, MAX_GLYPHS, VERTEX_SOURCE } from './shader.ts';

export interface FieldOptions {
  /** The element the field covers. Positions are measured from its top left. */
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  /** One element per line of the wordmark; drawn into the rules. */
  inkLines: readonly HTMLElement[];
  /** Elements whose top edge is nudged onto the rule grid. */
  snapTargets: readonly HTMLElement[];
  /**
   * The part of the sheet, measured from the top of the stage to this
   * element's bottom edge, that the plain rules leave after drawing in.
   */
  clearZone: HTMLElement | null;
}

/*
 * The wordmark is solid at rest. While the pointer is at work each letter
 * opens into a mirrored figure of its own, which turns as the pointer
 * travels; when the pointer rests, the letters close back to solid.
 */

/**
 * How many mirrors each letter's figure has. The count follows the letter's
 * own build: three for the triangle of A, four for the right angles of T and
 * H, six for the diagonals of K and N, twelve for the round C.
 */
const ORDERS: Readonly<Record<string, number>> = {
  T: 4,
  A: 3,
  R: 5,
  N: 6,
  H: 4,
  C: 12,
  K: 6,
  S: 8,
};

/**
 * Where each letter's figure starts, in wedges. 0 and 0.5 are plain polygons
 * (the second turned by half a wedge), 0.25 is a polygon of twice the sides,
 * and 0.75 is a star. A starts as upright triangles, H as upright squares,
 * C as near-circles; the rest start as stars.
 */
const STARTS: Readonly<Record<string, number>> = {
  T: 0.75,
  A: 0,
  R: 0.75,
  N: 0.75,
  H: 0.5,
  C: 0.25,
  K: 0.75,
  S: 0.75,
};

/** Radians the figures turn per CSS pixel of pointer travel. */
const TURN_PER_PIXEL = 0.0028;
/** Radians per second the figures keep turning on their own while open. */
const TURN_IDLE = 0.3;
/** The letters stay open this long after the pointer's last move or press. */
const OPEN_HOLD_MS = 420;
/** Time constants for opening and for closing back to solid. */
const OPEN_RISE_MS = 110;
const OPEN_FALL_MS = 300;

const UNIFORMS = [
  'uResolution',
  'uPitch',
  'uCentre',
  'uThin',
  'uThick',
  'uSeam',
  'uInk',
  'uInkRect',
  'uInkGain',
  'uReveal',
  'uClear',
  'uFacetCount',
  'uFacetA',
  'uFacetB',
  'uGlyphCount',
  'uOpen',
  'uIds',
  'uIdStep',
  'uGlyphA',
  'uGlyphB',
  'uFigured',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/** Rules finish drawing across the sheet. */
const REVEAL_MS = 1150;
/** The wordmark starts inking in, and how long it takes. */
const INK_DELAY_MS = 380;
const INK_MS = 950;
/** The plain rules start leaving the clear zone, and how long they take. */
const CLEAR_DELAY_MS = 1020;
const CLEAR_MS = 900;
const INTRO_MS = Math.max(REVEAL_MS, INK_DELAY_MS + INK_MS, CLEAR_DELAY_MS + CLEAR_MS);

/** Never draw more backing pixels than this, however large or dense the screen. */
const PIXEL_BUDGET = 16_000_000;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return shader;
}

/**
 * The ruled sheet behind the page: horizontal rules, the wordmark drawn into
 * them, and the whole folded into mirrored figures wherever the pointer travels.
 */
export class Field {
  /** Returns null when WebGL 2 is unavailable; the page then falls back to CSS rules. */
  static create(options: FieldOptions): Field | null {
    const gl = options.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'default',
    });
    if (!gl) return null;
    try {
      return new Field(options, gl);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly inkLines: readonly HTMLElement[];
  private readonly snapTargets: readonly HTMLElement[];
  private readonly clearZone: HTMLElement | null;
  private readonly gl: WebGL2RenderingContext;
  private readonly pool = new FacetPool();
  private readonly facetA = new Float32Array(MAX_FACETS * 4);
  private readonly facetB = new Float32Array(MAX_FACETS * 4);
  private readonly glyphA = new Float32Array(MAX_GLYPHS * 4);
  private readonly glyphB = new Float32Array(MAX_GLYPHS * 4);
  private glyphs: InkGlyph[] = [];
  /** How far the letters' figures have turned, and how far they are asked to. */
  private turn = 0;
  private turnTarget = 0;
  /** How far the letters are open: 0 solid, 1 fully figured. */
  private open = 0;
  /** When the pointer last moved or pressed. */
  private lastActive = -Infinity;
  private lastPointer: { x: number; y: number } | null = null;

  private uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  private inkTexture: WebGLTexture | null = null;
  private idTexture: WebGLTexture | null = null;

  /** Backing-store pixels per CSS pixel. */
  private scale = 1;
  /** Upper bound on `scale`; lowered if frames run slow. */
  private scaleCap = 2;
  /** Exact device-pixel size of the canvas, when the browser reports it. */
  private deviceSize: { width: number; height: number } | null = null;

  /** Bottom of the clear zone, in backing pixels from the top of the stage. */
  private clearEdge = 0;

  private frameId = 0;
  private layoutId = 0;
  private interactive = false;
  private introStart: number | null = null;
  private introDone = false;
  private slowFrames = 0;
  private lastFrame = 0;
  private lost = false;

  private constructor(options: FieldOptions, gl: WebGL2RenderingContext) {
    this.stage = options.stage;
    this.canvas = options.canvas;
    this.inkLines = options.inkLines;
    this.snapTargets = options.snapTargets;
    this.clearZone = options.clearZone;
    this.gl = gl;

    this.build();

    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.build();
      this.layout();
    });

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.devicePixelContentBoxSize?.[0];
      this.deviceSize = size ? { width: size.inlineSize, height: size.blockSize } : null;
      this.scheduleLayout();
    });
    try {
      observer.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(this.canvas);
    }
    // A web font arriving changes the wordmark without resizing anything.
    document.fonts.addEventListener('loadingdone', () => this.scheduleLayout());
    this.watchPixelRatio();
  }

  /** Re-measures when the window moves to a screen with a different pixel ratio. */
  private watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        this.scheduleLayout();
        this.watchPixelRatio();
      },
      { once: true },
    );
  }

  /** Shows the finished sheet at once, with no entrance and no pointer response. */
  show(): void {
    this.introDone = true;
    this.layout();
  }

  /** Plays the entrance, then responds to the pointer. */
  play(): void {
    this.layout();
    this.introStart = performance.now();
    this.listen();
    this.wake();
  }

  /* ---------- GL resources ---------- */

  private build(): void {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create program');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.useProgram(program);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(program, name);

    // One triangle that covers the whole viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.inkTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(this.uniforms.uInk, 0);
    this.clearInk();

    // Glyph ids are looked up texel by texel, never blended.
    this.idTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.idTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.uniform1i(this.uniforms.uIds, 1);
    gl.uniform1f(this.uniforms.uIdStep, ID_STEP);
    gl.activeTexture(gl.TEXTURE0);
  }

  private clearInk(): void {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.uniform4f(this.uniforms.uInkRect, 0, 0, 1, 1);
  }

  /* ---------- Layout: pitch, snapping, canvas size, wordmark ---------- */

  private scheduleLayout(): void {
    if (this.layoutId) return;
    this.layoutId = requestAnimationFrame(() => {
      this.layoutId = 0;
      this.layout();
    });
  }

  private layout(): void {
    if (this.lost) return;
    const gl = this.gl;
    const root = document.documentElement;
    const dpr = window.devicePixelRatio || 1;

    let box = this.stage.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    let scale = Math.min(dpr, this.scaleCap);
    const pixels = box.width * box.height * scale * scale;
    if (pixels > PIXEL_BUDGET) scale *= Math.sqrt(PIXEL_BUDGET / pixels);
    this.scale = scale;

    // Rules are a whole number of backing pixels apart and wide, so they stay
    // perfectly sharp. The exact pitch goes back to CSS for the layout to use.
    const basePitch = parseFloat(getComputedStyle(root).getPropertyValue('--pitch-base')) || 10;
    const pitch = Math.max(4, Math.round(basePitch * scale));
    const thin = Math.max(1, Math.round(scale));
    let thick = Math.round(pitch * 0.7);
    if ((thick - thin) % 2 !== 0) thick -= 1;
    const centre = Math.floor((pitch - thin) / 2) + thin / 2;
    const pitchCss = pitch / scale;
    root.style.setProperty('--pitch', `${pitchCss}px`);

    // Nudge each target so its top edge falls exactly between two rules.
    for (const target of this.snapTargets) target.style.translate = '';
    box = this.stage.getBoundingClientRect();
    const nudges = this.snapTargets.map((target) => {
      const top = target.getBoundingClientRect().top - box.top;
      return Math.round(top / pitchCss) * pitchCss - top;
    });
    this.snapTargets.forEach((target, i) => {
      target.style.translate = `0 ${nudges[i] ?? 0}px`;
    });

    // Prefer the browser's own device-pixel measurement, which is exact at
    // fractional pixel ratios. Emulated ratios can report CSS pixels here, so
    // only trust it when it agrees with the rounded size.
    let width = Math.round(box.width * scale);
    let height = Math.round(box.height * scale);
    const device = this.deviceSize;
    if (
      device &&
      scale === dpr &&
      Math.abs(device.width - width) <= 1 &&
      Math.abs(device.height - height) <= 1
    ) {
      width = device.width;
      height = device.height;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.uniform2f(this.uniforms.uResolution, width, height);
    gl.uniform1f(this.uniforms.uPitch, pitch);
    gl.uniform1f(this.uniforms.uCentre, centre);
    gl.uniform1f(this.uniforms.uThin, thin / 2);
    gl.uniform1f(this.uniforms.uThick, thick / 2);
    gl.uniform1f(this.uniforms.uSeam, 1.25 * scale);

    this.clearEdge = this.clearZone
      ? (this.clearZone.getBoundingClientRect().bottom - box.top) * scale
      : 0;

    const mask = rasteriseInk(
      this.inkLines,
      this.stage,
      scale,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    );
    if (mask) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask.canvas);
      gl.uniform4f(this.uniforms.uInkRect, mask.x, mask.y, mask.width, mask.height);
    } else {
      this.clearInk();
    }

    this.glyphs = mask ? mask.glyphs.slice(0, MAX_GLYPHS) : [];
    if (mask && this.glyphs.length > 0) {
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask.ids);
      gl.activeTexture(gl.TEXTURE0);
    }
    this.glyphs.forEach((glyph, i) => {
      this.glyphA[i * 4] = glyph.x;
      this.glyphA[i * 4 + 1] = glyph.y;
    });
    gl.uniform1i(this.uniforms.uGlyphCount, this.glyphs.length);
    if (this.glyphs.length > 0) gl.uniform4fv(this.uniforms.uGlyphA, this.glyphA);
    gl.uniform1f(this.uniforms.uFigured, pitch * 0.39);

    this.pool.unit = Math.min(1.25, Math.max(0.55, Math.min(box.width, window.innerHeight) / 900));
    this.draw(performance.now());
  }

  /* ---------- Pointer ---------- */

  private listen(): void {
    if (this.interactive) return;
    this.interactive = true;

    const at = (clientX: number, clientY: number): [number, number] => {
      const box = this.stage.getBoundingClientRect();
      return [clientX - box.left, clientY - box.top];
    };

    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        const [x, y] = at(event.clientX, event.clientY);
        this.pool.pointerMoved(x, y, performance.now(), true);
        this.travel(x, y);
        this.lastActive = performance.now();
        this.wake();
      },
      { passive: true },
    );

    window.addEventListener(
      'pointerdown',
      (event) => {
        const [x, y] = at(event.clientX, event.clientY);
        this.pool.stamp(x, y, 150 * this.pool.unit, performance.now(), 820);
        // A press holds the letters open a little longer than a passing move.
        this.lastActive = performance.now() + 500;
        this.wake();
      },
      { passive: true },
    );

    // A scrolling finger stops sending pointer events, but keeps sending touches.
    window.addEventListener(
      'touchmove',
      (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        const [x, y] = at(touch.clientX, touch.clientY);
        this.pool.pointerMoved(x, y, performance.now(), false);
        this.travel(x, y);
        this.lastActive = performance.now();
        this.wake();
      },
      { passive: true },
    );

    const leave = (): void => {
      this.pool.pointerLeft(performance.now());
      this.lastPointer = null;
    };
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
  }

  /** Pointer travel turns the letters' figures. */
  private travel(x: number, y: number): void {
    const last = this.lastPointer;
    this.lastPointer = { x, y };
    if (!last) return;
    const distance = Math.hypot(x - last.x, y - last.y);
    if (distance < 200) this.turnTarget += distance * TURN_PER_PIXEL;
  }

  /* ---------- Frames ---------- */

  private wake(): void {
    if (this.frameId || this.lost) return;
    this.lastFrame = 0;
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameId = 0;
    if (this.lost) return;

    if (this.introStart !== null && now - this.introStart >= INTRO_MS) {
      this.introStart = null;
      this.introDone = true;
      this.wink(now);
    }
    this.pool.update(now);
    const lettersBusy = this.animateLetters(now);
    this.draw(now);
    this.watchFrameRate(now);

    if (this.introStart !== null || this.pool.active || lettersBusy) {
      this.frameId = requestAnimationFrame(this.frame);
    }
  };

  /**
   * Opens the letters while the pointer is at work, closes them when it
   * rests, and keeps their figures turning. Returns whether another frame
   * is needed.
   */
  private animateLetters(now: number): boolean {
    const elapsed = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;

    const wanted = now - this.lastActive < OPEN_HOLD_MS ? 1 : 0;
    const pace = wanted > this.open ? OPEN_RISE_MS : OPEN_FALL_MS;
    this.open += (wanted - this.open) * (1 - Math.exp(-elapsed / pace));
    if (Math.abs(wanted - this.open) < 0.004) this.open = wanted;

    // The figures drift on their own while open, and ease toward wherever
    // the pointer's travel has turned them.
    this.turnTarget += (elapsed / 1000) * TURN_IDLE * this.open;
    this.turn += (this.turnTarget - this.turn) * (1 - Math.exp(-elapsed / 140));

    return this.open > 0 || wanted > 0;
  }

  /**
   * The last beat of the entrance: one fold opens over the end of the
   * wordmark and closes again. Skipped if the pointer is already at work.
   */
  private wink(now: number): void {
    const line = this.inkLines.at(-1);
    if (!line || this.pool.active) return;
    const origin = this.stage.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    this.pool.stamp(
      box.left - origin.left + box.width * 0.8,
      box.top - origin.top + box.height * 0.5,
      box.height * 0.7,
      now,
      760,
    );
  }

  /** If folding the sheet runs slow at this resolution, draw fewer pixels. */
  private watchFrameRate(now: number): void {
    const elapsed = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (!this.pool.active || elapsed === 0 || elapsed > 250) return;
    this.slowFrames = elapsed > 30 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 20 && this.scaleCap > 1) {
      this.slowFrames = 0;
      this.scaleCap = Math.max(1, this.scaleCap - 0.5);
      this.scheduleLayout();
    }
  }

  private draw(now: number): void {
    const gl = this.gl;
    const width = this.canvas.width;

    let reveal = 0;
    let inkGain = 0;
    let clear = 0;
    if (this.introDone) {
      reveal = 1;
      inkGain = 1;
      clear = 1;
    } else if (this.introStart !== null) {
      const elapsed = now - this.introStart;
      reveal = clamp01(elapsed / REVEAL_MS);
      inkGain = easeOutCubic(clamp01((elapsed - INK_DELAY_MS) / INK_MS));
      clear = clamp01((elapsed - CLEAR_DELAY_MS) / CLEAR_MS);
    }
    gl.uniform3f(this.uniforms.uReveal, reveal, width / 2, width / 2 + 2);
    gl.uniform2f(this.uniforms.uClear, this.clearEdge, clear);
    gl.uniform1f(this.uniforms.uInkGain, inkGain);

    gl.uniform1f(this.uniforms.uOpen, this.glyphs.length > 0 ? this.open : 0);
    if (this.open > 0 && this.glyphs.length > 0) {
      this.glyphs.forEach((glyph, i) => {
        const order = ORDERS[glyph.char] ?? 6;
        const wedge = (Math.PI * 2) / order;
        const start = STARTS[glyph.char] ?? 0.25;
        // Neighbours turn in opposite directions.
        const direction = i % 2 === 0 ? 1 : -1;
        this.glyphB[i * 4] = order;
        this.glyphB[i * 4 + 1] = Math.PI / 2 - wedge * start + direction * this.turn;
      });
      gl.uniform4fv(this.uniforms.uGlyphB, this.glyphB);
    }

    const count = this.pool.write(this.facetA, this.facetB, now, this.scale);
    gl.uniform1i(this.uniforms.uFacetCount, count);
    if (count > 0) {
      gl.uniform4fv(this.uniforms.uFacetA, this.facetA);
      gl.uniform4fv(this.uniforms.uFacetB, this.facetB);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
