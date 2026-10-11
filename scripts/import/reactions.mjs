/**
 * The reaction tables from the executable. A hit's reaction is a row of 21 halfwords: the move ids
 * a fighter reacts with, by where the hit came from and its state, and the angles and knockback the
 * reaction takes. Rows lie 42 bytes apart from 0x80010ce8; a reaction word with its top nibble set
 * names a place in a list of halfwords at 0x800174c4 instead, whose row is the 21 halfwords from
 * there; the ball's own row is at 0x8001dec0. A move's reaction kind picks a word from the back
 * reactions (four bytes apart from 0x800177dc). Knockback reads a stream of halfwords from 0x8001075c
 * (a pair to start, then a step a frame), a launch's arc another from 0x80019d2c, and the launches
 * (0x8001a630, four bytes each: a height, then the airborne move's id).
 *
 * Only the rows, the stretch of the list and the knockback halfwords the movesets' attacks (the moves
 * with an active window, which alone can hit) can reach are written; a row a word reaches may lie far
 * past the table (back reaction kind 0 names row 3798, in the executable's code), and is what the
 * original reads there.
 */
const ROWS = 0x80010ce8;
const LIST = 0x800174c4;
const BALL = 0x8001dec0;
const BACK = 0x800177dc;
const KNOCKBACK = 0x8001075c;
const ARC = 0x80019d2c;
const LAUNCHES = 0x8001a630;
const ROW_SHORTS = 21;
/** The halfwords of a row that name knockback: by where the knockback starts in the stream. */
const KNOCKBACK_FIELDS = [15, 17, 19, 20];

export function reactionTables(exe, files) {
  const halves = (address, count) => Array.from({ length: count }, (_, i) => exe.s16(address + i * 2));
  let maxKind = 0;
  const words = new Set();
  for (const { bytes } of files) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moves = v.getUint32(8, true);
    for (let i = 0; i < v.getInt16(2, true); i += 1) {
      const move = moves + i * 0x38;
      if (v.getUint8(move + 0x2d) === 0) continue;
      words.add(v.getUint16(move + 0x32, true));
      maxKind = Math.max(maxKind, v.getUint16(move + 0x34, true));
    }
  }
  const backKinds = Array.from({ length: maxKind + 1 }, (_, k) => exe.u16(BACK + k * 4));
  /* Beside each back reaction, the reach beyond which a hit of that kind glances. */
  const backReach = Array.from({ length: maxKind + 1 }, (_, k) => exe.s16(BACK + k * 4 + 2));
  for (const w of backKinds) words.add(w);
  const rowIndices = [...words].filter((w) => (w & 0xf000) === 0).sort((a, b) => a - b);
  const listLength = Math.max(0, ...[...words].filter((w) => (w & 0xf000) !== 0).map((w) => (w & 0xfff) + ROW_SHORTS));
  const rows = rowIndices.map((index) => ({ index, values: halves(ROWS + index * ROW_SHORTS * 2, ROW_SHORTS) }));
  const list = halves(LIST, listLength);
  const ball = halves(BALL, ROW_SHORTS);
  /* A knockback walk reads its start pair and eight steps after it, a halfword a frame. */
  const knockback = new Map();
  const reach = (row) => {
    for (const f of KNOCKBACK_FIELDS) for (let i = 0; i < 2 + 8 + 1; i += 1) knockback.set(row[f] + i, exe.s16(KNOCKBACK + (row[f] + i) * 2));
  };
  rows.forEach((r) => reach(r.values));
  reach(ball);
  for (const w of words) if ((w & 0xf000) !== 0) reach(list.slice(w & 0xfff, (w & 0xfff) + ROW_SHORTS));
  return {
    rows,
    list,
    ball,
    backKinds,
    backReach,
    knockback: [...knockback].sort((a, b) => a[0] - b[0]),
    arcSteps: halves(ARC, 16),
    launches: Array.from({ length: 6 }, (_, k) => ({ height: exe.s16(LAUNCHES + k * 4), move: exe.s16(LAUNCHES + k * 4 + 2) })),
  };
}
