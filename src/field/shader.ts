export const VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/*
 * The field is a sheet of horizontal rules, with the wordmark drawn into it.
 * All lengths are in backing-store pixels with the origin at the top left, so
 * a rule that is a whole number of pixels wide lands exactly on the pixel grid.
 *
 * Its one piece of motion is the entrance. The rules draw outward from the
 * vertical axis. Where the wordmark is they swell until they meet, and the
 * wordmark is solid. Above a boundary the plain rules are only passing
 * through: they leave again, and the wordmark stays on white.
 */
export const FRAGMENT_SOURCE = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uPitch;       // distance between rules
uniform float uCentre;      // offset of a rule's centre line within one pitch
uniform float uThin;        // half the width of a plain rule

uniform sampler2D uInk;     // coverage of the wordmark
uniform vec4 uInkRect;      // x, y, width, height of the area uInk covers
uniform float uInkGain;     // 0..1, how far the wordmark has inked in

uniform vec3 uReveal;       // progress 0..1, axis x, half span
uniform vec2 uClear;        // boundary y, progress 0..1 of plain rules leaving above it

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

  float plain = rule(p.y, uThin) * (1.0 - cleared(p));

  // The wordmark inks in by its rules swelling until they meet.
  float ink = texture(uInk, (p - uInkRect.xy) / uInkRect.zw).r;
  float solid = 0.5 * uPitch + 1.0;
  float body = rule(p.y, mix(uThin, solid, uInkGain)) * ink;

  float cover = max(plain, body) * revealed(p);
  fragColor = vec4(vec3(1.0 - cover), 1.0);
}
`;
