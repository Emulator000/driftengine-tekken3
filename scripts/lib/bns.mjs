/**
 * `TEKKEN3.BNS`, the "bin stream": every model, motion, texture and sound bank the game loads,
 * back to back with no index of its own. The index is a table in the executable, eight bytes an
 * entry (a 2048-byte sector offset into the stream, and a size), found the way Tek3Ex finds it
 * (github.com/xan1242/Tek3Ex, MIT): by the instructions that load its address.
 */

/** A PS-X EXE's text, and the address it is loaded at. */
export function readExe(bytes) {
  if (bytes.toString('latin1', 0, 8) !== 'PS-X EXE') throw new Error('not a PS-X EXE');
  const address = bytes.readUInt32LE(0x18);
  const size = bytes.readUInt32LE(0x1c);
  return { address, text: bytes.subarray(0x800, 0x800 + size) };
}

/** The first offset of a pattern of hex bytes, `?` matching any. */
function find(haystack, pattern) {
  const bytes = pattern.split(' ').map((b) => (b === '?' ? -1 : parseInt(b, 16)));
  outer: for (let i = 0; i <= haystack.length - bytes.length; i += 1) {
    for (let k = 0; k < bytes.length; k += 1) {
      if (bytes[k] !== -1 && haystack[i + k] !== bytes[k]) continue outer;
    }
    return i;
  }
  throw new Error(`pattern not found: ${pattern}`);
}

/** The address a `lui` at `hi` and an `ori`/`addiu` at `lo` build together. */
function address(text, hi, lo) {
  const upper = text.readUInt32LE(hi) & 0xffff;
  const lower = text.readUInt32LE(lo) & 0xffff;
  /* addiu sign-extends its immediate; ori does not. */
  const isAddiu = text.readUInt32LE(lo) >>> 26 === 0x09;
  return ((upper << 16) + (isAddiu ? (lower << 16) >> 16 : lower)) >>> 0;
}

/**
 * The stream's table: `{ index, offset, size }` per file. The table ends where the XAS stream's
 * table begins, which is how its length is known.
 */
export function bnsTable(exe) {
  const { text, address: base } = exe;
  const at = find(text, '07 00 02 92 00 00 00 00 FD FF 40 14 ? ? 04 3C');
  const table = address(text, at + 0xc, at + 0x24);
  const xasAt = find(text, '40 18 02 00 ? ? 02 3C ? ? 42 24 21 18 62 00 21 98 83 00');
  const xasTable = address(text, xasAt + 0x14, xasAt + 0x1c);
  const count = (xasTable - table) / 8;
  if (!Number.isInteger(count) || count <= 0 || count > 0xffff) {
    throw new Error(`the table at ${table.toString(16)} and the XAS table at ${xasTable.toString(16)} do not make a count`);
  }
  const start = table - base;
  const files = [];
  for (let i = 0; i < count; i += 1) {
    files.push({ index: i, offset: text.readUInt32LE(start + i * 8) * 0x800, size: text.readUInt32LE(start + i * 8 + 4) });
  }
  return { files, tableAddress: table };
}

/** What a stream file looks like from its first bytes. */
export function kindOf(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x56414270) return 'vab';
  if (bytes.length >= 12 && bytes.toString('latin1', 8, 12) === '3DMK') return 'model';
  if (bytes.length >= 4) {
    const count = bytes.readUInt32LE(0);
    if (count > 0 && count <= 0xff && bytes.length >= 4 + count * 8) {
      let ok = true;
      for (let i = 0; i < count && ok; i += 1) {
        const offset = bytes.readUInt32LE(4 + i * 8);
        const size = bytes.readUInt32LE(8 + i * 8);
        ok = offset + size <= bytes.length && offset >= 4 + count * 8;
      }
      if (ok) return 'arc';
    }
  }
  return 'other';
}

/** The members of an ARC: a count, then an offset and a size each. */
export function arcMembers(bytes) {
  const count = bytes.readUInt32LE(0);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const offset = bytes.readUInt32LE(4 + i * 8);
    const size = bytes.readUInt32LE(8 + i * 8);
    out.push(bytes.subarray(offset, offset + size));
  }
  return out;
}
