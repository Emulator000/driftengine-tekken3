/**
 * The Mishimas' lightning: the heavy spark sheet Jin, Heihachi, Gon, Doctor B. and the soldiers
 * share (one file, `public/data/fighters/PP.spark` of any of them: 22 frames of 32 by 32 texels in
 * 4 bits, a blue ramp from index 0, the brightest, to 15, index 5 black), traced into strokes. Each
 * frame's lit texels are thinned to lines one texel wide (Zhang and Suen, then the staircases' inner
 * corners taken out, so only true forks branch), the lines walked into polylines between their ends
 * and forks, pieces meeting two to a texel joined, short spurs dropped, and every point given the
 * brightness about it, so the presentation can draw each frame's bolts where the sheet has them.
 */
import { readTimChain } from '../lib/texture.mjs';

const SIZE = 32;
/** Texels this bright or more are the bolts (index 0 to 4, 6 to 9, 0xa and 0xb); the dimmer ones their glow. */
const LIT = 0.09;
/** A spur this short (in texels) off a fork is the glow's ragged edge, not a bolt. */
const SPUR = 2;

const luminance = (c) => (0.2126 * (c & 31) + 0.7152 * ((c >> 5) & 31) + 0.0722 * ((c >> 10) & 31)) / 31;

/** The frames traced: per frame its strokes, each `{ points: [x, y, ...] (texels, from the top left), brightness: [...] }`. */
export function lightningFrames(bytes) {
  const tims = readTimChain(bytes);
  const palette = tims[0].clut.data;
  const levels = Array.from({ length: 16 }, (_, i) => luminance(palette[i]));
  return tims.map((tim) => {
    const light = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) light[y * SIZE + x] = levels[(tim.image.data[y * tim.image.w + (x >> 2)] >> ((x & 3) * 4)) & 15];
    return strokes(unstair(thin(light.map((v) => (v >= LIT ? 1 : 0)))), light);
  });
}

const at = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : y * SIZE + x);
/** The eight neighbours clockwise from north, as offsets. */
const AROUND = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const lit = (mask, x, y) => (at(x, y) < 0 ? 0 : mask[at(x, y)]);

/** Zhang and Suen's thinning, to lines one texel wide. */
function thin(input) {
  const mask = Uint8Array.from(input);
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      const gone = [];
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (!mask[at(x, y)]) continue;
          const n = AROUND.map(([dx, dy]) => lit(mask, x + dx, y + dy));
          const count = n.reduce((a, b) => a + b, 0);
          if (count < 2 || count > 6) continue;
          let turns = 0;
          for (let k = 0; k < 8; k += 1) if (n[k] === 0 && n[(k + 1) % 8] === 1) turns += 1;
          if (turns !== 1) continue;
          const [north, , east, , south, , west] = n;
          if (pass === 0 ? north * east * south === 0 && east * south * west === 0 : north * east * west === 0 && north * south * west === 0) gone.push(at(x, y));
        }
      }
      for (const i of gone) mask[i] = 0;
      if (gone.length > 0) changed = true;
    }
  }
  return mask;
}

/** A thinned line's staircase corners taken out: a texel whose removal leaves its neighbours joined, with two lit neighbours side by side across a corner. */
function unstair(mask) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!mask[at(x, y)]) continue;
      const n = AROUND.map(([dx, dy]) => lit(mask, x + dx, y + dy));
      let turns = 0;
      for (let k = 0; k < 8; k += 1) if (n[k] === 0 && n[(k + 1) % 8] === 1) turns += 1;
      const corner = (n[0] && n[2]) || (n[2] && n[4]) || (n[4] && n[6]) || (n[6] && n[0]);
      if (turns === 1 && corner && n.reduce((a, b) => a + b, 0) <= 3) mask[at(x, y)] = 0;
    }
  }
  return mask;
}

/** The thinned lines walked into polylines from end to fork, spurs dropped, each point's brightness the brightest texel about it. */
function strokes(mask, light) {
  const neighbours = (i) => {
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    return AROUND.map(([dx, dy]) => at(x + dx, y + dy)).filter((j) => j >= 0 && mask[j]);
  };
  const degree = (i) => neighbours(i).length;
  const used = new Set();
  const key = (a, b) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const walk = (from, next) => {
    const path = [from, next];
    used.add(key(from, next));
    let here = next;
    while (degree(here) === 2) {
      const on = neighbours(here).find((j) => !used.has(key(here, j)));
      if (on === undefined) break;
      used.add(key(here, on));
      path.push(on);
      here = on;
    }
    return path;
  };
  const paths = [];
  const starts = [...mask.keys()].filter((i) => mask[i] && degree(i) !== 2);
  for (const i of starts) for (const j of neighbours(i)) if (!used.has(key(i, j))) paths.push(walk(i, j));
  /* Loops with no end or fork. */
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) for (const j of neighbours(i)) if (!used.has(key(i, j))) paths.push(walk(i, j));
  /* A bolt three or four texels thick thins to small diamonds: of two short pieces between the same two forks one is kept, and a short loop dropped. */
  const between = new Set();
  for (let k = paths.length - 1; k >= 0; k -= 1) {
    const path = paths[k];
    const [from, to] = [path[0], path[path.length - 1]];
    if (from === to) {
      if (path.length <= 8) paths.splice(k, 1);
      continue;
    }
    if (between.has(key(from, to)) && path.length <= 5) paths.splice(k, 1);
    else between.add(key(from, to));
  }
  /* Pieces meeting two to a texel are one stroke. */
  for (let joined = true; joined; ) {
    joined = false;
    const ends = new Map();
    paths.forEach((path, k) => {
      for (const end of [path[0], path[path.length - 1]]) ends.set(end, [...(ends.get(end) ?? []), k]);
    });
    for (const [node, list] of ends) {
      if (list.length !== 2 || list[0] === list[1]) continue;
      const [a, b] = list.map((k) => paths[k]);
      const first = a[a.length - 1] === node ? a : [...a].reverse();
      const second = b[0] === node ? b : [...b].reverse();
      paths[list[0]] = [...first, ...second.slice(1)];
      paths.splice(list[1], 1);
      joined = true;
      break;
    }
  }
  const glow = (i) => {
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    let most = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (at(x + dx, y + dy) >= 0) most = Math.max(most, light[at(x + dx, y + dy)]);
    return Math.round(most * 100) / 100;
  };
  return paths
    .filter((path) => path.length > SPUR || (degree(path[0]) !== 1 && degree(path[path.length - 1]) !== 1))
    .filter((path) => path.length >= 2)
    .map((path) => ({ points: path.flatMap((i) => [(i % SIZE) + 0.5, Math.floor(i / SIZE) + 0.5]), brightness: path.map(glow) }));
}
