/**
 * The Theater's scene as an Arcade run's ending plays it: the ending's movie (the one human's
 * character and costume, Gun Jack's second ending once his first is seen) played whole inside one
 * frame, the player's steps waiting on its stream until it ends, the frame going on across the
 * fields its waits spend and reading the pads at each (so start stops the movie); then the credits
 * set up, the Theater's sound (its own bank, the reverb), its song readied, and the roll each frame
 * until it ends or a button cuts it short, on to the records. A song the last match's win has not
 * yet faded out is stopped before the movie starts, so the movie keeps its volume. The Theater
 * mode's own menu is not remade.
 */
import type { SceneTables } from '../data/scenes.ts';
import type { FightData } from '../fight/state.ts';
import { keyOffVoices, playSong, stopMusic, theaterSound } from '../fight/voices.ts';
import { syncMusic } from '../sound/music.ts';
import { startCredits, stepCredits } from './credits.ts';
import { holdPicture } from './logo.ts';
import { stampSound, startMovie, stepMovie } from './movie.ts';
import { Scene, type GameState } from './state.ts';

/** Gun Jack's roster id, and the movie of his second ending; the Theater's song. */
const GUN_JACK = 16;
const GUN_JACK_SECOND = 24;
const SECOND_ENDING = 0x10000;
const SONG = 4;
const ROSTERS = 21;

/** The ending's movie for the one human's character (its look's roster and costume), or with no one human the Theater mode (its record's mode set). */
function endingMovie(game: GameState, scenes: SceneTables): number {
  const world = game.world;
  game.theater.mode = 0;
  const humans = world.humans;
  if (humans === 0 || 3 <= humans) {
    game.theater.mode = 1;
    return 0;
  }
  const look = world.fighters[humans - 1]!.rosterCode;
  let roster = Math.trunc(look / 4);
  let costume = look & 3;
  if (ROSTERS <= roster >>> 0) {
    roster = 0;
    costume = 0;
  }
  const movie = scenes.movies.endings[roster]![costume]!;
  if (movie < 0) throw new Error(`no ending for roster ${roster}'s fourth costume`);
  if (roster === GUN_JACK && (game.records.endings[1]! & SECOND_ENDING) !== 0) return GUN_JACK_SECOND;
  return movie;
}

/**
 * The ending's movie stepped on while the frame's clock is not past this field (a later field goes
 * on with it); once it ends, the credits set up and the Theater's song readied.
 */
function playEnding(game: GameState, data: Pick<FightData, 'sound' | 'music'>, scenes: SceneTables): void {
  const world = game.world;
  while (syncMusic(world.sound, data.music).movie !== 0) {
    if (game.vblanks < Math.floor(game.clock.now)) return;
    stepMovie(game, scenes.movies, data.music, true);
  }
  game.theater.playing = 0;
  stampSound(game);
  startCredits(game.credits);
  theaterSound(world);
  playSong(world, SONG, true);
  game.step = 3;
}

/** Scene 0x13. */
export function theaterScene(game: GameState, data: Pick<FightData, 'sound' | 'music'>, scenes: SceneTables): void {
  const world = game.world;
  switch (game.step) {
    case 0:
      keyOffVoices(world, false);
      /* The Theater's overlay just loaded: the roll's pressed and end words as its file has them. */
      game.credits.pressed = 0;
      game.credits.end = 0;
      game.theater.movie = endingMovie(game, scenes);
      if (game.theater.mode !== 0) throw new Error("the Theater mode's menu is not remade");
      game.step = 2;
      break;
    case 2:
      if (game.theater.playing === 0) {
        if (0 <= syncMusic(world.sound, data.music).song) stopMusic(world);
        startMovie(game, scenes.movies, game.theater.movie, true);
        game.theater.playing = 1;
      }
      playEnding(game, data, scenes);
      break;
    case 3:
      if (!stepCredits(game, data, scenes.credits)) break;
      game.credits.drawn.length = 0;
      holdPicture(game, 1);
      game.scene = Scene.RECORDS_LOADER;
      game.step = 0;
      break;
    default:
      throw new Error(`the Theater's state ${game.step} is not remade`);
  }
}
