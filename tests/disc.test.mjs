/**
 * The disc tooling: the cue sheets, the ISO reader and the BNS index, against synthetic data and,
 * when `npm run disc` has run, against the real image.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { bigEndianAudio } from '../scripts/lib/audio-order.mjs';
import { arcMembers, bnsTable, kindOf, readExe } from '../scripts/lib/bns.mjs';
import { audioTracks, cueFiles, joinedCue, parseCue } from '../scripts/lib/cue.mjs';
import { openDisc } from '../scripts/lib/iso.mjs';

test('an ARC is told apart and split into its members', () => {
  const arc = Buffer.alloc(4 + 2 * 8 + 6);
  arc.writeUInt32LE(2, 0);
  arc.writeUInt32LE(20, 4);
  arc.writeUInt32LE(4, 8);
  arc.writeUInt32LE(24, 12);
  arc.writeUInt32LE(2, 16);
  arc.write('abcdef', 20, 'latin1');
  assert.equal(kindOf(arc), 'arc');
  assert.deepEqual(arcMembers(arc).map((m) => m.toString('latin1')), ['abcd', 'ef']);
  const model = Buffer.alloc(16);
  model.write('3DMK', 8, 'latin1');
  assert.equal(kindOf(model), 'model');
});

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = path.join(root, '.cache/disc/tekken3.bin');

test('the real image: its volume, its executable and the BNS index', { skip: !existsSync(image) && 'no image; run npm run disc' }, () => {
  const disc = openDisc(image);
  const files = disc.list();
  assert.deepEqual(
    files.map((f) => f.path),
    ['/SYSTEM.CNF', '/TEKKEN3', '/TEKKEN3/SLUS_004.02', '/TEKKEN3/TEKKEN3.BNS', '/TEKKEN3/TEKKEN3.DA', '/TEKKEN3/TEKKEN3.DMY', '/TEKKEN3/TEKKEN3.XAS'],
  );
  const exe = readExe(disc.read(files.find((f) => f.path.endsWith('SLUS_004.02'))));
  assert.equal(exe.address, 0x80010000);
  const { files: table, tableAddress } = bnsTable(exe);
  assert.equal(tableAddress, 0x80024400);
  assert.equal(table.length, 303);
  const bns = disc.read(files.find((f) => f.path.endsWith('TEKKEN3.BNS')));
  const paul = bns.subarray(table[71].offset, table[71].offset + table[71].size);
  assert.equal(kindOf(paul), 'model');
  disc.close();
});

test('a cue sheet of one file a track joins into one image with its indexes moved on', () => {
  const sheet = [
    'FILE "Game (Track 1).bin" BINARY',
    '  TRACK 01 MODE2/2352',
    '    INDEX 01 00:00:00',
    'FILE "Game (Track 2).bin" BINARY',
    '  TRACK 02 AUDIO',
    '    PREGAP 00:02:00',
    '    INDEX 01 00:00:00',
    'FILE "Game (Track 3).bin" BINARY',
    '  TRACK 03 AUDIO',
    '    INDEX 00 00:00:00',
    '    INDEX 01 00:02:00',
  ].join('\r\n');
  const files = cueFiles(sheet);
  assert.deepEqual(files.map((f) => f.name), ['Game (Track 1).bin', 'Game (Track 2).bin', 'Game (Track 3).bin']);
  const joined = joinedCue(files, [4500 * 2352, 1000 * 2352, 600 * 2352], 'game.bin');
  assert.equal(joined.split('\n')[0], 'FILE "game.bin" BINARY');
  assert.match(joined, /TRACK 02 AUDIO\n {4}PREGAP 00:02:00\n {4}INDEX 01 01:00:00/);
  assert.deepEqual(audioTracks(parseCue(joined), 6100), [
    { number: 2, start: 4500, end: 5500 },
    { number: 3, start: 5650, end: 6100 },
  ]);
});

test('a cue sheet of one file reads its name, quoted or not', () => {
  assert.deepEqual(cueFiles('FILE "C:\\GAMES\\GAME.BIN" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n').map((f) => f.name), ['C:\\GAMES\\GAME.BIN']);
  assert.deepEqual(cueFiles('FILE game.bin BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n').map((f) => f.tracks.length), [1]);
});

test('an audio track written big-endian is told from one in the image\'s order', () => {
  const samples = Buffer.alloc(44100 * 4);
  for (let i = 0; i < 44100; i += 1) {
    const v = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 44100) + 3000 * Math.sin((2 * Math.PI * 1375 * i) / 44100));
    samples.writeInt16LE(v, i * 4);
    samples.writeInt16LE(-v, i * 4 + 2);
  }
  assert.equal(bigEndianAudio(samples), false);
  assert.equal(bigEndianAudio(Buffer.from(samples).swap16()), true);
  assert.equal(bigEndianAudio(Buffer.alloc(44100 * 4)), null, 'silence tells nothing');
});
