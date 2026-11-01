/**
 * The player's own songs played in place of the game's music, as REMAKE OPTION's MUSIC page has
 * them (`src/sim/game/music-page.ts`): the choices kept on this device by the songs' ids, and the
 * element that plays them, its sound on the sound's CD input. Field by field it follows the game's
 * music driver: where the game plays a song the player chose another for, theirs plays from its
 * start each time the game's starts, at the game's song's gains (its fades too); in the menus'
 * silence (the title, the mode menu, the Options) the menus' choice plays, and on the MUSIC page the
 * song the entry shown plays. Online (ONLINE MODE, its waiting room, a match, a fight watched) only
 * the game's music plays.
 */
import { defaultStore, type KeyValueStore } from '@driftengine/core';
import type { LibrarySong } from '../assets/music.ts';
import { MUSIC_PAGE, MusicPlays } from '../sim/game/music-page.ts';
import { Scene, type MusicRow } from '../sim/game/state.ts';
import type { SoundPlayer } from '../present/sound/player.ts';

const KEY = 'tekken3.music';
/** What an entry is kept as: a random song, or a song's id. */
const RANDOM = 'random';
/** What `ownWanted` gives for a random song of the library (a song's own is its place in it, from 0). */
export const RANDOM_SONG = -1;
/** The scenes whose silence the menus' choice plays in. */
const MENUS: ReadonlySet<number> = new Set([Scene.TITLE, Scene.MENU, Scene.OPTIONS]);

/** The entries' choices as kept (by entry, a song's id or 'random'), put on the entries: a song gone from the library, the original. */
export function chosenFrom(rows: readonly MusicRow[], library: readonly Pick<LibrarySong, 'id'>[], kept: Readonly<Record<string, string>>): number[] {
  return rows.map((row) => {
    const value = kept[row.key];
    if (value === RANDOM && library.length > 0) return MusicPlays.RANDOM;
    const at = library.findIndex((s) => s.id === value);
    return at < 0 ? MusicPlays.ORIGINAL : MusicPlays.FIRST + at;
  });
}

/** The entries' choices as they are kept: each but those left original, by entry. */
export function keptFrom(rows: readonly MusicRow[], library: readonly Pick<LibrarySong, 'id'>[], chosen: readonly number[]): Record<string, string> {
  const kept: Record<string, string> = {};
  rows.forEach((row, i) => {
    const choice = chosen[i] ?? MusicPlays.ORIGINAL;
    if (choice === MusicPlays.RANDOM) kept[row.key] = RANDOM;
    else if (choice >= MusicPlays.FIRST && library[choice - MusicPlays.FIRST] !== undefined) kept[row.key] = library[choice - MusicPlays.FIRST]!.id;
  });
  return kept;
}

