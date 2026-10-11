/**
 * Tekken 4's moveset (a character's kind-25 file, packed with the game's LZ). Section offsets in the
 * header count from 0x1a0, past the header and before the command list's text; links between
 * sections are indices, not offsets. The sections, by header field (each an offset and a count from
 * `0xdc`), and the size of an entry:
 *
 *   0xdc reaction lists (0x50)     0xe4 requirements (4)        0xec hit conditions (0xc)
 *   0xf4 pushbacks (0xc)           0xfc pushback data (2)       0x104 cancels (0x14)
 *   0x10c group cancels (0x14)     0x114 extra properties (8)   0x11c moves (0x34)
 *   0x124 voice clips (2)          then input sequences (8), input data (4) and tables still unread.
 */
import { unpackLz } from './lz.mjs';

const BASE = 0x1a0;
const SECTIONS = [
  ['reactions', 0x50],
  ['requirements', 4],
  ['hitConditions', 0xc],
  ['pushbacks', 0xc],
  ['pushbackData', 2],
  ['cancels', 0x14],
  ['groupCancels', 0x14],
  ['properties', 8],
  ['moves', 0x34],
  ['voices', 2],
  ['inputSequences', 8],
  ['inputData', 4],
];

export function readMoveset(packed) {
  const bytes = unpackLz(packed);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = {};
  SECTIONS.forEach(([name, size], k) => {
    const offset = view.getUint32(0xdc + k * 8, true);
    const count = view.getUint32(0xe0 + k * 8, true);
    sections[name] = { at: BASE + offset, count, size };
  });
  const entries = (name, read) => {
    const { at, count, size } = sections[name];
    return Array.from({ length: count }, (_, i) => read(at + i * size, i));
  };
  const u16 = (at) => view.getUint16(at, true);
  const s16 = (at) => view.getInt16(at, true);
  const u32 = (at) => view.getUint32(at, true);
  const aliases = Array.from({ length: 32 }, (_, i) => u32(0x14 + i * 4));
  return {
    bytes,
    aliases,
    reactions: entries('reactions', (at) => ({
      pushbacks: Array.from({ length: 7 }, (_, k) => u32(at + k * 4)),
      moves: Array.from({ length: 14 }, (_, k) => u16(at + 0x34 + k * 2)),
      raw: bytes.subarray(at + 0x1c, at + 0x34),
    })),
    requirements: entries('requirements', (at) => ({ req: u16(at), param: u16(at + 2) })),
    hitConditions: entries('hitConditions', (at) => ({ requirement: u32(at), damage: u16(at + 4), extra: u16(at + 6), reaction: u32(at + 8) })),
    pushbacks: entries('pushbacks', (at) => ({ a: u16(at), b: u16(at + 2), c: u16(at + 4), extra: u16(at + 6), data: u32(at + 8) })),
    cancels: entries('cancels', (at) => ({ command: u32(at), requirement: u32(at + 4), move: u16(at + 8), option: u16(at + 0xa), extra: u32(at + 0xc), start: bytes[at + 0x10], end: bytes[at + 0x11], frame: bytes[at + 0x12], b13: bytes[at + 0x13] })),
    groupCancels: entries('groupCancels', (at) => ({ command: u32(at), requirement: u32(at + 4), move: u16(at + 8), option: u16(at + 0xa), extra: u32(at + 0xc), start: bytes[at + 0x10], end: bytes[at + 0x11], frame: bytes[at + 0x12], b13: bytes[at + 0x13] })),
    properties: entries('properties', (at) => ({ frame: u16(at), id: u16(at + 2), value: u32(at + 4) })),
    moves: entries('moves', (at, index) => ({
      index,
      motion: u32(at),
      vulnerability: u32(at + 4),
      hitLevel: u32(at + 8),
      cancel: u32(at + 0xc),
      transition: u16(at + 0x10),
      w12: u16(at + 0x12),
      w14: u32(at + 0x14),
      hitCondition: u32(at + 0x18),
      frames: u16(at + 0x1c),
      w1e: u16(at + 0x1e),
      voice: u32(at + 0x20),
      property: u32(at + 0x24),
      hitbox: u32(at + 0x28),
      w2c: u32(at + 0x2c),
      startup: bytes[at + 0x30],
      active: bytes[at + 0x31],
      w32: s16(at + 0x32),
    })),
    voices: entries('voices', (at) => u16(at)),
    inputSequences: entries('inputSequences', (at) => ({ b0: bytes[at], b1: bytes[at + 1], w2: u16(at + 2), data: u32(at + 4) })),
    inputData: entries('inputData', (at) => ({ a: u16(at), b: u16(at + 2) })),
  };
}
