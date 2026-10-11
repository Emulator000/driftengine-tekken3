/**
 * The game's movies: STR files at the end of `\TEKKEN3\TEKKEN3.XAS`, MDEC video frames interleaved
 * with XA audio (stereo, 37.8 kHz, one sector in eight), read at double speed. A video sector's data
 * opens with 0x80010160, then the sector's place in its frame, the frame's sectors, the frame's
 * number (from 1), and the frame's width and height.
 *
 * The title overlay (BNS 10) and the Theater's (BNS 301) each keep the files (16 bytes: first and
 * last sector in the XA file; file 0 is the music) and the movies (16 bytes: the file, a spare byte,
 * the width, height and frame count as halfwords, the volume, a spare byte, the flags, a word), the
 * tables for media 3, the CD, which the sound start sets. The Theater's movies are the title's and
 * four more. The Theater's also keeps the endings: a movie per roster and costume (4 bytes a roster).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';

import { SECTOR } from './iso.mjs';

/** Where both overlays load, and their tables: the title's files and movies, the Theater's files, movies and endings. */
const OVERLAY = 0x800b8d58;
const TITLE = { files: 0x800b981c, movies: 0x800b9c70, count: 22 };
const THEATER = { files: 0x800b8d58, movies: 0x800b91ac, count: 26, endings: 0x800b95dc, rosters: 21 };
const FILES = 23;
/** A video sector's mark, and where its header's fields lie in the sector. */
const VIDEO = 0x80010160;
const DATA = 24;
/** The drive's sectors a second, at double speed. */
export const SECTORS_PER_SECOND = 150;

/** The overlay's table of files from `at`: each `{ first, last }`, sectors in the XA file. */
function filesAt(overlay, at) {
  return Array.from({ length: FILES }, (_, i) => ({ first: overlay.readUInt32LE(at - OVERLAY + i * 16), last: overlay.readUInt32LE(at - OVERLAY + i * 16 + 4) }));
}

/** The overlay's movie records from `at`. */
function moviesAt(overlay, at, count) {
  return Array.from({ length: count }, (_, i) => {
    const o = at - OVERLAY + i * 16;
    return {
      file: overlay[o],
      width: overlay.readUInt16LE(o + 2),
      height: overlay.readUInt16LE(o + 4),
      frames: overlay.readUInt16LE(o + 6),
      volume: overlay[o + 8],
      flags: overlay.readUInt16LE(o + 10),
    };
  });
}

/**
 * Both overlays' tables (`title` BNS 10, `theater` BNS 301): the files, the Theater's movies (the
 * title's are its first 22, the same records), and the endings, a movie per roster and costume.
 * The two overlays' common records are checked to agree.
 */
export function movieTables(title, theater) {
  const files = filesAt(theater, THEATER.files);
  const movies = moviesAt(theater, THEATER.movies, THEATER.count);
  const titleFiles = filesAt(title, TITLE.files);
  const titleMovies = moviesAt(title, TITLE.movies, TITLE.count);
  if (JSON.stringify(titleFiles) !== JSON.stringify(files)) throw new Error("the title's movie files differ from the Theater's");
  if (JSON.stringify(titleMovies) !== JSON.stringify(movies.slice(0, TITLE.count))) throw new Error("the title's movies differ from the Theater's");
  const endings = Array.from({ length: THEATER.rosters }, (_, r) => Array.from({ length: 4 }, (_, c) => (theater[THEATER.endings - OVERLAY + r * 4 + c] << 24) >> 24));
  return { files, movies, titleMovies: TITLE.count, endings };
}

/** `count` raw sectors of the image from `lba`. */
export function rawSectors(imagePath, lba, count) {
  const fd = openSync(imagePath, 'r');
  try {
    const out = Buffer.alloc(count * SECTOR);
    readSync(fd, out, 0, out.length, lba * SECTOR);
    return out;
  } finally {
    closeSync(fd);
  }
}

/**
 * A movie file's stream, from its raw sectors: each frame's last sector (its index in the file,
 * frames in order from 1), the frames' size, and its rate, frames a second, from the drive's pace
 * over the frames' spacing (20 or 15 for every file on the disc).
 */
export function streamOf(raw) {
  const ends = [];
  let width = 0;
  let height = 0;
  for (let s = 0; s * SECTOR < raw.length; s += 1) {
    const at = s * SECTOR + DATA;
    if (raw.readUInt32LE(at) !== VIDEO) continue;
    const place = raw.readUInt16LE(at + 4);
    const count = raw.readUInt16LE(at + 6);
    const frame = raw.readUInt32LE(at + 8);
    width = raw.readUInt16LE(at + 16);
    height = raw.readUInt16LE(at + 18);
    if (place === count - 1) {
      if (frame !== ends.length + 1) throw new Error(`frame ${frame} ends where frame ${ends.length + 1} should`);
      ends.push(s);
    }
  }
  if (ends.length < 2) throw new Error('a movie of fewer than two frames');
  const rate = Math.round((SECTORS_PER_SECOND * (ends.length - 1)) / (ends.at(-1) - ends[0]));
  return { ends, width, height, rate };
}

/** Whether ffmpeg is there to run. */
export function haveFfmpeg() {
  return spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0;
}

let soxr;

/** The resampler for the movies' sound: SoX's where ffmpeg is built with it (not every build is), else ffmpeg's own. */
function resampler() {
  soxr ??= /--enable-libsoxr\b/.test(spawnSync('ffmpeg', ['-hide_banner', '-buildconf'], { encoding: 'utf8' }).stdout ?? '');
  return soxr ? ':resampler=soxr' : '';
}

/**
 * A movie file's raw sectors made a web video at `outPath`: ffmpeg's STR demuxer and MDEC decoder,
 * the frames timed at the stream's `rate` (the demuxer assumes 15), the 8 by 8 blocks smoothed,
 * enlarged three times (Lanczos), H.264 and its sound AAC at 44.1 kHz, in MP4 ready to stream.
 */
export function convertMovie(raw, rate, outPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'psxstr', '-i', 'pipe:0'],
      ...['-vf', `setpts=N/(${rate}*TB),deblock=block=8,scale=iw*3:ih*3:flags=lanczos,format=yuv420p`, '-r', String(rate)],
      ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-tune', 'film'],
      ...['-af', `aresample=44100${resampler()}`, '-c:a', 'aac', '-b:a', '160k'],
      ...['-movflags', '+faststart', '-f', 'mp4', outPath],
    ],
    { input: raw, maxBuffer: 1 << 26 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed on ${outPath}: ${result.stderr?.toString() ?? result.error}`);
}
