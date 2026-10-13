/**
 * Tekken Ball's rules page as words (`tables/ball.json`'s `rules`), read off the page's picture in
 * the beach's textures (BNS 55's first member, its TIM 0x104), so the pause menu can set them in
 * its own type: each letter's ink (its texels at index 7 or more, joined where they touch) is
 * known by a hash of its shape, the table below naming the letters each shape is; the boxed
 * title is read first, then the lines below and beside it, top to bottom, left to right, a gap of
 * three texels or more between two shapes a space.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readTimChain } from '../lib/texture.mjs';

const PAGE = 0x104;
const INK = 7;
const SPACE = 3;
/** The title's box: the only shape this wide. */
const BOX = 100;

/** Each letter shape's hash, and the letters it is. */
const LETTERS = {
  '0121b282': "o", '0498a692': "h", '0693e776': "i", '07523c87': "e", '082f79f7': "t", '09205fed': "",
  '0e3877e9': "an", '0e8f52aa': "e", '0f09c144': "i", '10057a7e': "s", '113ab264': "h", '1430b41a': "e",
  '14862a9a': "r", '14c57d03': "f", '16428c06': "o", '16b01110': "tt", '16c60229': "o", '179e04ba': "t",
  '1ac53f4f': "p", '1cbae67b': "k", '1f58e622': "t", '20e460e2': "m", '24b1c4ca': "re", '26fc1b6f': "ec",
  '27578ce5': "g", '27a67993': "a", '27f08b7b': "d", '28ce39bf': "N", '294d48e4': "T", '2af9a30a': "h",
  '2b54ca94': "t", '2b6b41b3': "o", '2cf37b14': "h", '2db61282': "c", '2ebf3f92': "h", '3057f450': "p",
  '319fc37c': "i", '36937dfb': "H", '374c4ffe': "v", '39062c62': "h", '396db1d6': "e", '39b6449f': "er",
  '3e4fb192': "b", '3ebb4b80': "i", '3ff1c930': "T", '4027c9e1': "", '40ea3b4c': "p", '41a921c5': "a",
  '41fea918': "", '42b960c7': "e", '4751e894': "s", '49d2ba8d': "E", '49f7fcc8': "'", '4a1ef3a1': "e",
  '4d19658b': "\"", '56ceb50c': "E", '580754af': "b", '5892509a': "rn", '59c0febc': "K", '5b2ca932': "r",
  '5c212f8e': "e", '5c473850': "n", '5c49db50': "b", '5cc485e5': "H", '5f9dbe3b': "LL", '612128fe': "l",
  '6420bf41': "g", '64d6008b': "i", '6ca0a785': "t", '6e264477': "E", '72817657': "c", '72d8a604': "p",
  '74c526c1': "t", '76022cf7': "w", '77af59e7': "i", '783d66df': "t", '792a293b': "t", '79c7b132': "",
  '7a8cfefa': "h", '7aa5584f': "c", '7d3f0e00': "A", '805f8fdd': "y", '816da6fe': "a", '819609ec': "t",
  '8271487c': "e", '82903737': "o", '82e249b3': "o", '8434db38': "u", '85f87706': "p", '89c133ae': "u",
  '8a6bdbfa': "i", '8b53659b': "o", '8b764a49': "e", '8da35952': "n", '8e9e9575': "a", '8ed83a3d': "a",
  '900ac2f6': "o", '91a6898d': "w", '93455ecc': "e", '94f481c7': "i", '9738407f': "l", '98cecce1': "u",
  '9b7f25e1': "r", '9e573cda': "e", 'a1146672': "n", 'a1648fb5': "a", 'a2519e4d': "w", 'a58cf5f8': "f",
  'a6214014': "o", 'a65acdf4': "n", 'a8f6daab': "s", 'a93d9173': "", 'ab9bdd4f': "e", 'ac7674e5': "r",
  'ad53968a': "o", 'b099e240': "n", 'b321bdbe': "opponen", 'b46de9b7': "o", 'b4a82e59': "l", 'b5474d87': "l",
  'b6b6b7ff': "e", 'b83c4aef': "s", 'b8f2ff1d': "h", 'b98c60d4': "w", 'b9c737da': "s", 'baf10ef1': "s",
  'bd3dbcdf': "o", 'bdeaf666': "w", 'bea47339': "a", 'bfea3647': "h", 'bff7b5f1': "t", 'c0293f1a': "i",
  'c2b0173b': "b", 'c435943a': "he", 'c4d6e721': ".", 'c6d6ea47': ".", 'c86de907': "u", 'c8d0c637': "'",
  'cad48ab8': "K", 'cb81987c': "m", 'ccb7c16b': "m", 'ce60b2af': "u", 'd173464b': "a", 'd210bf0d': "d",
  'd42b87f1': "a", 'd60aeec0': "as", 'd6b98caa': "l", 'd734b5be': "e", 'd7977b3c': "i", 'd79ee9fc': "p",
  'd829dafb': "n", 'd8674a00': "n", 'da580144': "o", 'dd784d03': "OD", 'e3005386': "i", 'e4f6d8dc': "A",
  'e7383859': "B", 'e7bbfc08': "th", 'e93b1561': "t", 'e98dbb88': "B", 'ec01ab61': "l", 'ecdd52b1': "",
  'ed73d18f': "\"", 'eee7720b': "c", 'f0262bef': "r", 'f08c4592': "i", 'f0a898f2': "k", 'f16d0822': "a",
  'f1749edb': "o", 'f1ca3088': "p", 'f48c8acc': "a", 'f5073efb': "i", 'f59eb226': "c", 'f91e633d': "M",
  'fa1e85f0': "h", 'fb3d5007': "n", 'fb872124': "h", 'fe501a07': "b", 'fe6d6520': "y", 'ff09451a': "e",
  'ff680f57': "g",
};

