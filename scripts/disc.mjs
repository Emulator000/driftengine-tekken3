/**
 * Prepares an image of a Tekken 3 disc (USA, SLUS-00402) for the extractors.
 *
 *   npm run disc -- "<path to the .cue, or a single .bin, or a .7z holding them>"
 *
 * A cue sheet of one file a track (as many ripping tools write a disc) is joined into one image.
 * Writes, all under .cache/ and never committed:
 *   disc/tekken3.bin     the raw 2352-byte-sector image
 *   disc/tekken3.cue     its cue sheet, for the audio tracks
 *   disc/SLUS_004.02     the executable
 *   bns/NNN              every file of TEKKEN3.BNS, by its index in the executable's table
 *   bns/demoA_MM         the members of the three attract-demo archives, files 1 to 3
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { arcMembers, bnsTable, readExe } from './lib/bns.mjs';
import { fixAudioOrder } from './lib/audio-order.mjs';
import { audioTracks, cueFiles, joinedCue, parseCue } from './lib/cue.mjs';
import { openDisc } from './lib/iso.mjs';
import { extract7z } from './lib/sevenzip.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache');
const discDir = path.join(cache, 'disc');
const bin = path.join(discDir, 'tekken3.bin');
const cue = path.join(discDir, 'tekken3.cue');
const USAGE = 'npm run disc -- "<path to the .cue, or a single .bin, or a .7z holding them>"';

/** A file a cue sheet names, read beside the sheet whatever folder it was written in, in any case. */
function beside(sheetPath, name) {
  const dir = path.dirname(sheetPath);
  const base = path.basename(name.replaceAll('\\', '/'));
  const match = readdirSync(dir).find((f) => f === base) ?? readdirSync(dir).find((f) => f.toLowerCase() === base.toLowerCase());
  return path.join(dir, match ?? base);
}

/** Copies `parts` end to end into `to`. */
function join(parts, to) {
  const out = openSync(`${to}.part`, 'w');
  const chunk = Buffer.alloc(1 << 22);
  for (const part of parts) {
    const fd = openSync(part, 'r');
    for (let n; (n = readSync(fd, chunk, 0, chunk.length, null)) > 0; ) writeSync(out, chunk, 0, n);
    closeSync(fd);
  }
  closeSync(out);
  renameSync(`${to}.part`, to);
}

mkdirSync(discDir, { recursive: true });
if (!existsSync(bin)) {
  let given = process.argv[2];
  if (given === undefined) throw new Error(`no image yet: ${USAGE}`);
  if (!existsSync(given)) throw new Error(`${given}: no such file`);
  if (/\.ecm$/i.test(given)) throw new Error(`${given}: ECM-compressed images are not read; give the .cue and .bin of your disc`);
  const unpacked = path.join(discDir, 'unpacked');
  if (/\.7z$/i.test(given)) {
    rmSync(unpacked, { recursive: true, force: true });
    extract7z(given, unpacked);
    const inside = readdirSync(unpacked);
    const found = inside.find((f) => /\.cue$/i.test(f)) ?? inside.find((f) => /\.bin$/i.test(f));
    if (found === undefined) throw new Error(`${given}: no .cue or .bin inside`);
    given = path.join(unpacked, found);
  }
  if (/\.cue$/i.test(given)) {
    const sheet = cueFiles(readFileSync(given, 'latin1'));
    if (sheet.length === 0) throw new Error(`${given}: no FILE line`);
    const parts = sheet.map((file) => beside(given, file.name));
    for (const part of parts) if (!existsSync(part)) throw new Error(`${part}: no such file (named by ${given})`);
    if (parts.length > 1) console.log(`joining ${parts.length} track files`);
    join(parts, bin);
    writeFileSync(cue, joinedCue(sheet, parts.map((part) => statSync(part).size), 'tekken3.bin'));
  } else {
    copyFileSync(given, bin);
    const sheet = given.replace(/\.bin$/i, '.cue');
    if (existsSync(sheet)) copyFileSync(sheet, cue);
  }
  rmSync(unpacked, { recursive: true, force: true });
  /* Audio tracks a ripping tool wrote big-endian, put in the image's order. */
  if (existsSync(cue)) {
    const tracks = audioTracks(parseCue(readFileSync(cue, 'latin1')), statSync(bin).size / 2352);
    const swapped = fixAudioOrder(bin, tracks);
    if (swapped.length > 0) console.log(`audio track${swapped.length > 1 ? 's' : ''} ${swapped.join(', ')} read big-endian: byte order fixed`);
  }
}
if (!existsSync(cue)) console.log('no cue sheet: the audio tracks will not be extracted');

const disc = openDisc(bin);
const files = disc.list();
const fileNamed = (name) => {
  const entry = files.find((e) => e.path.endsWith(`/${name}`));
  if (entry === undefined) throw new Error(`the image has no ${name}: is it Tekken 3 USA (SLUS-00402)?`);
  return disc.read(entry);
};
const exeBytes = fileNamed('SLUS_004.02');
writeFileSync(path.join(discDir, 'SLUS_004.02'), exeBytes);

const bns = fileNamed('TEKKEN3.BNS');
const { files: table } = bnsTable(readExe(exeBytes));
const bnsDir = path.join(cache, 'bns');
mkdirSync(bnsDir, { recursive: true });
for (const f of table) writeFileSync(path.join(bnsDir, String(f.index).padStart(3, '0')), bns.subarray(f.offset, f.offset + f.size));
for (let demo = 1; demo <= 3; demo += 1) {
  const archive = bns.subarray(table[demo].offset, table[demo].offset + table[demo].size);
  arcMembers(archive).forEach((member, i) => writeFileSync(path.join(bnsDir, `demo${demo}_${String(i).padStart(2, '0')}`), member));
}
console.log(`${files.length} disc files; ${table.length} BNS files in .cache/bns/`);
