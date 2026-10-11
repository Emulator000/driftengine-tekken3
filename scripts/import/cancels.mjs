/**
 * The cancel tables from the executable: the shared cancel lists a moveset's lists call into
 * (12-byte entries from 0x80017c78, as far as the movesets' calls reach and on to the list's
 * return), and the motion kinds a reaction test checks a move's motion against (a pointer each from
 * 0x80095694 to a list of motion ids ended by one below 1).
 */
const SHARED = 0x80017c78;
const MOTION_KINDS = 0x80095694;
const CALL = 0xc00c;
const RETURN = 0xc00d;
const END = 0xc000;
/** The reaction test that checks a motion's kind. */
const MOTION_KIND_TEST = 0x4b;

const entryAt = (exe, at) => ({
  command: exe.u16(at),
  condition: exe.u8(at + 2),
  test: exe.u8(at + 3),
  param: exe.u16(at + 4),
  target: exe.u16(at + 6),
  type: exe.u8(at + 8),
  from: exe.u8(at + 9),
  to: exe.u8(at + 10),
  start: exe.u8(at + 11),
});

export function cancelTables(exe, files) {
  let lastCall = 0;
  let lastKind = 0;
  const look = (entry) => {
    if (entry.command === CALL) lastCall = Math.max(lastCall, entry.target);
    if (entry.test === MOTION_KIND_TEST) lastKind = Math.max(lastKind, entry.param);
  };
  for (const { bytes } of files) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = v.getUint32(4, true); at < v.getUint32(8, true); at += 12) look({ command: v.getUint16(at, true), test: v.getUint8(at + 3), param: v.getUint16(at + 4, true), target: v.getUint16(at + 6, true) });
  }
  const shared = [];
  let count = lastCall;
  while (exe.u16(SHARED + count * 12) !== RETURN && exe.u16(SHARED + count * 12) !== END) count += 1;
  for (let k = 0; k <= count; k += 1) {
    const entry = entryAt(exe, SHARED + k * 12);
    look(entry);
    shared.push(entry);
  }
  const motionKinds = Array.from({ length: lastKind + 1 }, (_, kind) => {
    const list = exe.u32(MOTION_KINDS + kind * 4);
    const ids = [];
    for (let i = 0; ; i += 1) {
      const id = exe.s16(list + i * 2);
      if (id < 1) break;
      ids.push(id);
    }
    return ids;
  });
  return { shared, motionKinds };
}
