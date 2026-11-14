/**
 * Rasterises the wordmark into a coverage mask the field can draw its
 * rules through. The DOM stays the source of truth for layout: every glyph is
 * drawn where the browser placed it, so the drawn wordmark sits exactly over
 * the (transparent) text.
 */

export interface InkGlyph {
  /** The character as drawn. */
  char: string;
  /**
   * Centre of the glyph, in backing-store pixels relative to the stage:
   * the middle of its advance, at half the cap height.
   */
  x: number;
  y: number;
}

export interface InkMask {
  canvas: HTMLCanvasElement;
  /** The area the mask covers, in backing-store pixels relative to the stage. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** One entry per drawn glyph, in reading order. */
  glyphs: InkGlyph[];
  /**
   * Same size as `canvas`: which glyph owns each pixel, as a grey level of
   * (index + 1) * ID_STEP. Each glyph is drawn slightly swollen, so every
   * pixel the glyph touches, antialiased edge included, carries a clean id.
   */
  ids: HTMLCanvasElement;
}

/** Grey levels between one glyph's id and the next. */
export const ID_STEP = 16;

/** Finds the y position of an element's first baseline, in viewport coordinates. */
function baselineOf(line: HTMLElement): number {
  const probe = document.createElement('span');
  probe.style.display = 'inline-block';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.verticalAlign = 'baseline';
  line.prepend(probe);
  const y = probe.getBoundingClientRect().bottom;
  probe.remove();
  return y;
}

/**
 * @param lines  One element per line of the wordmark, each holding a single text node.
 * @param stage  The element the field covers; positions are measured from its top left.
 * @param scale  Backing-store pixels per CSS pixel.
 * @param limit  Largest texture dimension the GPU accepts.
 */
export function rasteriseInk(
  lines: readonly HTMLElement[],
  stage: HTMLElement,
  scale: number,
  limit: number,
): InkMask | null {
  const origin = stage.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const line of lines) {
    const box = line.getBoundingClientRect();
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  if (!(right > left && bottom > top)) return null;

  // A margin of empty pixels means sampling beyond the mask reads as no ink,
  // and leaves room for glyphs that overshoot their line box.
  const margin = 24;
  const x = Math.floor((left - origin.left) * scale) - margin;
  const y = Math.floor((top - origin.top) * scale) - margin;
  const width = Math.ceil((right - left) * scale) + margin * 2;
  const height = Math.ceil((bottom - top) * scale) + margin * 2;
  if (width > limit || height > limit) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const ids = document.createElement('canvas');
  ids.width = width;
  ids.height = height;
  const idCtx = ids.getContext('2d');
  if (!idCtx) return null;
  idCtx.fillStyle = '#000';
  idCtx.fillRect(0, 0, width, height);
  idCtx.textBaseline = 'alphabetic';
  idCtx.textAlign = 'left';
  idCtx.lineJoin = 'round';
  idCtx.lineWidth = 3;

  const glyphs: InkGlyph[] = [];
  const range = document.createRange();
  for (const line of lines) {
    const node = line.firstChild;
    if (!(node instanceof Text)) continue;
    const style = getComputedStyle(line);
    const upper = style.textTransform === 'uppercase';
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * scale}px ${style.fontFamily}`;
    idCtx.font = ctx.font;

    const baseline = (baselineOf(line) - origin.top) * scale - y;
    const capHeight = ctx.measureText('H').actualBoundingBoxAscent;
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      const glyph = text.charAt(i);
      if (glyph.trim() === '') continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const box = range.getBoundingClientRect();
      const char = upper ? glyph.toUpperCase() : glyph;
      const left = (box.left - origin.left) * scale - x;
      ctx.fillText(char, left, baseline);

      const level = Math.min(255, (glyphs.length + 1) * ID_STEP);
      idCtx.fillStyle = idCtx.strokeStyle = `rgb(${level},${level},${level})`;
      idCtx.strokeText(char, left, baseline);
      idCtx.fillText(char, left, baseline);

      glyphs.push({
        char,
        x: (box.left + box.width / 2 - origin.left) * scale,
        y: y + baseline - capHeight / 2,
      });
    }
  }

  return { canvas, x, y, width, height, glyphs, ids };
}
