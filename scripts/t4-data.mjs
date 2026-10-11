/**
 * Tekken 4 (USA, SLUS-20328) unpacked, for the Kazuya mod: the source of a character the port adds,
 * never of the port itself.
 *
 *   npm run t4 -- "<path to the .7z or .iso>"
 *
 * Writes, under .cache/t4/ and never committed: the executable, and every file of TEKKEN/DATA.BIN
 * as files/NNNN.bin by its index in the executable's table.
 *
 * The table (`TABLE`, in the executable's read-only data) holds 16 bytes a file: its first
 * sector in DATA.BIN, its size, a checksum, then its index and a key. A file of key 0 or more has
 * its first 0x400 words stored as the complement of the word less the key; the sum of all its words
 * XOR the checksum is then 0, which is checked here for every file.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract7z } from './lib/sevenzip.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.cache/t4');
const exePath = path.join(dir, 'SLUS_203.28');
const dataPath = path.join(dir, 'TEKKEN/DATA.BIN');
const filesDir = path.join(dir, 'files');

/** Where the executable's sections sit in the file: `.rodata` holds the table. */
const RODATA = { address: 0x309700, offset: 0x18a700 };
const TABLE = 0x313380;
const SECTOR = 2048;
const OBSCURED_WORDS = 0x400;

function unpackDisc(source) {
  mkdirSync(dir, { recursive: true });
  let iso = source;
  if (/\.7z$/i.test(source)) {
    extract7z(source, dir, [], 'inherit');
    const inside = readdirSync(dir).find((f) => /\.iso$/i.test(f));
    if (inside === undefined) throw new Error(`${source}: no .iso inside`);
    iso = path.join(dir, inside);
  }
  extract7z(iso, dir, ['SLUS_203.28', 'TEKKEN/DATA.BIN', 'IRX/IOPRP243.IMG'], 'inherit');
}

/** The table's entries, up to the first that is not its own index or lies past the data. */
export function fileTable(exe, sectors) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const at = TABLE - RODATA.address + RODATA.offset;
  const files = [];
  for (let i = 1; ; i += 1) {
    const e = at + i * 16;
    const sector = view.getUint32(e, true);
    const index = view.getUint16(e + 12, true);
    if (index !== i || sector >= sectors) break;
    files.push({ index, sector, size: view.getUint32(e + 4, true), checksum: view.getUint32(e + 8, true), key: view.getInt16(e + 14, true) });
  }
  return files;
}

/** A file's bytes as the game has them once loaded, and whether its checksum holds. */
export function decodeFile(bytes, file) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = bytes.byteLength >>> 2;
  if (file.key >= 0) {
    for (let i = 0; i < Math.min(words, OBSCURED_WORDS); i += 1) view.setUint32(i * 4, (~view.getUint32(i * 4, true) + file.key) >>> 0, true);
  }
  let sum = 0;
  for (let i = 0; i < words; i += 1) sum = (sum + view.getUint32(i * 4, true)) >>> 0;
  return (sum ^ file.checksum) === 0;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  if (!existsSync(dataPath)) {
    const source = process.argv[2];
    if (source === undefined) throw new Error('no Tekken 4 data yet: npm run t4 -- "<path to the .7z or .iso>"');
    unpackDisc(source);
  }
  const exe = readFileSync(exePath);
  const data = openSync(dataPath, 'r');
  const sectors = Math.floor(statSync(dataPath).size / SECTOR);
  mkdirSync(filesDir, { recursive: true });
  const files = fileTable(exe, sectors);
  let bad = 0;
  let empty = 0;
  for (const file of files) {
    /* Empty entries keep a checksum all the same; the game never loads them. */
    if (file.size === 0) {
      empty += 1;
      continue;
    }
    const bytes = new Uint8Array(file.size);
    readSync(data, bytes, 0, file.size, file.sector * SECTOR);
    if (!decodeFile(bytes, file)) bad += 1;
    writeFileSync(path.join(filesDir, `${String(file.index).padStart(4, '0')}.bin`), bytes);
  }
  closeSync(data);
  const written = files.length - empty;
  console.log(`${written} files to ${path.relative(root, filesDir)} (${empty} entries empty), ${bad === 0 ? 'every checksum holding' : `${bad} failing their checksum`}`);
}
