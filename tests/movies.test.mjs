/**
 * The movies' tables and streams: the STR reader on sectors made here, the title's and the
 * Theater's records and the endings' table against what the overlays hold, every file's frames
 * evenly paced at its rate, and a converted movie's frames and rate (when ffmpeg made them).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SECTOR } from '../scripts/lib/iso.mjs';
import { streamOf } from '../scripts/lib/str.mjs';
import { parseSceneTables } from '../src/assets/scenes.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenesPath = path.join(root, 'public/assets/tables/scenes.json');
const ready = existsSync(scenesPath);
const movies = () => parseSceneTables(JSON.parse(readFileSync(scenesPath, 'utf8'))).movies;

/** A video sector: the mark, its place in its frame of `count`, the frame's number and size. */
function videoSector(place, count, frame, width, height) {
  const s = Buffer.alloc(SECTOR);
  s.writeUInt32LE(0x80010160, 24);
  s.writeUInt16LE(place, 28);
  s.writeUInt16LE(count, 30);
  s.writeUInt32LE(frame, 32);
  s.writeUInt16LE(width, 40);
  s.writeUInt16LE(height, 42);
  return s;
}

test("the STR reader finds each frame's last sector, the frames' size, and the rate from their spacing", () => {
  /* Ten sectors a frame (two of them audio) is 15 frames a second at the drive's 150 sectors. */
  const sectors = [];
  for (let frame = 1; frame <= 4; frame += 1) {
    for (let place = 0; place < 8; place += 1) sectors.push(videoSector(place, 8, frame, 320, 240));
    sectors.push(Buffer.alloc(SECTOR), Buffer.alloc(SECTOR));
  }
  const stream = streamOf(Buffer.concat(sectors));
  assert.deepEqual(stream.ends, [7, 17, 27, 37]);
  assert.deepEqual([stream.width, stream.height, stream.rate], [320, 240, 15]);
});

test('the STR reader refuses frames out of order', () => {
  const sectors = [videoSector(0, 1, 1, 256, 224), videoSector(0, 1, 3, 256, 224)];
  assert.throws(() => streamOf(Buffer.concat(sectors)), /frame 3 ends where frame 2 should/);
});

test("the movies' records: the opening, the other movie, the endings and their longer cuts", { skip: !ready }, () => {
  const m = movies();
  assert.equal(m.movies.length, 26);
  assert.equal(m.titleMovies, 22);
  assert.deepEqual(m.movies[0], { file: 21, width: 256, height: 224, frames: 1942, volume: 112, flags: 3 });
  assert.deepEqual(m.movies[1], { file: 22, width: 320, height: 240, frames: 276, volume: 127, flags: 11 });
  assert.deepEqual(m.movies[1], m.movies[2]);
  /* Panda's and Gun Jack's second endings are longer cuts of Kuma's and Gun Jack's files. */
  assert.equal(m.movies[23].file, m.movies[14].file);
  assert.ok(m.movies[14].frames < m.movies[23].frames);
  assert.equal(m.movies[24].file, m.movies[19].file);
  assert.ok(m.movies[19].frames < m.movies[24].frames);
  /* Paul's ending first, Eddy's third costume Tiger's, Kuma's second Panda's; no fourth costume has one. */
  assert.deepEqual(m.endings[0], [3, 3, 3, -1]);
  assert.deepEqual(m.endings[8], [11, 11, 22, -1]);
  assert.deepEqual(m.endings[11], [14, 23, 14, -1]);
  assert.equal(m.endings.length, 21);
  for (const record of m.movies.slice(0, 25)) assert.ok(record.frames <= m.files[record.file].ends.length, `movie of file ${record.file} plays past its frames`);
});

test("every movie file's frames are evenly paced at its rate", { skip: !ready }, () => {
  const m = movies();
  assert.equal(m.files[0], null);
  for (const [i, file] of m.files.entries()) {
    if (file === null) continue;
    assert.ok(file.rate === 20 || file.rate === 15, `file ${i} at ${file.rate} frames a second`);
    const spacing = 150 / file.rate;
    file.ends.forEach((end, k) => {
      if (k === 0) return;
      const gap = end - file.ends[k - 1];
      assert.ok(Math.abs(gap - spacing) <= 1.5, `file ${i}, frame ${k + 1}: ${gap} sectors after the last`);
    });
    assert.ok(Math.abs(file.ends.at(-1) - file.ends[0] - (file.ends.length - 1) * spacing) <= 1, `file ${i} drifts`);
  }
});

const converted = path.join(root, 'public/data/movies/22.mp4');
const ffprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

test('a converted movie has its stream\'s frames at its rate', { skip: !ready || !ffprobe || !existsSync(converted) }, () => {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,r_frame_rate,width,height', '-of', 'json', converted], { encoding: 'utf8' });
  const [stream] = JSON.parse(out.stdout).streams;
  const file = movies().files[22];
  assert.equal(Number(stream.nb_frames), file.ends.length);
  assert.equal(stream.r_frame_rate, `${file.rate}/1`);
  assert.deepEqual([stream.width, stream.height], [960, 720]);
});
