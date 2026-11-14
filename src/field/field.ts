import { rasteriseInk } from './ink.ts';
import { FRAGMENT_SOURCE, VERTEX_SOURCE } from './shader.ts';

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

const UNIFORMS = [
  'uResolution',
  'uPitch',
  'uCentre',
  'uThin',
  'uInk',
  'uInkRect',
  'uInkGain',
  'uReveal',
  'uClear',
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
 * The ruled sheet behind the page: horizontal rules with the wordmark drawn
 * into them. It moves once, for the entrance, and is still after that.
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

  private uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;

  /** Exact device-pixel size of the canvas, when the browser reports it. */
  private deviceSize: { width: number; height: number } | null = null;
  /** Bottom of the clear zone, in backing pixels from the top of the stage. */
  private clearEdge = 0;

  private frameId = 0;
  private layoutId = 0;
  private introStart: number | null = null;
  private introDone = false;
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

  /** Shows the finished sheet at once, with no entrance. */
  show(): void {
    this.introDone = true;
    this.layout();
  }

  /** Plays the entrance. */
  play(): void {
    this.layout();
    this.introStart = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
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

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(this.uniforms.uInk, 0);
    this.clearInk();
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

    let scale = Math.min(dpr, 2);
    const pixels = box.width * box.height * scale * scale;
    if (pixels > PIXEL_BUDGET) scale *= Math.sqrt(PIXEL_BUDGET / pixels);

    // Rules are a whole number of backing pixels apart and wide, so they stay
    // perfectly sharp. The exact pitch goes back to CSS for the layout to use.
    const basePitch = parseFloat(getComputedStyle(root).getPropertyValue('--pitch-base')) || 10;
    const pitch = Math.max(4, Math.round(basePitch * scale));
    const thin = Math.max(1, Math.round(scale));
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

    this.draw(performance.now());
  }

  /* ---------- Frames: only the entrance needs them ---------- */

  private readonly frame = (now: number): void => {
    this.frameId = 0;
    if (this.lost) return;

    if (this.introStart !== null && now - this.introStart >= INTRO_MS) {
      this.introStart = null;
      this.introDone = true;
    }
    this.draw(now);
    if (this.introStart !== null) this.frameId = requestAnimationFrame(this.frame);
  };

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

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
