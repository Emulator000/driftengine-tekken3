/**
 * The movie player, as the game plays its movies (the title's player, and the Theater's copy, which
 * adds the endings' captions). A movie's record (its file, width, height, frame count, volume and
 * flags) gives its file's sectors in the XA file and how it ends.
 *
 * Started, the music stops and its volume is set to the movie's (the movie's sound comes from the
 * drive through the CD input, as a song's does), and the driver is put in its movie state. A step:
 * three of them wait (a vertical blank each), then the drive reads the file as a stream and each
 * step takes the stream's next frame, waiting for its data (the drive at 150 sectors a second, a
 * frame there once its last sector is), and shows the one taken before after the next vertical
 * blank. The frame numbered with the record's count ends it (or, with the loop flag, the stream
 * reads again from the start); start held on either pad stops it after the frame shown. Its end
 * clears the screen (white for the other movie) and puts the driver back: stopped, or for the
 * opening reading on through the file's end with its volume up, so the opening's sound runs on
 * into the title. The step returns 0 while it plays, then 1 played through, -2 stopped by start,
 * or -1 if the stream failed (no frame for ten seconds; the disc's lid never opens here).
 *
 * Its waits move the frame's clock, so the game runs no frame while a movie waits on its stream;
 * the frames shown, and from which vertical blank, are the presentation's to draw.
 */
import type { MovieStream, MovieTables } from '../data/scenes.ts';
import { fadeMusic, musicMode, musicSpan, pauseDrive, readMovie, setSongVolume, stopMusic } from '../fight/voices.ts';
import { syncMusic, type MusicTables } from '../sound/music.ts';
import { waitUntil, waitVblank } from './clock.ts';
import type { GameState } from './state.ts';

/** The drive's sectors a field, at double speed. */
const SECTORS_PER_FIELD = 2.5;
/** Fields without a frame before the stream is given up on. */
const STREAM_TIMEOUT = 600;
const START = 0x800;
/** The movie states. */
const State = { DONE: 0, WAITING: 1, PLAYING: 2, LAST: 3, ENDING: 5 } as const;

function show(game: GameState, file: number, frame: number, white = false, caption = -1): void {
  game.movie.shows.push({ at: Math.floor(game.clock.now), file, frame, white, caption });
}

/** The endings' captions: a set's first cue (the set+1-th cue at frame 0), none shown. */
function captionSet(game: GameState, tables: MovieTables, set: number): void {
  const movie = game.movie;
  if (set < 0) {
    movie.captionCue = -1;
    movie.caption = -1;
    return;
  }
  let cue = 0;
  let left = set;
  for (; cue < 30; cue += 1) {
    if (tables.cues[cue]!.frame !== 0) continue;
    left -= 1;
    if (left < 0) break;
  }
  movie.captionCue = cue;
  movie.caption = -1;
}

/** The caption for frame `frame`: the last cue before the first at or past it. */
function captionFor(game: GameState, tables: MovieTables, frame: number): void {
  const movie = game.movie;
  let cue = movie.captionCue;
  if (frame <= 0 || cue < 0) return;
  if (tables.cues[cue]!.frame < frame) {
    do cue += 1;
    while (tables.cues[cue]!.frame < frame);
  }
  movie.caption = tables.cues[cue - 1]!.caption;
}

/** The commands from here on timed at the frame's clock, once its waits have moved it past the last time stamped. */
export function stampSound(game: GameState): void {
  const at = Math.floor(game.clock.now);
  if (at === game.world.sound.stamp) return;
  game.world.sound.stamp = at;
  game.world.sound.commands.push({ key: 'at', vblank: at });
}

/** The file's stream, by the movie's file. */
const streamOf = (tables: MovieTables, file: number): MovieStream | null => tables.files[file] ?? null;

/** The stream's next frame, once its data is read; the frame at the count (or before the last, the stream having started over) ends the movie, or with the loop flag reads the file again. 0, or -1 when no frame comes. */
function takeFrame(game: GameState, tables: MovieTables): number {
  const movie = game.movie;
  const stream = movie.stream;
  const ends = streamOf(tables, movie.file)?.ends ?? [];
  const next = stream.taken + 1;
  if (ends.length < next) {
    waitUntil(game, game.clock.now + STREAM_TIMEOUT);
    return -1;
  }
  waitUntil(game, stream.start + (ends[next - 1]! + 1) / SECTORS_PER_FIELD);
  stream.taken = next;
  if (movie.frames <= next || next < movie.last) {
    if (movie.loops !== 0) {
      stream.start = game.clock.now;
      stream.taken = 0;
    } else movie.ended = 1;
  }
  movie.last = next;
  stream.pending = next;
  return 0;
}

