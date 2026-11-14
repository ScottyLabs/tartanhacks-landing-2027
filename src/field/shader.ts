/** The most facets the shader will fold through in one frame. */
export const MAX_FACETS = 16;

export const VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/*
 * The field is a sheet of horizontal rules. All lengths are in backing-store
 * pixels with the origin at the top left, so a rule that is a whole number of
 * pixels wide lands exactly on the pixel grid.
 *
 * Above a boundary the plain rules are only passing through: they draw in
 * with the rest of the sheet, then leave, and the wordmark's heavy rules stay
 * on white. The sheet itself is still there, and shows wherever it is folded.
 *
 * A facet is a regular polygon. Inside it, the sheet is folded: the angle
 * around the facet's centre is reflected into a single wedge, so every wedge
 * shows a mirror image of its neighbour. Facets are listed topmost first and
 * only the topmost one at a point folds it; those beneath are covered.
 */
export const FRAGMENT_SOURCE = /* glsl */ `#version 300 es
precision highp float;

#define MAX_FACETS ${MAX_FACETS}
const float TAU = 6.283185307179586;

uniform vec2 uResolution;
uniform float uPitch;       // distance between rules
uniform float uCentre;      // offset of a rule's centre line within one pitch
uniform float uThin;        // half the width of a plain rule
uniform float uThick;       // half the width of a rule where a fold shows the wordmark
uniform float uSeam;        // half the width of the cut around a facet

uniform sampler2D uInk;     // coverage of the wordmark
uniform vec4 uInkRect;      // x, y, width, height of the area uInk covers
uniform float uInkGain;     // 0..1, how far the wordmark has inked in

uniform vec3 uReveal;       // progress 0..1, axis x, half span
uniform vec2 uClear;        // boundary y, progress 0..1 of plain rules leaving above it

uniform int uFacetCount;
uniform vec4 uFacetA[MAX_FACETS];  // centre x, centre y, circumradius, order
uniform vec4 uFacetB[MAX_FACETS];  // mirror angle, source angle, drift x, drift y

out vec4 fragColor;

// Coverage of the rule nearest to height y, antialiased over one pixel.
float rule(float y, float halfWidth) {
  float d = abs(mod(y - uCentre + 0.5 * uPitch, uPitch) - 0.5 * uPitch);
  return clamp(halfWidth - d + 0.5, 0.0, 1.0);
}

// How far a point travelling outward from the vertical axis has got along
// this row, in pixels. Each row starts at its own moment.
float reach(vec2 p, float progress) {
  float row = floor(p.y / uPitch);
  float delay = fract(sin(row * 12.9898) * 43758.5453) * 0.42;
  float t = clamp(progress * 1.42 - delay, 0.0, 1.0);
  return (1.0 - pow(1.0 - t, 3.0)) * uReveal.z;
}

// Rules draw outward from the axis: a row shows as far as its head has reached.
float revealed(vec2 p) {
  if (uReveal.x >= 1.0) return 1.0;
  return clamp(reach(p, uReveal.x) - abs(p.x - uReveal.y) + 0.5, 0.0, 1.0);
}

// Above the boundary a plain rule's tail follows its head out to the edges,
// so the rule leaves the way it came. Returns how much of it is gone.
float cleared(vec2 p) {
  if (p.y >= uClear.x || uClear.y <= 0.0) return 0.0;
  if (uClear.y >= 1.0) return 1.0;
  return clamp(reach(p, uClear.y) - abs(p.x - uReveal.y) + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 q = p;
  float seam = 0.0;
  bool folded = false;

  for (int i = 0; i < MAX_FACETS; i++) {
    if (i >= uFacetCount) break;
    vec4 a = uFacetA[i];
    vec2 v = q - a.xy;
    float r = length(v);
    if (r > a.z + uSeam + 1.0) continue;

    vec4 b = uFacetB[i];
    float wedge = TAU / a.w;
    float theta = abs(mod(atan(v.y, v.x) - b.x, wedge) - 0.5 * wedge);

    // Signed distance to the polygon's edge; positive inside.
    float inside = a.z * cos(0.5 * wedge) - r * cos(theta);
    seam = max(seam, clamp(uSeam - abs(inside) + 0.5, 0.0, 1.0));
    if (inside <= 0.0) continue;

    float s = theta + b.y;
    q = a.xy + r * vec2(cos(s), sin(s)) + b.zw;
    folded = true;
    break;
  }

  // A fold always shows the whole sheet; elsewhere the plain rules may have left.
  float plain = rule(q.y, uThin);
  if (!folded) plain *= 1.0 - cleared(p);

  // The wordmark inks in by its rules swelling. On the sheet as it lies they
  // swell until they meet, and the wordmark is solid. Seen through a fold they
  // stop short, so a fold is made of lines and nothing else.
  float ink = texture(uInk, (q - uInkRect.xy) / uInkRect.zw).r;
  float heavy = folded ? uThick : 0.5 * uPitch + 1.0;
  float cover = max(plain, rule(q.y, mix(uThin, heavy, uInkGain)) * ink);
  cover *= revealed(p) * (1.0 - seam);

  fragColor = vec4(vec3(1.0 - cover), 1.0);
}
`;
