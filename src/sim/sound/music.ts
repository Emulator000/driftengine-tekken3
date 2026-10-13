/**
 * The game's music driver, kept by the simulation (which asks it whether a song is still to be
 * heard and whether a movie plays) and run alike by the presentation (which plays what it says):
 * a song's pick by the music set (its XA song or the disc's audio track, its volume, whether it
 * loops), its volume faded a frame at a time, `next` readying a song to play when asked for
 * without, the same song asked for again only brought back up, the win's fade to silence, and the
 * drive's mixing (in stereo each side to its own, else each at 80% into both). A song is silent
 * until the frame after it starts, when the drive has begun reading it. Its place is the drive's:
 * its first sector plus eight (the channels' interleave) for each of its sectors played, a field
 * playing 630 of its frames (735 of the chip's samples, seven for every six) of a sector's 2016;
 * reaching its end sector it starts over when its pick loops, else stops. An audio track plays
 * until the drive reports it over (its 588 samples a sector played through). (The game also keeps
 * a stopped song's place to start from next time, when asked to, and nothing asks.)
 *
 * A movie sets the song's volume to its own and puts the driver in its movie states (5 and 6: only
 * the fade steps), its sound the drive's, mixed at the driver's volume like a song's; the opening
 * ends with the driver reading on (state 7) through its file's span, the drive's place counted in
 * fields from the movie's read at 150 sectors a second, stopping past its end.
 *
 * Time comes in two steps: `musicTick` each field (the drive reads on), `musicFrame` each frame
 * the game runs (the driver's own step, which a frame's waits put off); commands in their order.
 */
import type { SoundCommand } from '../fight/voices.ts';

/** A song's pick: its XA song (or with `track` the disc's audio track), its volume (of 127), whether it loops. */
export interface SongPick {
  readonly xa: number;
  readonly track: boolean;
  readonly volume: number;
  readonly loops: boolean;
}

/**
 * Each song's picks (the arrangement's, then the arcade's), each XA song's first and end sectors
 * on the disc, each audio track's sectors, the music set (0 the arrangement, 1 the arcade's) and
 * stereo as the game powers on (the game tells the driver when its options change them), and the
 * music's volume option (of 127).
 */
export interface MusicTables {
  readonly picks: readonly (readonly [SongPick, SongPick])[];
  readonly xaSongs: readonly { readonly first: number; readonly end: number }[];
  readonly tracks: readonly { readonly track: number; readonly sectors: number }[];
  readonly set: number;
  readonly stereo: number;
  readonly volume: number;
}

/** The driver's states: stopped, an XA song playing, fading out after a win, an audio track, a movie (5 and 6), the drive reading on through a span. */
export const MusicMode = { STOPPED: 1, PLAYING: 2, FADING_OUT: 3, TRACK: 4, MOVIE: 5, MOVIE_HELD: 6, READ_ON: 7 } as const;
/** Whether the drive has the song: 0 an XA song not yet heard, 1 heard, 2 a track not yet heard, 3 heard, 4 nothing to hear. */
const Starting = { WAITING: 0, HEARD: 1, TRACK_WAITING: 2, TRACK_HEARD: 3, NONE: 4 } as const;

const div = (a: number, b: number): number => Math.trunc(a / b);
/** The song's frames a field plays, a sector's frames, and the disc's sectors one of the song's stands for. */
const FRAMES_PER_FIELD = 630;
const FRAMES_PER_SECTOR = 2016;
const INTERLEAVE = 8;
/** The drive's sectors a field, at double speed; an audio track's samples a sector, and the chip's a field. */
const SECTORS_PER_FIELD = 2.5;
const TRACK_SAMPLES_PER_SECTOR = 588;
const SAMPLES_PER_FIELD = 735;
/** The frames a song asked for has to be heard before the driver gives up on it. */
const STARTING_TIME = 600;

/** The driver's records. */
export interface MusicState {
  /** The song playing (its number, -1 none), its XA song, the times it started from its start (for the player to seek it), whether it loops, the fields it has played. */
  song: number;
  xa: number;
  starts: number;
  loops: boolean;
  played: number;
  /** The audio track playing (0 none), the fields since the drive began playing it. */
  track: number;
  trackFields: number;
  mode: number;
  starting: number;
  /** Frames left for the song asked for to be heard. */
  stopTime: number;
  /** Whether a movie plays (set with the driver's movie states, cleared as a song plays or the music stops). */
  movie: number;
  songVolume: number;
  volume: number;
  fadeFrom: number;
  fadeTo: number;
  fadeFrames: number;
  fadeLeft: number;
  /** A movie's file the drive reads (its sector, -1 none) and the fields since; the span the driver reads on through (its place, its end). */
  movieFrom: number;
  movieFields: number;
  spanPlace: number;
  spanEnd: number;
  /** The music's options as the game last told them (null: as the tables have them at power-on): the set songs pick from (-1 none) and stereo. */
  options: { readonly set: number; readonly stereo: number } | null;
}

