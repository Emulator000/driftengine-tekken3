/**
 * The title (scene 3): the opening movie (unless the attract cycle skips it), the title fading in
 * from black, held five seconds with the start line blinking under it, then fading out to the
 * attract demo; start goes to the mode menu, as a movie the stream gave up on does.
 */
import type { FightData } from '../fight/state.ts';
import { voiceLine } from '../fight/voices.ts';
import type { SceneTables } from '../data/scenes.ts';
import { goToLogo, START_SOUND, startPressed } from './logo.ts';
import { startMovie, stepMovie } from './movie.ts';
import { print } from './printer.ts';
import { stopMotors } from './rumble.ts';
import { Scene, type GameState } from './state.ts';

/** What the title shows. */
export const TitleShows = { BLACK: 0, MOVIE: 1, TITLE: 2, NO_START: 3, NO_MARK: 4, PICTURE: 5, DARK_PICTURE: 6, OTHER_MOVIE: 7, FADED: 8 } as const;

/** The attract cycle's steps: the one that plays the other movie, the one that shows no movie. */
const OTHER_MOVIE_STEP = 2;
const NO_MOVIE_STEP = 3;
/** The table entries the fades lie at: over the picture alone, and over everything. */
const PICTURE_FADE = 3;
const FRONT_FADE = 7;
/** Frames the title is held before it fades out. */
const HELD = 300;
/** The start line: its line, its colour; the frames' bits that blink it. */
const START_LINE = { y: 0x16c, colour: 5, blink: 0x30, centre: 0xb8 } as const;
/** The copyright lines' places and colour. */
const COPYRIGHT = [
  { x: 0x24, y: 0x19c },
  { x: 99, y: 0x1b0 },
] as const;
const COPYRIGHT_COLOUR = 6;
/** Both pads are in: the start line for both. */
const BOTH_PADS = 3;

/** The attract cycle's next step (0 to 3). */
export function nextAttractStep(game: GameState): void {
  const step = game.attract.step + 1;
  game.attract.step = 3 < step ? 0 : step;
}

/** A fade drawn from a table entry on. */
export function fade(game: GameState, layer: number, level: number): void {
  game.fades.push({ layer, level });
}

/** The line under the title, blinking: which pads are in decides it (both are, here). */
export function drawStartLine(game: GameState, scenes: SceneTables): void {
  if ((game.world.vsyncSeen & START_LINE.blink) === 0) return;
  const line = scenes.startLines[BOTH_PADS]!;
  print(game, 0, START_LINE.colour, START_LINE.centre - line.half, START_LINE.y, line.text);
}

/** What the title shows this field: its picture, and over it its lines as `shows` has them, or a fade. */
export function drawTitle(game: GameState, scenes: SceneTables, shows: number): void {
  game.title.shows = shows;
  if (shows === TitleShows.FADED) {
    fade(game, FRONT_FADE, 0);
    return;
  }
  if (TitleShows.TITLE <= shows && shows <= TitleShows.NO_MARK) {
    if (shows === TitleShows.TITLE) drawStartLine(game, scenes);
    if (shows <= TitleShows.NO_MARK) COPYRIGHT.forEach(({ x, y }, i) => print(game, 0, COPYRIGHT_COLOUR, x, y, scenes.copyright[i]!));
  }
}

/**
 * Scene 3: its states step the movie, the fade in, the hold and the fade out; start (or a movie
 * cut short) goes to the mode menu, the attract cycle stepped on; past the fade out, the attract
 * demo starts.
 */
export function titleScene(game: GameState, data: Pick<FightData, 'sound' | 'music'>, scenes: SceneTables, startDemo: (game: GameState) => void): void {
  const title = game.title;
  let shows = title.shows;
  switch (game.step) {
    case 0: {
      title.movie = 0;
      const step = game.attract.step;
      game.step = step;
      if (step === OTHER_MOVIE_STEP) {
        game.step = 1;
        title.movieKind = 1;
      } else if (step !== NO_MOVIE_STEP) {
        title.movieKind = 0;
        game.step = 1;
      }
      shows = TitleShows.FADED;
      game.count = 0;
      break;
    }
    case 1:
      shows = TitleShows.MOVIE;
      startMovie(game, scenes.movies, title.movieKind & 1);
      game.step = 2;
      break;
    case 2:
      title.movie = stepMovie(game, scenes.movies, data.music);
      if (0 < title.movie) game.step = 6;
      break;
    case 3:
    case 4:
    case 5: {
      if (game.step === 3) {
        shows = TitleShows.BLACK;
        game.count = 0;
        game.step = 4;
      }
      if (game.step === 4) {
        const level = game.count + 0x10a;
        if (game.count + 10 < 0x100) {
          game.count += 10;
          fade(game, PICTURE_FADE, level);
          break;
        }
        game.count = 0;
        game.step = 5;
      }
      fade(game, PICTURE_FADE, 0x200);
      game.count += 1;
      if (10 < game.count) game.step = 6;
      break;
    }
    case 6:
    case 7: {
      if (game.step === 6) {
        shows = TitleShows.PICTURE;
        game.count = 0x100;
        game.step = 7;
      }
      const level = game.count + 0xfd;
      if (game.count < 1) {
        game.count = HELD;
        game.step = 8;
        break;
      }
      game.count -= 3;
      fade(game, PICTURE_FADE, level);
      break;
    }
    case 8:
      shows = TitleShows.TITLE;
      game.count -= 1;
      if (game.count === 0) {
        game.count = 0x100;
        game.step = 9;
      }
      break;
    case 9:
      if (game.count < 1) {
        shows = TitleShows.FADED;
        game.step = 10;
        break;
      }
      game.count -= 8;
      fade(game, FRONT_FADE, game.count);
      break;
    default:
      nextAttractStep(game);
      shows = TitleShows.FADED;
      startDemo(game);
  }
  title.shows = shows;
  if (!startPressed(game) && title.movie !== -1) {
    drawTitle(game, scenes, shows);
    return;
  }
  nextAttractStep(game);
  voiceLine(game.world, data, 0, START_SOUND, 0);
  stopMotors(game);
  goToLogo(game, Scene.MENU);
}
