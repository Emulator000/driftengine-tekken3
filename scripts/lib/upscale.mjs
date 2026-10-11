/**
 * The original pictures enlarged by edge-directed interpolation, twice the size a pass (after
 * Hyllian's Super-xBR): each original texel kept; the texel between four of them interpolated along
 * whichever diagonal the picture varies least along (a four-tap filter, sharper than a cubic),
 * blended smoothly between the two as their difference shrinks; then each texel between two of
 * them the same way across and down. Every new texel is held within its four neighbours, so edges
 * stay clean and nothing rings. Colours are premultiplied by their opacity throughout (black is
 * transparent in these pictures, and must not darken the edges it meets).
 */

/** The filters' outer taps: along a diagonal, and across or down. */
const DIAGONAL = 0.129633;
const ACROSS = 0.0875;
/** How sharply the blend turns toward the smoother direction. */
const STEER = 1.4;

const steer = (along, against) => {
  const s = (against - along) / (along + against + 1e-6);
  const k = Math.max(0, Math.min(1, 0.5 + STEER * s));
  return k * k * (3 - 2 * k);
};

/** One pass: `src` (premultiplied RGBA floats, `w` by `h`) twice the size. */
function enlarge(src, w, h) {
  const W = w * 2;
  const H = h * 2;
  const out = new Float32Array(W * H * 4);
  const Y = new Float32Array(W * H);
  /* A coordinate of the given parity kept inside the picture. */
  const fit = (v, most) => {
    while (v < 0) v += 2;
    while (v > most) v -= 2;
    return v;
  };
  const at = (x, y) => (fit(y, H - 1) * W + fit(x, W - 1)) * 4;
  const set = (x, y, c) => {
    const o = (y * W + x) * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = c[3];
    Y[y * W + x] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  };
  const lum = (x, y) => Y[fit(y, H - 1) * W + fit(x, W - 1)];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      set(x * 2, y * 2, [src[i], src[i + 1], src[i + 2], src[i + 3]]);
    }
  }
  const taps = (a, b, c, d, outer) => {
    const inner = 0.5 + outer;
    const colour = [0, 0, 0, 0];
    for (let k = 0; k < 4; k += 1) colour[k] = -outer * out[a + k] + inner * out[b + k] + inner * out[c + k] - outer * out[d + k];
    return colour;
  };
  const blendHeld = (one, two, k, held) => {
    const colour = [0, 0, 0, 0];
    for (let c = 0; c < 4; c += 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of held) {
        lo = Math.min(lo, out[n + c]);
        hi = Math.max(hi, out[n + c]);
      }
      colour[c] = Math.max(lo, Math.min(hi, one[c] * k + two[c] * (1 - k)));
    }
    return colour;
  };
  /* The texels between four originals, along the smoother diagonal. */
  for (let y = 1; y < H; y += 2) {
    for (let x = 1; x < W; x += 2) {
      let down = 0;
      let up = 0;
      for (let j = -3; j <= 1; j += 2) {
        for (let i = -3; i <= 1; i += 2) {
          const weight = i === -1 && j === -1 ? 2 : 1;
          down += weight * Math.abs(lum(x + i, y + j) - lum(x + i + 2, y + j + 2));
          up += weight * Math.abs(lum(x + i + 2, y + j) - lum(x + i, y + j + 2));
        }
      }
      const alongDown = taps(at(x - 3, y - 3), at(x - 1, y - 1), at(x + 1, y + 1), at(x + 3, y + 3), DIAGONAL);
      const alongUp = taps(at(x + 3, y - 3), at(x + 1, y - 1), at(x - 1, y + 1), at(x - 3, y + 3), DIAGONAL);
      set(x, y, blendHeld(alongDown, alongUp, steer(down, up), [at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1)]));
    }
  }
  /* The texels between two originals, across or down, whichever is smoother. */
  for (let y = 0; y < H; y += 1) {
    for (let x = (y + 1) & 1; x < W; x += 2) {
      const across =
        2 * Math.abs(lum(x - 1, y) - lum(x + 1, y)) +
        Math.abs(lum(x - 1, y - 2) - lum(x + 1, y - 2)) +
        Math.abs(lum(x - 1, y + 2) - lum(x + 1, y + 2)) +
        Math.abs(lum(x - 2, y - 1) - lum(x, y - 1)) +
        Math.abs(lum(x, y - 1) - lum(x + 2, y - 1)) +
        Math.abs(lum(x - 2, y + 1) - lum(x, y + 1)) +
        Math.abs(lum(x, y + 1) - lum(x + 2, y + 1));
      const down =
        2 * Math.abs(lum(x, y - 1) - lum(x, y + 1)) +
        Math.abs(lum(x - 2, y - 1) - lum(x - 2, y + 1)) +
        Math.abs(lum(x + 2, y - 1) - lum(x + 2, y + 1)) +
        Math.abs(lum(x - 1, y - 2) - lum(x - 1, y)) +
        Math.abs(lum(x - 1, y) - lum(x - 1, y + 2)) +
        Math.abs(lum(x + 1, y - 2) - lum(x + 1, y)) +
        Math.abs(lum(x + 1, y) - lum(x + 1, y + 2));
      const alongAcross = taps(at(x - 3, y), at(x - 1, y), at(x + 1, y), at(x + 3, y), ACROSS);
      const alongDown = taps(at(x, y - 3), at(x, y - 1), at(x, y + 1), at(x, y + 3), ACROSS);
      set(x, y, blendHeld(alongAcross, alongDown, steer(across, down), [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)]));
    }
  }
  return out;
}

/** `pixels` (RGBA bytes, `w` by `h`) enlarged `scale` times (a power of two). */
export function upscale(pixels, w, h, scale) {
  let src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const a = pixels[i * 4 + 3] / 255;
    src[i * 4] = pixels[i * 4] * a;
    src[i * 4 + 1] = pixels[i * 4 + 1] * a;
    src[i * 4 + 2] = pixels[i * 4 + 2] * a;
    src[i * 4 + 3] = a;
  }
  let [cw, ch] = [w, h];
  for (let s = 1; s < scale; s *= 2) {
    src = enlarge(src, cw, ch);
    [cw, ch] = [cw * 2, ch * 2];
  }
  const out = new Uint8Array(cw * ch * 4);
  for (let i = 0; i < cw * ch; i += 1) {
    const a = src[i * 4 + 3];
    if (a <= 1 / 512) continue;
    out[i * 4] = Math.round(Math.min(255, src[i * 4] / a));
    out[i * 4 + 1] = Math.round(Math.min(255, src[i * 4 + 1] / a));
    out[i * 4 + 2] = Math.round(Math.min(255, src[i * 4 + 2] / a));
    out[i * 4 + 3] = Math.round(Math.min(255, a * 255));
  }
  return { w: cw, h: ch, pixels: out };
}