/** The driver at power-on: nothing playing, the volume up (the option at its full 127, as the driver sets it). */
export function newMusic(): MusicState {
  const m: MusicState = {
    song: -1,
    xa: -1,
    starts: 0,
    loops: false,
    played: 0,
    track: 0,
    trackFields: 0,
    mode: MusicMode.STOPPED,
    starting: Starting.NONE,
    stopTime: -1,
    movie: 0,
    songVolume: 0x7f,
    volume: 0x7f,
    fadeFrom: 0,
    fadeTo: 0,
    fadeFrames: 0,
    fadeLeft: 0,
    movieFrom: -1,
    movieFields: 0,
    spanPlace: 0,
    spanEnd: 0,
    options: null,
  };
  setVolume(m, { volume: 0x7f }, 0x7f, -1);
  return m;
}

/** The music to `volume` over `frames` (at once for none), from the current volume scaled a second time by the song's and the option's, as the game computes it. */
function setVolume(m: MusicState, tables: Pick<MusicTables, 'volume'>, volume: number, frames: number): void {
  const scale = (v: number): number => div(v * m.songVolume * tables.volume, 0x3f01);
  m.fadeFrames = frames;
  m.fadeTo = scale(volume);
  let from = scale(m.volume);
  m.fadeLeft = frames;
  if (frames < 1) {
    m.volume = m.fadeTo;
    from = m.fadeTo;
  }
  m.fadeFrom = from;
}

/** The song heard once the drive has it (at its target volume), then the fade a step on. */
function stepFade(m: MusicState): void {
  if (m.starting === Starting.WAITING || m.starting === Starting.TRACK_WAITING) {
    m.starting += 1;
    m.volume = m.fadeTo;
  }
  if (0 < m.fadeLeft) {
    m.fadeLeft = Math.max(0, m.fadeLeft - 1);
    m.volume = div((m.fadeFrom - m.fadeTo) * m.fadeLeft, m.fadeFrames) + m.fadeTo;
  }
}

/** The music stopped, as the game's driver stops it: with no song and no movie's state, nothing to do. */
function stop(m: MusicState, tables: MusicTables): void {
  m.starting = Starting.NONE;
  m.track = 0;
  if (m.song < 0 && (m.mode - 5) >>> 0 >= 3) return;
  setVolume(m, tables, 0, -1);
  m.song = -1;
  m.xa = -1;
  m.movieFrom = -1;
  m.movie = 0;
  m.mode = MusicMode.STOPPED;
}

/** The music's options as the driver reads them: as the game last told it, else the tables'. */
export function musicOptionsOf(m: MusicState, tables: MusicTables): { readonly set: number; readonly stereo: number } {
  return m.options ?? { set: tables.set === 1 ? 1 : 0, stereo: tables.stereo };
}

function play(m: MusicState, tables: MusicTables, song: number, next: boolean): void {
  const set = musicOptionsOf(m, tables).set;
  if (set < 0) return;
  const pick = tables.picks[song]?.[set];
  if (pick === undefined) return;
  m.stopTime = STARTING_TIME;
  if (song === m.song) {
    setVolume(m, tables, 0x7f, -1);
    return;
  }
  start(m, tables, song, pick, next, pick.loops);
}

/** The Theater's song: its pick from the set it names, never looping, started over even when it plays. */
function playOnce(m: MusicState, tables: MusicTables, song: number, set: number): void {
  const pick = tables.picks[song]?.[set];
  if (pick === undefined) return;
  m.stopTime = STARTING_TIME;
  start(m, tables, song, pick, false, false);
}

/** A song's pick started (with `next` readied), its volume up at once. */
function start(m: MusicState, tables: MusicTables, song: number, pick: SongPick, next: boolean, loops: boolean): void {
  setVolume(m, tables, 0, -1);
  m.loops = loops;
  m.songVolume = pick.volume;
  if (pick.track) {
    if (next) return;
    stop(m, tables);
    m.track = pick.xa;
    m.trackFields = 0;
    m.starting = Starting.TRACK_WAITING;
    m.song = song;
    setVolume(m, tables, 0x7f, -1);
    m.mode = MusicMode.TRACK;
    m.movie = 0;
    return;
  }
  m.starting = Starting.WAITING;
  if (next) {
    setVolume(m, tables, 0, -1);
    return;
  }
  m.movieFrom = -1;
  m.song = song;
  m.xa = pick.xa;
  m.played = 0;
  m.starts += 1;
  setVolume(m, tables, 0x7f, -1);
  m.mode = MusicMode.PLAYING;
  m.movie = 0;
}

