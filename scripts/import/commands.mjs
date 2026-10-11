/**
 * Each model pack's command list (`public/data/fighters/NN.cmd`, its character archive's member 4):
 * a count, then each move's name and command as strings, read into text and tokens the pause
 * menu's list sets anew. The strings' bytes:
 *
 * - `0x20` to `0x7f` a character; four pairs of them (`@#`, `^%`, `{*`, `}_`) are the halves of a
 *   circled number (1, 3, 4, 5) the font draws.
 * - `1` to `0x1f` and `0xa1` on a word, a picture of its letters on the list font's page (page 7 of
 *   the pack's own textures, placed as the first side's): read here letter by letter against the
 *   font's own glyphs (`0x80027ac0`'s font 0: 6 × 12, sixteen to a row from (0x40, 0x10), four
 *   planes of one page told apart by a bit each), its width in letters from `0x800989f7` (words 1
 *   to 0x1f) or `0x80098976` (the others).
 * - `0x80` to `0x90` a direction on the pad (0 down-back, 1 down, 2 down-forward, 3 back, 4 forward,
 *   5 up-back, 6 up, 7 up-forward, 0x10 neutral; plus 8 held).
 * - `0x91` to `0xa0` a set of buttons, a bit each (1 left punch, 2 right punch, 4 left kick, 8 right
 *   kick).
 * - `0xfb` a wide gap (what follows goes to the line's end), `0xfc` a new line, `0xfd` and `0xfe`
 *   spaces.
 *
 * A token is a run of text, `{ dir, held }` (a numpad direction, 5 neutral), `{ buttons }` (the
 * pressed ones, 1 to 4), `{ badge }` (a circled number), `{ gap: true }` or `{ line: true }`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readTimChain } from '../lib/texture.mjs';

const WORD_WIDTHS = 0x800989f7;
const WIDE_WIDTHS = 0x80098976;
/** The first side's textures are placed 0x180 halfwords right; the list font's page is 7. */
const SIDE_X = 0x180;
const PAGE_X = 7 * 64;
const GLYPH = { width: 6, height: 12, left: 0x40, top: 0x10 };
/** The pad's directions by their index, as numpad digits (5 neutral). */
const DIRECTIONS = [1, 2, 3, 4, 6, 7, 8, 9];
const NEUTRAL = 0x10;
const BADGES = new Map([
  ['@#', 1],
  ['^%', 3],
  ['{*', 4],
  ['}_', 5],
]);

/** The pack's textures placed as the first side's, one halfword a texel quad. */
function placedTextures(bytes) {
  const plane = new Uint16Array(1024 * 512);
  for (const { image } of readTimChain(bytes)) {
    if (image === null) continue;
    for (let r = 0; r < image.h; r += 1) for (let c = 0; c < image.w; c += 1) plane[((image.y + r) & 511) * 1024 + ((image.x + SIDE_X + c) & 1023)] = image.data[r * image.w + c];
  }
  return plane;
}

/** The list font's reader for one pack: its glyphs by bitmap, and its words by byte. */
function wordReader(exe, plane) {
  const bit = (u, v, p) => ((plane[v * 1024 + PAGE_X + (u >> 2)] >> ((u & 3) * 4)) >> p) & 1;
  const cell = (u, v, p) => {
    let s = '';
    for (let y = 0; y < GLYPH.height; y += 1) for (let x = 0; x < GLYPH.width; x += 1) s += bit(u + x, v + y, p);
    return s;
  };
  const glyphs = new Map();
  for (let c = 0x21; c < 0x80; c += 1) {
    const n = c - 0x20;
    const key = cell(GLYPH.left + (n & 15) * GLYPH.width, GLYPH.top + (n >> 6) * GLYPH.height, (n & 0x30) >> 4);
    if (!glyphs.has(key)) glyphs.set(key, String.fromCharCode(c));
  }
  const blank = '0'.repeat(GLYPH.width * GLYPH.height);
  const nearest = (key) => {
    let best = '';
    let distance = Infinity;
    for (const [k, c] of glyphs) {
      let d = 0;
      for (let i = 0; i < k.length; i += 1) if (k[i] !== key[i]) d += 1;
      if (d < distance) [best, distance] = [c, d];
    }
    return best;
  };
  const read = (u, v, p, letters) => {
    let s = '';
    for (let k = 0; k < letters; k += 1) {
      const key = cell(u + k * GLYPH.width, v, p);
      s += key === blank ? ' ' : (glyphs.get(key) ?? nearest(key));
    }
    return s;
  };
  return (c) => {
    if (c < 0x20) return read(GLYPH.left, GLYPH.top + ((c + 5) >> 2) * GLYPH.height, (c + 1) & 3, exe.u8(WORD_WIDTHS + c));
    if (c - 0x82 >>> 0 > 0x21) return read(0x7c, GLYPH.top + ((c - 0x9c) >> 2) * GLYPH.height, (c - 0xa4) & 3, exe.u8(WIDE_WIDTHS + c));
    return read(GLYPH.left, GLYPH.top + ((c - 0x7c) >> 2) * GLYPH.height, (c - 0x80) & 3, exe.u8(WIDE_WIDTHS + c));
  };
}

/** A string's bytes as tokens, text runs merged. */
function tokens(bytes, word) {
  const out = [];
  const text = (s) => {
    if (typeof out[out.length - 1] === 'string') out[out.length - 1] += s;
    else out.push(s);
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i];
    const pair = String.fromCharCode(c) + String.fromCharCode(bytes[i + 1] ?? 0);
    if (BADGES.has(pair)) {
      out.push({ badge: BADGES.get(pair) });
      i += 1;
    } else if (c >= 0x80 && c <= 0x90) out.push(c - 0x80 === NEUTRAL ? { dir: 5, held: false } : { dir: DIRECTIONS[(c - 0x80) & 7], held: ((c - 0x80) & 8) !== 0 });
    else if (c >= 0x91 && c <= 0xa0) {
      const n = c - 0x91;
      out.push({ buttons: [1, 2, 3, 4].filter((b) => (n >> (b - 1)) & 1) });
    } else if (c === 0xfb) out.push({ gap: true });
    else if (c === 0xfc) out.push({ line: true });
    else if (c === 0xfd || c === 0xfe) text(' ');
    else if (c < 0x20 || c > 0xa0) text(word(c));
    else text(String.fromCharCode(c));
  }
  return out;
}

/** Per model pack (by number), its moves: each a name and a command as tokens. */
export function commandTables(exe, root, packs) {
  const lists = {};
  for (const pack of packs) {
    const file = (ext) => path.join(root, `public/data/fighters/${String(pack).padStart(2, '0')}.${ext}`);
    if (!existsSync(file('cmd')) || !existsSync(file('tim'))) continue;
    const list = new Uint8Array(readFileSync(file('cmd')));
    const word = wordReader(exe, placedTextures(new Uint8Array(readFileSync(file('tim')))));
    let at = 1;
    const string = () => {
      const start = at;
      while (at < list.length && list[at] !== 0) at += 1;
      return list.subarray(start, at++);
    };
    const moves = [];
    for (let i = 0; i < list[0] && at < list.length; i += 1) moves.push({ name: tokens(string(), word), command: tokens(string(), word) });
    lists[pack] = moves;
  }
  return { lists };
}
