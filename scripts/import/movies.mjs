/**
 * The movies' tables: the title's and the Theater's movie records and the endings' movie per
 * roster and costume (from the two overlays), and each movie file's place in the XA file (its first
 * and last sectors) and stream as the drive reads it (`movies/streams.json`, which the extraction
 * writes: its sectors, its frames a second, and where each frame's data ends, which times them).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { movieTables } from '../lib/str.mjs';

/** The Theater's overlay's place, its endings' captions (cues of a frame and a caption, 30 of them; nine captions' records), and the credits' lines and type. */
const THEATER = 0x800b8d58;
const CUES = 0x800b978c;
const CUE_COUNT = 30;
const CAPTIONS = 0x800b96d8;
const CAPTION_COUNT = 9;
const TITLE_LINES = 0x8010e24c;
const STAFF_LINES = 0x8010e258;
const SMALL_WIDTHS = 0x800bb918;
const LARGE_WIDTHS = 0x800bb958;
const WIDTHS = 0x5e;

export function moviesTable(root) {
  const data = (name) => readFileSync(path.join(root, 'public/data', name));
  const theater = data('bns/301.bin');
  const tables = movieTables(data('bns/010.bin'), theater);
  const streams = JSON.parse(data('movies/streams.json').toString('utf8'));
  if (streams.length !== tables.files.length) throw new Error('movies/streams.json is not of these files: run npm run extract');
  const files = streams.map((stream, i) => (stream === null ? null : { first: tables.files[i].first, last: tables.files[i].last, ...stream }));
  const at = (address) => address - THEATER;
  const cues = Array.from({ length: CUE_COUNT }, (_, i) => ({ frame: theater.readUInt16LE(at(CUES) + i * 4), caption: theater.readInt16LE(at(CUES) + i * 4 + 2) }));
  /* Each caption's record: its place on the frame (x, y), its size, its palette; its picture is the captions' sheet's, each under the one before. */
  const captions = Array.from({ length: CAPTION_COUNT }, (_, i) => {
    const r = at(CAPTIONS) + i * 20;
    return { x: theater.readUInt16LE(r + 4), y: theater.readUInt16LE(r + 6), width: theater.readUInt16LE(r + 10), height: theater.readUInt16LE(r + 12), palette: theater.readUInt16LE(r + 16) };
  });
  return { files, movies: tables.movies, titleMovies: tables.titleMovies, endings: tables.endings, cues, captions };
}

/** A C string at `address` in the Theater's overlay. */
function stringAt(theater, address) {
  let s = '';
  for (let o = address - THEATER; theater[o] !== 0; o += 1) s += String.fromCharCode(theater[o]);
  return s;
}

/** The lines of a list of pointers (a null ending it). */
function linesAt(theater, address) {
  const lines = [];
  for (let o = address - THEATER; theater.readUInt32LE(o) !== 0; o += 4) lines.push(stringAt(theater, theater.readUInt32LE(o)));
  return lines;
}

/** The credits: the title's two lines, the staff list (each line led by its kind), and the widths of the roll's small and large type from '!'. */
export function creditsTable(root) {
  const theater = readFileSync(path.join(root, 'public/data/bns/301.bin'));
  const widths = (address) => Array.from(theater.subarray(address - THEATER, address - THEATER + WIDTHS));
  return { title: linesAt(theater, TITLE_LINES), staff: linesAt(theater, STAFF_LINES), smallWidths: widths(SMALL_WIDTHS), largeWidths: widths(LARGE_WIDTHS) };
}
