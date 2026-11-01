/**
 * The library of the player's own songs as `npm run music` lists it (`music/custom/library.json`):
 * each song's id (its file's name) and its title and artist; and a name as the game's menus show it.
 */

/** The library's format this game reads. */
const FORMAT = 1;

export interface LibrarySong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
}

/** The library's songs, each with an id and a title (one without is left out); none where there is no list, or one of another format. */
export function parseMusicLibrary(json: unknown): LibrarySong[] {
  if (json === null || typeof json !== 'object') return [];
  const o = json as { format?: unknown; songs?: unknown };
  if (o.format !== FORMAT || !Array.isArray(o.songs)) return [];
  return o.songs.flatMap((s: unknown) => {
    if (s === null || typeof s !== 'object') return [];
    const { id, title, artist } = s as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id) || typeof title !== 'string' || title === '') return [];
    return [{ id, title, artist: typeof artist === 'string' ? artist : '' }];
  });
}

/** A name as the game's menus show it: upper case, its spaces single, an at sign (which the fonts draw as the copyright's) spelt out. */
export const shownName = (name: string): string => name.replaceAll('@', ' at ').replace(/\s+/g, ' ').trim().toUpperCase();
