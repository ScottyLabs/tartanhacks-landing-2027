import type { Props } from './mind.ts';
import type { Build } from './pose.ts';
import { STROKE } from './shape.ts';

/**
 * The things Bark can have with him, drawn in his own line: one weight, flat
 * ends, nothing that is not needed. Coordinates are the drawing's own, with
 * the origin on the ground under his middle, like the strokes in pose.ts.
 */

/** The scorecard: a plate on a stick, held in his mouth. */
const STICK = 232;
const PLATE = { width: 300, height: 214 };
/** How far the stick leans forward of straight up, in radians, with his head level. */
const STICK_LEAN = 0.62;
/** Height of the numerals on the plate. */
const SCORE = 146;

/** The laptop, seen from the side: a base on the ground and a lid. */
const BASE = 236;
const LID = 172;
/** The lid opens a little past upright. */
const LID_OPEN = 1.78;
/** Where the base starts, measured from his middle: just behind his forepaws. */
const BASE_STARTS = 283;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const ease = (t: number): number => t * t * (3 - 2 * t);
const n = (value: number): string => value.toFixed(1);

export interface PropDrawing {
  /** The stick from his mouth, and the plate's outline; empty when the card is away. */
  stick: string;
  plate: string;
  /** Where the score is set: centre, tilt in degrees, size, and width scale. */
  score: { x: number; y: number; tilt: number; size: number; squeeze: number };
  /** The laptop's base and lid as one line; empty when it is away. */
  laptop: string;
}

/**
 * Draws his props.
 *
 * @param props  How far out each prop is.
 * @param mouth  Where his mouth is, from the drawing.
 * @param head   How far his head is turned down, in radians: the stick turns with it.
 * @param build  His build, so the props stretch and face the way he does.
 */
export function drawProps(
  props: Props,
  mouth: { x: number; y: number },
  head: number,
  build: Build,
): PropDrawing {
  const side = build.wide >= 0 ? 1 : -1;
  const flat = Math.abs(build.wide);
  const drawing: PropDrawing = {
    stick: '',
    plate: '',
    score: { x: 0, y: 0, tilt: 0, size: 0, squeeze: flat },
    laptop: '',
  };

  if (props.card > 0.003) {
    // The card grows out of his mouth along the stick.
    const out = props.card;
    const lean = STICK_LEAN + head;
    const ux = Math.sin(lean) * build.wide;
    const uy = -Math.cos(lean) * build.tall;
    const height = PLATE.height * out;
    const reach = STICK * out + height * 0.36;
    const cx = mouth.x + ux * reach;
    const cy = mouth.y + uy * reach;
    // The plate stays nearly upright, tipped a little the way he faces.
    const tilt = side * 7 * out;
    const cos = Math.cos((tilt * Math.PI) / 180);
    const sin = Math.sin((tilt * Math.PI) / 180);
    const hw = (PLATE.width * out * flat) / 2;
    const hh = height / 2;
    const corner = (x: number, y: number): string => `${n(cx + x * cos - y * sin)},${n(cy + x * sin + y * cos)}`;
    drawing.stick = `M${n(mouth.x)},${n(mouth.y)}L${n(cx)},${n(cy)}`;
    drawing.plate = `M${corner(-hw, -hh)}L${corner(hw, -hh)}L${corner(hw, hh)}L${corner(-hw, hh)}Z`;
    drawing.score = { x: cx, y: cy, tilt, size: SCORE * out, squeeze: flat };
  }

  if (props.laptop > 0.003) {
    // The base slides out along the ground, then the lid swings up from its far end.
    const grow = ease(clamp01(props.laptop / 0.5));
    const open = ease(clamp01((props.laptop - 0.3) / 0.7)) * LID_OPEN;
    const y = (-STROKE / 2) * build.tall;
    const near = BASE_STARTS * build.wide;
    const far = (BASE_STARTS + BASE * grow) * build.wide;
    const lidX = (BASE_STARTS + BASE * grow - Math.cos(open) * LID * grow) * build.wide;
    const lidY = y - Math.sin(open) * LID * grow * build.tall;
    drawing.laptop = `M${n(near)},${n(y)}L${n(far)},${n(y)}L${n(lidX)},${n(lidY)}`;
  }

  return drawing;
}