/** An archive's members: a count, then each member's offset and size. */
function members(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint32(0, true) }, (_, i) => bytes.subarray(view.getUint32(4 + i * 8, true), view.getUint32(4 + i * 8, true) + view.getUint32(8 + i * 8, true)));
}

/** A string's 32-bit FNV-1a hash, as eight hex digits. */
function hash(text) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The page's shapes: each a run of touching inked texels, its box and its letters. */
function shapes(ink, w, h) {
  const seen = new Uint8Array(w * h);
  const found = [];
  for (let start = 0; start < w * h; start += 1) {
    if (ink[start] < INK || seen[start]) continue;
    const points = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop();
      points.push(at);
      const [x, y] = [at % w, Math.floor(at / w)];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || w <= nx || h <= ny) continue;
          const next = ny * w + nx;
          if (ink[next] < INK || seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const xs = points.map((p) => p % w);
    const ys = points.map((p) => Math.floor(p / w));
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const key = points
      .map((p) => [(p % w) - x0, Math.floor(p / w) - y0, ink[p]])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([dx, dy, i]) => `${dx}.${dy}.${i}`)
      .join(',');
    found.push({ x0, y0, x1, y1, key });
  }
  return found;
}

/** A line's shapes read left to right, a wide gap a space. */
function readLine(line) {
  let text = '';
  let last = null;
  for (const shape of [...line].sort((a, b) => a.x0 - b.x0)) {
    const letters = LETTERS[hash(shape.key)];
    if (letters === undefined) throw new Error(`a shape on Tekken Ball's rules page at ${shape.x0}, ${shape.y0} is not one the reader knows`);
    if (letters === '') continue;
    if (last !== null && SPACE <= shape.x0 - last.x1 - 1) text += ' ';
    text += letters;
    last = shape;
  }
  return text;
}

/** The rules page's title and its words. */
export function ballRules(root) {
  const beach = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/055.bin')));
  const page = readTimChain(members(members(beach)[0])[PAGE])[0];
  const [w, h] = [page.image.w * 4, page.image.h];
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) ink[y * w + x] = (page.image.data[y * page.image.w + (x >> 2)] >> ((x & 3) * 4)) & 15;
  const all = shapes(ink, w, h);
  const box = all.find((s) => BOX <= s.x1 - s.x0);
  if (box === undefined) throw new Error("Tekken Ball's rules page has no title box");
  const inside = (s) => s !== box && s.x1 < box.x1 && box.y0 < s.y0 && s.y1 < box.y1;
  const title = readLine(all.filter(inside));
  const lines = [];
  for (const shape of all.filter((s) => s !== box && !inside(s)).sort((a, b) => a.y0 - b.y0)) {
    const line = lines.find((l) => shape.y0 <= l.y1 + 1 && l.y0 - 1 <= shape.y1);
    if (line === undefined) lines.push({ y0: shape.y0, y1: shape.y1, shapes: [shape] });
    else {
      line.y0 = Math.min(line.y0, shape.y0);
      line.y1 = Math.max(line.y1, shape.y1);
      line.shapes.push(shape);
    }
  }
  lines.sort((a, b) => a.y0 - b.y0);
  return { title, text: lines.map((l) => readLine(l.shapes)).join(' ') };
}
