/**
 * Tekken Ball's tables (`tables/ball.json`), from its overlay (BNS 8, loaded at `0x800b0548`) and
 * the executable: the three balls (`0x800b5f9c`, 0x18 bytes each: its speed's unit, its lift, its
 * gravity, whether its light is squared, its back colour, the damage it does in percent, the
 * half-width of the court's middle strip); the ball's mesh (`0x800b5fe4` its 42 vertices,
 * `0x800b6134` their normals, `0x800b6284` 16 triangles, `0x800b62c4` 32 quads) and each ball's
 * eight gores' colours (`0x800b6364`, 0x40 bytes a ball); the four points its tracks run from
 * (`0x800b6344`); the select's names for the balls (`0x800b6464`), its BALL DAMAGE line and the
 * versus screen's TEKKEN BALL; the glow's cells (the executable's `0x80025720`, `0x80025504`,
 * `0x80025514`); and the pause menu's rules page, read as words (`ball-rules.mjs`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ballRules } from './ball-rules.mjs';

const OVERLAY = 0x800b0548;

export function ballTables(exe, root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/008.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - OVERLAY;
  const s16 = (address) => view.getInt16(at(address), true);
  const text = (address) => {
    let s = '';
    for (let i = at(address); overlay[i]; i += 1) s += String.fromCharCode(overlay[i]);
    return s;
  };
  const vectors = (address, count) => Array.from({ length: count }, (_, i) => [s16(address + i * 8), s16(address + i * 8 + 2), s16(address + i * 8 + 4)]);
  const cells = (address, count) => Array.from({ length: count }, (_, i) => [exe.u8(address + i * 2), exe.u8(address + i * 2 + 1)]);
  return {
    kinds: Array.from({ length: 3 }, (_, k) => {
      const row = 0x800b5f9c + k * 0x18;
      return {
        unit: s16(row),
        lift: s16(row + 4),
        gravity: s16(row + 8),
        squared: overlay[at(row + 0xc)],
        back: Array.from(overlay.subarray(at(row + 0xd), at(row + 0x10))),
        percent: s16(row + 0x10),
        strip: s16(row + 0x14),
        colours: Array.from({ length: 8 }, (_, j) => Array.from(overlay.subarray(at(0x800b6364 + k * 0x40 + j * 4), at(0x800b6364 + k * 0x40 + j * 4) + 3))),
      };
    }),
    vertices: vectors(0x800b5fe4, 0x2a),
    normals: vectors(0x800b6134, 0x2a),
    triangles: Array.from({ length: 0x10 }, (_, i) => Array.from(overlay.subarray(at(0x800b6284 + i * 4), at(0x800b6284 + i * 4) + 3))),
    quads: Array.from({ length: 0x20 }, (_, i) => Array.from(overlay.subarray(at(0x800b62c4 + i * 4), at(0x800b62c4 + i * 4) + 4))),
    tracks: vectors(0x800b6344, 4),
    names: Array.from({ length: 3 }, (_, k) => [text(view.getUint32(at(0x800b6464 + k * 8), true)), text(view.getUint32(at(0x800b6464 + k * 8 + 4), true))]),
    damage: text(0x800b0644),
    title: text(0x800b05e8).replace(/^(%[cfhvHV])+/, ''),
    glow: { spark: cells(0x80025720, 12), grow: cells(0x80025504, 8), burn: cells(0x80025514, 8) },
    rules: ballRules(root),
  };
}
