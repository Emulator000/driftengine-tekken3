/**
 * "KAZUYA" in the lettering of Tekken 3's fight names: the picture each character's textures carry
 * (the second TIM of its texture chain, 4-bit, 16 lines, no palette of its own: the HUD lays the
 * costume's on it). Letters are cut from the disc's names (K, U and A from KUMA, Y from YOSHIMITSU)
 * between the outline columns they share; Tekken 3 spells no name with a Z, so the Z is drawn in the
 * same hand: a core of 1, soft edges 4 to 7, an outline of 10.
 */

const HEIGHT = 16;
/** The name's place in a fighter's texture area (halfwords across, lines down). */
const PLACE = [80, 0];

/** The name picture of a texture chain: its width in pixels and a value per pixel, row by row. */
export function readName(chain) {
  const view = new DataView(chain.buffer, chain.byteOffset, chain.byteLength);
  let at = 0;
  for (let k = 0; view.getUint32(at, true) === 0x10; k += 1) {
    let p = at + 8;
    if ((view.getUint32(at + 4, true) & 8) !== 0) p += view.getUint32(p, true);
    const length = view.getUint32(p, true);
    const w = view.getUint16(p + 8, true) * 4;
    const h = view.getUint16(p + 10, true);
    if (k === 1) {
      const pixels = new Uint8Array(w * h);
      for (let i = 0; i < (w * h) / 2; i += 1) {
        const byte = chain[p + 12 + i];
        pixels[i * 2] = byte & 0xf;
        pixels[i * 2 + 1] = byte >> 4;
      }
      return { width: w, pixels };
    }
    at = p + length;
  }
  throw new Error('no name picture in the texture chain');
}

/** Columns `from` to `to` (inclusive) of a name picture. */
function cut(name, from, to) {
  const width = to - from + 1;
  const pixels = new Uint8Array(width * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < width; x += 1) pixels[y * width + x] = name.pixels[y * name.width + from + x];
  return { width, pixels };
}

/**
 * A Z, nine columns: a bar along the top and the bottom and a stroke between them from the top's
 * right to the bottom's left, soft at its sides, outlined all round.
 */
function drawZ() {
  const width = 9;
  const core = (x, y) => {
    if (y === 0 || y === 15) return Infinity;
    if (y <= 2 || y >= 13) return x >= 1 && x <= 7 ? 0 : Infinity;
    const centre = 6.5 - (y - 3) * 0.5;
    return Math.max(0, Math.abs(x - centre) - 1);
  };
  const pixels = new Uint8Array(width * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = core(x, y);
      pixels[y * width + x] = d === 0 ? 1 : d <= 0.5 ? 4 : d <= 1 ? 7 : 0;
    }
  }
  /* The outline: every empty pixel next to the letter, the top and bottom rows whole. */
  const filled = Uint8Array.from(pixels);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (filled[y * width + x] !== 0) continue;
      let near = y === 0 || y === 15;
      for (let dy = -1; dy <= 1 && !near; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < HEIGHT && filled[ny * width + nx] !== 0) near = true;
        }
      }
      if (near) pixels[y * width + x] = 10;
    }
  }
  return { width, pixels };
}

/** Letters side by side, each sharing its first column with the last's: where both draw, the darker. */
function join(letters) {
  const width = letters.reduce((sum, l) => sum + l.width, 0) - (letters.length - 1);
  const pixels = new Uint8Array(width * HEIGHT);
  let left = 0;
  for (const l of letters) {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < l.width; x += 1) {
        const v = l.pixels[y * l.width + x];
        const at = y * width + left + x;
        if (v !== 0 && (pixels[at] === 0 || v < pixels[at])) pixels[at] = v;
      }
    }
    left += l.width - 1;
  }
  return { width, pixels };
}

/** KAZUYA from KUMA's and YOSHIMITSU's name pictures (their texture chains). */
export function kazuyaName(kumaChain, yoshimitsuChain) {
  const kuma = readName(kumaChain);
  const yoshimitsu = readName(yoshimitsuChain);
  const k = cut(kuma, 0, 8);
  const u = cut(kuma, 8, 16);
  const a = cut(kuma, 26, 35);
  const y = cut(yoshimitsu, 0, 9);
  return join([k, a, drawZ(), u, y, a]);
}

/** A texture chain with its name picture replaced (4-bit, no palette, at the name's place); the width is padded to whole halfwords. */
export function withName(chain, name) {
  const view = new DataView(chain.buffer, chain.byteOffset, chain.byteLength);
  const spans = [];
  for (let at = 0; at < chain.length && view.getUint32(at, true) === 0x10; ) {
    let p = at + 8;
    if ((view.getUint32(at + 4, true) & 8) !== 0) p += view.getUint32(p, true);
    const end = p + view.getUint32(p, true);
    spans.push([at, end]);
    at = end;
  }
  const halfwords = Math.ceil(name.width / 4);
  const tim = new Uint8Array(8 + 12 + halfwords * 2 * HEIGHT);
  const timView = new DataView(tim.buffer);
  timView.setUint32(0, 0x10, true);
  timView.setUint32(4, 0, true);
  timView.setUint32(8, 12 + halfwords * 2 * HEIGHT, true);
  timView.setUint16(12, PLACE[0], true);
  timView.setUint16(14, PLACE[1], true);
  timView.setUint16(16, halfwords, true);
  timView.setUint16(18, HEIGHT, true);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < halfwords * 4; x += 2) {
      const at = (v) => (v < name.width ? name.pixels[y * name.width + v] : 0);
      tim[20 + y * halfwords * 2 + x / 2] = at(x) | (at(x + 1) << 4);
    }
  }
  const before = chain.subarray(0, spans[1][0]);
  const after = chain.subarray(spans[1][1]);
  const out = new Uint8Array(before.length + tim.length + after.length);
  out.set(before);
  out.set(tim, before.length);
  out.set(after, before.length + tim.length);
  return out;
}