/** A command, in its frame's order. */
export function musicCommand(m: MusicState, tables: MusicTables, c: SoundCommand): void {
  if (c.key === 'song') play(m, tables, c.song, c.next);
  else if (c.key === 'theater song') playOnce(m, tables, c.song, c.set);
  else if (c.key === 'music fade') setVolume(m, tables, c.volume, c.frames);
  else if (c.key === 'music end after fade') {
    m.mode = MusicMode.FADING_OUT;
    m.movie = 0;
  } else if (c.key === 'music stop') stop(m, tables);
  else if (c.key === 'song volume') m.songVolume = c.volume;
  else if (c.key === 'music mode') {
    m.mode = c.mode;
    m.movie = (c.mode - 5) >>> 0 < 2 ? 1 : 0;
  } else if (c.key === 'music span') {
    m.spanPlace = c.start;
    m.spanEnd = c.end;
    m.loops = false;
  } else if (c.key === 'movie read') {
    m.xa = -1;
    m.track = 0;
    m.movieFrom = c.sector;
    m.movieFields = 0;
  } else if (c.key === 'drive pause') {
    m.movieFrom = -1;
    m.track = 0;
  } else if (c.key === 'at') {
    /* A time within the frame: the driver here takes the frame's commands as the game asks. */
  } else if (c.key === 'music reset') {
    setVolume(m, tables, 0x7f, -1);
    stop(m, tables);
  } else if (c.key === 'music options') m.options = { set: c.set, stereo: c.stereo };
}

/** A field: the drive reads on. */
export function musicTick(m: MusicState): void {
  if (m.mode === MusicMode.PLAYING && 0 <= m.xa) m.played += 1;
  if (0 <= m.movieFrom) m.movieFields += 1;
  if (m.track !== 0) m.trackFields += 1;
}

/** The XA song's place on the disc, as the drive reports it. */
export function musicPosition(m: MusicState, tables: MusicTables): number {
  const first = tables.xaSongs[m.xa]?.first ?? 0;
  return first + Math.floor((m.played * FRAMES_PER_FIELD) / FRAMES_PER_SECTOR) * INTERLEAVE;
}

/** The track the drive says it plays: the one asked for while its samples last, then the next (the driver's sign it is over), or none. */
function reportedTrack(m: MusicState, tables: MusicTables): number {
  if (m.track === 0) return 0;
  const sectors = tables.tracks.find((t) => t.track === m.track)?.sectors ?? 0;
  if (m.trackFields * SAMPLES_PER_FIELD < sectors * TRACK_SAMPLES_PER_SECTOR) return m.track;
  return tables.tracks.some((t) => t.track === m.track + 1) ? m.track + 1 : 0;
}

/** A frame's start, before its commands: the fade a step on; at the song's end over again or stopped; after a win, stopped once silent; a track stopped once over; reading on, stopped past the span's end. */
export function musicFrame(m: MusicState, tables: MusicTables): void {
  switch (m.mode) {
    case MusicMode.PLAYING:
      stepFade(m);
      if (m.xa < 0 || musicPosition(m, tables) < tables.xaSongs[m.xa]!.end) return;
      if (m.loops) {
        m.played = 0;
        m.starts += 1;
      } else stop(m, tables);
      return;
    case MusicMode.FADING_OUT:
      stepFade(m);
      if (m.volume === 0) stop(m, tables);
      return;
    case MusicMode.TRACK: {
      const track = reportedTrack(m, tables);
      if (track === 0 || m.track < track) stop(m, tables);
      stepFade(m);
      return;
    }
    case MusicMode.MOVIE:
    case MusicMode.MOVIE_HELD:
      stepFade(m);
      return;
    case MusicMode.READ_ON:
      if (m.spanPlace <= m.spanEnd) m.spanPlace = 0 <= m.movieFrom ? m.movieFrom + Math.floor(m.movieFields * SECTORS_PER_FIELD) : m.spanPlace;
      else stop(m, tables);
      return;
    case MusicMode.STOPPED:
    case 8:
    case 9:
    case 10:
      return;
    default:
      m.mode = MusicMode.STOPPED;
  }
}

/** The CD's gain each side to its own and across, 0 to 1, as the drive mixes it: nothing while a song is still to be heard. */
export function musicGains(m: MusicState, tables: MusicTables): { same: number; across: number } {
  if (m.starting === Starting.WAITING || m.starting === Starting.TRACK_WAITING) return { same: 0, across: 0 };
  if (musicOptionsOf(m, tables).stereo === 0) {
    const each = div(m.volume * 0x50, 100) & 0xff;
    return { same: each / 0x80, across: each / 0x80 };
  }
  return { same: (m.volume & 0xff) / 0x80, across: 0 };
}

/** The driver brought up to the commands asked for so far this frame (the frame's are taken in their order as the game asks it anything). */
export function syncMusic(sound: { readonly commands: readonly SoundCommand[]; readonly music: MusicState; musicSeen: number }, tables: MusicTables): MusicState {
  for (; sound.musicSeen < sound.commands.length; sound.musicSeen += 1) musicCommand(sound.music, tables, sound.commands[sound.musicSeen]!);
  return sound.music;
}

/**
 * Whether the song last asked for is still to be heard, counting down the frames the ask allows;
 * past them the driver puts the music back to full volume (`music reset`, which the caller sends)
 * and the answer is no. Null asks for the reset.
 */
export function songStarting(m: MusicState): boolean | null {
  if (m.stopTime < 0) return null;
  m.stopTime -= 1;
  return m.starting === Starting.WAITING || m.starting === Starting.TRACK_WAITING;
}
