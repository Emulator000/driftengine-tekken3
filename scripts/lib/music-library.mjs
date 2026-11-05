/**
 * The library of the player's own songs, which `npm run music` makes from a folder: each song's
 * name (its tags', or its file's), its id (from its bytes, so a song keeps its place in the
 * settings whatever its file is called), and what an import of the folder adds, keeps and drops.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

/** A tag's value by its name in any case, trimmed; '' where it has none. */
const tag = (tags, name) => {
  const key = Object.keys(tags).find((k) => k.toLowerCase() === name);
  return key === undefined ? '' : String(tags[key]).trim();
};

/** A song's title and artist: its tags', or its file's name split at its first ' - ' (artist, then title), or the file's name as the title. */
export function songName(tags, file) {
  const title = tag(tags, 'title');
  const artist = tag(tags, 'artist');
  if (title !== '') return { title, artist };
  const base = path.basename(file, path.extname(file)).trim();
  const dash = base.indexOf(' - ');
  return dash < 0 ? { title: base, artist } : { title: base.slice(dash + 3).trim(), artist: artist || base.slice(0, dash).trim() };
}

/** A song's id: the first twelve hex digits of its bytes' SHA-256. */
export const libraryId = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

/**
 * What an import of a folder does to the library (`library`, its songs with their ids): the
 * songs found (`found`, each its id and path) the library lacks, added (one of the same bytes
 * found twice); those it has, kept; and those the folder no longer holds, dropped.
 */
export function plan(library, found) {
  const have = new Set(library.map((s) => s.id));
  const seen = new Set();
  const add = [];
  for (const file of found) {
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    if (!have.has(file.id)) add.push(file);
  }
  return { add, keep: library.filter((s) => seen.has(s.id)), drop: library.filter((s) => !seen.has(s.id)) };
}
