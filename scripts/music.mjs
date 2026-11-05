/**
 * `npm run music -- <folder>`: the player's own songs made a library the game can play in place
 * of its music (REMAKE OPTION's MUSIC page), from a folder of them in any format FFmpeg reads (its
 * subfolders too). Each song is converted to MP3 at 44.1 kHz, its loudness brought to the game's
 * own songs' (-10.5 LUFS, their mean, its peaks under -1 dBTP), into `public/data/music/custom/`
 * with the library's list (`library.json`: each song's id, title, artist and length). Run again,
 * on the folder or with no folder (the one imported last), the library follows it: songs new to it
 * added, songs gone from it dropped, the rest left as they are. `--clear` empties the library.
 *
 * The songs are the player's own and stay on this machine, as the disc's data does.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { libraryId, plan, songName } from './lib/music-library.mjs';
import { runGently } from './lib/gentle.mjs';

/* Below the machine's other work, so a long run leaves it usable. */
runGently();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/data/music/custom');
const listFile = path.join(out, 'library.json');
/** The library's format, in its list. */
const FORMAT = 1;
/** The loudness the songs are brought to: the game's own songs' mean (LUFS), their peaks' most (dBTP), and the range allowed. */
const LOUDNESS = { integrated: -10.5, peak: -1, range: 11 };

function refuse(message) {
  console.error(message);
  process.exit(1);
}

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
if (run('ffmpeg', ['-hide_banner', '-version']).status !== 0 || run('ffprobe', ['-hide_banner', '-version']).status !== 0) refuse('npm run music needs FFmpeg (ffmpeg and ffprobe) on the PATH.');

const library = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : { format: FORMAT, folder: null, songs: [] };
const args = process.argv.slice(2);
if (args.includes('--clear')) {
  rmSync(out, { recursive: true, force: true });
  console.log('the music library is empty');
  process.exit(0);
}
const folder = args.find((a) => !a.startsWith('--')) ?? library.folder;
if (folder == null) refuse('Usage: npm run music -- <folder of your songs>   (then again with no folder to follow it, or --clear)');
const from = path.resolve(folder);
if (!existsSync(from) || !statSync(from).isDirectory()) refuse(`${from} is not a folder`);

/** Every file under `dir`, but hidden ones. */
const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []))
    .sort();

/** A file's audio as FFprobe reads it: its tags and length, or null where it holds no audio. */
function probe(file) {
  const done = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (done.status !== 0) return null;
  const info = JSON.parse(done.stdout);
  const audio = (info.streams ?? []).find((s) => s.codec_type === 'audio');
  const seconds = Number(info.format?.duration ?? audio?.duration);
  if (audio === undefined || !(seconds > 1)) return null;
  return { tags: { ...(info.format?.tags ?? {}), ...(audio.tags ?? {}) }, seconds };
}

/** A song converted: its loudness measured, then brought to the game's songs' and written as MP3. */
function convert(file, to) {
  const target = `I=${LOUDNESS.integrated}:TP=${LOUDNESS.peak}:LRA=${LOUDNESS.range}`;
  const measured = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(measured.stderr ?? '');
  if (measured.status !== 0 || json === null) return `its loudness could not be measured`;
  const m = JSON.parse(json[0]);
  const filter = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const done = run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', file, '-vn', '-map_metadata', '-1', '-af', filter, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', to]);
  return done.status === 0 ? null : (done.stderr ?? '').trim().split('\n').at(-1);
}

const found = [];
for (const file of filesUnder(from)) {
  const info = probe(file);
  if (info === null) continue;
  found.push({ id: libraryId(readFileSync(file)), path: file, ...info });
}
const { add, keep, drop } = plan(library.songs, found);
mkdirSync(out, { recursive: true });
for (const song of drop) rmSync(path.join(out, `${song.id}.mp3`), { force: true });
const added = [];
for (const [k, file] of add.entries()) {
  console.log(`(${k + 1}/${add.length}) ${path.relative(from, file.path)}`);
  const failed = convert(file.path, path.join(out, `${file.id}.mp3`));
  if (failed !== null) {
    console.warn(`  left out: ${failed}`);
    continue;
  }
  added.push({ id: file.id, ...songName(file.tags, file.path), seconds: Math.round(file.seconds * 10) / 10 });
}
const songs = [...keep, ...added].sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`));
writeFileSync(listFile, JSON.stringify({ format: FORMAT, folder: from, songs }, null, 2));
console.log(`${songs.length} songs in the music library (${added.length} added, ${drop.length} dropped); REMAKE OPTION's MUSIC page plays them`);
