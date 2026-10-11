/**
 * The roster tables from the executable. Per roster code (roster × 4 + costume, 0x5c of them; the
 * game reads a code past them as 0x58) the record's name (its first word points to it), sound
 * character (`[8]`), moveset (`[9]`), home stage (`[10]`) and that stage's song (`[11]`) from the
 * pointers at 0x80097d40, and its model pack (0x800958c4, a signed byte, -1 none). Per roster id, a pointer
 * to its eight push spheres' radii (0x80096f60) and to its fourteen hit spheres' (0x80096ff0). Full
 * health, nine words by mode and option (0x800225ec).
 *
 * Kazuya, when extracted (`public/data/manifest.json`), takes roster 22's codes as the game reads
 * them once his mod is in: moveset 15, model pack 52 for the first two costumes, and his own sound
 * character (0x17) with his Tekken 4 voice, else Heihachi's.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PUSH_RADII = 0x80096f60;
const HIT_RADII = 0x80096ff0;
const ROWS = 22;
const ROSTER = 0x80097d40;
const CODES = 0x5c;
const PACKS = 0x800958c4;
const HEALTH = 0x800225ec;
const KAZUYA_ROSTER = 22;
const KAZUYA_MOVESET = 15;
const KAZUYA_PACK = 52;
const KAZUYA_SOUND = 0x17;
const HEIHACHI = 13;

/** A C string in the executable. */
function text(exe, at) {
  let s = '';
  for (let c = exe.u8(at); c !== 0 && s.length < 32; c = exe.u8(at + s.length)) s += String.fromCharCode(c);
  return s;
}

const radii = (exe, table, row, count) => {
  const at = exe.u32(table + row * 4);
  return Array.from({ length: count }, (_, i) => exe.s16(at + i * 2));
};

export function rosterTables(exe, root) {
  const manifestPath = path.join(root, 'public/data/manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const heihachiSound = exe.u8(exe.u32(ROSTER + HEIHACHI * 4 * 4) + 8);
  const kazuya = (code) =>
    manifest.kazuya === true && code >> 2 === KAZUYA_ROSTER
      ? { name: 'KAZUYA', sound: manifest.kazuyaVoice === true ? KAZUYA_SOUND : heihachiSound, moveset: KAZUYA_MOVESET, pack: (code & 3) < 2 ? KAZUYA_PACK : -1, stage: exe.u8(exe.u32(ROSTER + HEIHACHI * 4 * 4) + 10), song: exe.u8(exe.u32(ROSTER + HEIHACHI * 4 * 4) + 11) }
      : null;
  return {
    pushRadii: Array.from({ length: ROWS }, (_, row) => radii(exe, PUSH_RADII, row, 8)),
    hitRadii: Array.from({ length: ROWS }, (_, row) => radii(exe, HIT_RADII, row, 14)),
    codes: Array.from({ length: CODES }, (_, code) => {
      const added = kazuya(code);
      if (added !== null) return added;
      const record = exe.u32(ROSTER + code * 4);
      return { name: text(exe, exe.u32(record)), sound: exe.u8(record + 8), moveset: exe.u8(record + 9), pack: (exe.u8(PACKS + code) << 24) >> 24, stage: exe.u8(record + 10), song: exe.u8(record + 11) };
    }),
    health: Array.from({ length: 9 }, (_, i) => exe.u32(HEALTH + i * 4) | 0),
    /* An added character reads its stand-in's rows (Kazuya Heihachi's, until his own are measured). */
    standIns: manifest.kazuya === true ? [[KAZUYA_ROSTER, HEIHACHI]] : [],
  };
}