/** The choices kept in `store` (by entry), none where there are none. */
export function readKeptMusic(store: KeyValueStore = defaultStore()): Record<string, string> {
  try {
    const kept: unknown = JSON.parse(store.read(KEY) ?? 'null');
    if (kept === null || typeof kept !== 'object') return {};
    return Object.fromEntries(Object.entries(kept).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/** The choices kept in `store`, in place of what was. */
export const writeKeptMusic = (kept: Record<string, string>, store: KeyValueStore = defaultStore()): void => store.write(KEY, JSON.stringify(kept));

/** The game's songs the mixer plays the player's in place of: each entry's song not left original; none online. */
export function ownSongsOf(rows: readonly MusicRow[], chosen: readonly number[], online: boolean): number[] {
  if (online) return [];
  return rows.flatMap((row, i) => (0 <= row.song && (chosen[i] ?? MusicPlays.ORIGINAL) !== MusicPlays.ORIGINAL ? [row.song] : []));
}

/** The game as the element follows it: its scene, its Options page and the MUSIC page's entry shown, its music driver, and whether it is online. */
export interface MusicView {
  readonly scene: number;
  readonly page: number;
  readonly row?: number;
  readonly song: number;
  readonly xa: number;
  readonly starts: number;
  readonly movie: boolean;
  readonly track: number;
  readonly online: boolean;
}

/**
 * What the element plays now: an entry's choice (a library song's place, or `RANDOM_SONG`)
 * and the occasion it plays for (a new one starts it from its start), and whether it plays in the
 * menus' silence (else in place of the game's song); null for nothing.
 */
export function ownWanted(view: MusicView, rows: readonly MusicRow[], chosen: readonly number[]): { choice: number; occasion: string; menu: boolean } | null {
  if (view.online || view.movie || view.track !== 0) return null;
  const choiceOf = (row: number): number | null => {
    const choice = chosen[row] ?? MusicPlays.ORIGINAL;
    return choice === MusicPlays.ORIGINAL ? null : choice === MusicPlays.RANDOM ? RANDOM_SONG : choice - MusicPlays.FIRST;
  };
  if (0 <= view.xa) {
    const choice = choiceOf(rows.findIndex((r) => r.song === view.song));
    return choice === null ? null : { choice, occasion: `song ${view.song} ${view.starts}`, menu: false };
  }
  if (!MENUS.has(view.scene)) return null;
  if (view.scene === Scene.OPTIONS && view.page === MUSIC_PAGE && view.row !== undefined) {
    const shown = choiceOf(view.row);
    if (shown !== null && shown !== RANDOM_SONG) return { choice: shown, occasion: `preview ${shown}`, menu: true };
  }
  const menu = choiceOf(rows.findIndex((r) => r.song < 0));
  return menu === null ? null : { choice: menu, occasion: 'menu', menu: true };
}

/** The element that plays the player's own songs, its sound on the sound's CD input; each song's file fetched as it is first played. */
export class OwnMusic {
  private readonly player: SoundPlayer;
  private readonly library: readonly LibrarySong[];
  private readonly fetch: (id: string) => Promise<ArrayBuffer>;
  private readonly element: HTMLAudioElement;
  private readonly urls = new Map<string, Promise<string>>();
  /** The occasion played (null none), and what the mixer was last told. */
  private occasion: string | null = null;
  private told = '';
  /** The game as last seen, for the probe. */
  private seen: MusicView | null = null;

  constructor(player: SoundPlayer, library: readonly LibrarySong[], fetch: (id: string) => Promise<ArrayBuffer>) {
    this.player = player;
    this.library = library;
    this.fetch = fetch;
    this.element = new Audio();
    this.element.loop = true;
    player.connectMovie(this.element);
  }

  /** A field: the mixer told the songs it plays the player's in place of, and the element started, kept on or stopped as `view` wants. */
  field(view: MusicView, rows: readonly MusicRow[], chosen: readonly number[]): void {
    this.seen = view;
    const wanted = this.library.length === 0 ? null : ownWanted(view, rows, chosen);
    const songs = ownSongsOf(rows, chosen, view.online || this.library.length === 0);
    const tell = `${songs.join()} ${wanted?.menu === true}`;
    if (tell !== this.told) {
      this.told = tell;
      this.player.ownSongs(songs, wanted?.menu === true);
    }
    if (wanted === null) {
      if (this.occasion !== null) this.element.pause();
      this.occasion = null;
      return;
    }
    if (wanted.occasion === this.occasion) return;
    this.occasion = wanted.occasion;
    const index = wanted.choice === RANDOM_SONG ? Math.floor(Math.random() * this.library.length) : wanted.choice;
    const song = this.library[index];
    if (song === undefined) return;
    const occasion = wanted.occasion;
    void this.urlOf(song.id).then((url) => {
      if (this.occasion !== occasion) return;
      this.element.src = url;
      this.element.currentTime = 0;
      void this.element.play().catch(() => {});
    });
  }

  /** For the page's probe: the occasion played (null none), and the element's place in its song (seconds) and whether it is paused. */
  probe(): { occasion: string | null; time: number; paused: boolean; seen: MusicView | null } {
    return { occasion: this.occasion, time: Math.round(this.element.currentTime * 10) / 10, paused: this.element.paused, seen: this.seen };
  }

  /** A song's file as an address the element can loop over, fetched once. */
  private urlOf(id: string): Promise<string> {
    let url = this.urls.get(id);
    if (url === undefined) {
      url = this.fetch(id).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
      this.urls.set(id, url);
    }
    return url;
  }
}