/** The screen cleared at the movie's end: black, or for a white end the screen's rectangle white; four vertical blanks. */
function clearScreen(game: GameState, white: boolean): void {
  waitVblank(game);
  waitVblank(game);
  show(game, 0, 0, white);
  waitVblank(game);
  waitVblank(game);
}

/** The music stopped with the stream: at once silent, the drive paused (unless its lid opened). */
function stopWithStream(game: GameState): void {
  stampSound(game);
  fadeMusic(game.world, 0, -1);
  if (game.movie.lidOpen === 0) pauseDrive(game.world);
}

/** Start movie `index` (`captions` the Theater's player, which draws the endings' captions). */
export function startMovie(game: GameState, tables: MovieTables, index: number, captions = false): void {
  const record = tables.movies[index]!;
  const movie = game.movie;
  const world = game.world;
  movie.movie = index;
  movie.file = record.file;
  movie.loops = record.flags & 4;
  movie.captions = (record.flags >> 8) & 0xf;
  movie.endKind = record.flags & 3;
  movie.white = record.flags & 8;
  setSongVolume(world, record.volume);
  fadeMusic(world, 0x7f, -1);
  movie.strip = movie.captions === 3 ? 1 : 0;
  if (movie.endKind === 3) {
    movie.endKind = 0;
    movie.readOn = 1;
  } else movie.readOn = 0;
  movie.frames = record.frames;
  movie.last = 1;
  movie.lidOpen = 0;
  stopMusic(world);
  musicMode(world, 5);
  if (captions && movie.captions !== 0) {
    movie.caption = -1;
    movie.captionCue = -1;
    captionSet(game, tables, movie.captions - 1);
  }
  /* The display off: nothing shows until the first frame. */
  show(game, 0, 0);
  movie.ended = 0;
  if (captions && movie.captions !== 0) captionFor(game, tables, movie.last);
  movie.state = State.WAITING;
  movie.countdown = 3;
  waitVblank(game);
  movie.result = 0;
  stampSound(game);
  musicMode(world, 5);
  movie.clears = 1;
}

/** A step of the movie: 0 while it plays, then its end's result. */
export function stepMovie(game: GameState, tables: MovieTables, music: MusicTables, captions = false): number {
  const movie = game.movie;
  const world = game.world;
  if (syncMusic(world.sound, music).movie === 0) return -1;
  if (0 < movie.clears) movie.clears -= 1;
  switch (movie.state) {
    case State.WAITING:
      movie.countdown -= 1;
      if (movie.countdown === 0) {
        movie.stream.start = game.clock.now;
        movie.stream.taken = 0;
        movie.stream.pending = 0;
        stampSound(game);
        readMovie(world, streamOf(tables, movie.file)?.first ?? 0);
        waitVblank(game);
        takeFrame(game, tables);
        movie.state = State.PLAYING;
      }
      waitVblank(game);
      return 0;
    case State.PLAYING: {
      const shown = movie.stream.pending;
      if (takeFrame(game, tables) !== 0) {
        stopWithStream(game);
        clearScreen(game, false);
        movie.state = State.ENDING;
        movie.readOn = 0;
        movie.endKind = 0;
        movie.result = -1;
        return 0;
      }
      /* The frame shown was decoded, its caption laid in, while the step waited on the stream. */
      const caption = captions && movie.captions !== 0 ? movie.caption : -1;
      if (captions && movie.captions !== 0) captionFor(game, tables, movie.last);
      waitVblank(game);
      show(game, movie.file, shown, false, caption);
      if (movie.ended !== 0) {
        movie.state = State.LAST;
        return 0;
      }
      if (((world.input.rawPads[0]! | world.input.rawPads[1]!) & START) === 0) return 0;
      stopWithStream(game);
      movie.state = State.ENDING;
      movie.readOn = 0;
      movie.endKind = 0;
      movie.result = -2;
      return 0;
    }
    case State.LAST:
      if (captions && movie.captions !== 0) captionFor(game, tables, movie.last);
      if ((movie.endKind - 1) >>> 0 < 2) {
        if (captions) throw new Error("the Theater's fade from a movie's last frame is not remade: no movie on the disc ends so");
        return 0;
      }
      if (movie.readOn === 0) stopWithStream(game);
      movie.state = State.ENDING;
      movie.result = 1;
      return 0;
    case State.ENDING: {
      clearScreen(game, movie.white !== 0);
      movie.state = State.DONE;
      const stream = streamOf(tables, movie.file);
      stampSound(game);
      if (movie.readOn !== 0 && stream !== null) {
        musicSpan(world, stream.first, stream.last);
        musicMode(world, 7);
      } else musicMode(world, 1);
      return movie.result;
    }
    default:
      return 0;
  }
}
