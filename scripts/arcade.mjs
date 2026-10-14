/**
 * Reads a dump of your own Tekken 3 arcade board (Namco System 12), for the arcade's
 * stages: optional, the PlayStation disc stays the game's source.
 *
 *   npm run arcade -- "<folder holding the dump's chip files>"
 *
 * Each data and program chip is recognised by its SHA-256, whatever its file is called; the
 * others in the folder are left alone. Writes, under .cache/ and never committed, the chips'
 * joined data (arcade/data.bin) and program (arcade/program.bin), which `npm run extract` reads.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHIP_SIZE, identifyChips, joinData, PROGRAM_CHIP_SIZE, PROGRAM_CHIPS } from './lib/arcade/board.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.cache/arcade');
const dataPath = path.join(dir, 'data.bin');
const programPath = path.join(dir, 'program.bin');
const USAGE = 'npm run arcade -- "<folder holding your board\'s dump>"';

const given = process.argv[2];
if (given === undefined) throw new Error(existsSync(dataPath) ? `the arcade data is read already (.cache/arcade/); to read it again: ${USAGE}` : `no dump given: ${USAGE}`);
if (!existsSync(given) || !statSync(given).isDirectory()) throw new Error(`${given}: not a folder; give the folder that holds your board's chip files`);

/* Only files of a chip's size are read and hashed. */
const files = (size) =>
  readdirSync(given, { withFileTypes: true })
    .filter((entry) => entry.isFile() && statSync(path.join(given, entry.name)).size === size)
    .map((entry) => ({ name: entry.name, bytes: new Uint8Array(readFileSync(path.join(given, entry.name))) }));
const data = identifyChips(files(CHIP_SIZE));
const program = identifyChips(files(PROGRAM_CHIP_SIZE), PROGRAM_CHIPS);
const missing = [...data.missing.map((c) => ({ ...c, kind: 'data' })), ...program.missing.map((c) => ({ ...c, kind: 'program' }))];
if (missing.length > 0) {
  const which = missing.map(({ kind, pair, half }) => `the ${kind} pair ${pair + 1}'s ${half === 0 ? 'even' : 'odd'} bytes`).join(', ');
  throw new Error(`${given}: ${missing.length} of the board's chips are missing or are not the supported revision's: ${which}`);
}
mkdirSync(dir, { recursive: true });
for (const [target, bytes] of [
  [dataPath, joinData(data.found)],
  [programPath, joinData(program.found, 1)],
]) {
  writeFileSync(`${target}.part`, bytes);
  renameSync(`${target}.part`, target);
}
console.log('read the arcade board\'s data into .cache/arcade/; now run npm run extract');
