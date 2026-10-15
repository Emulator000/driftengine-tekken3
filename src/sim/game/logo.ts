/**
 * The scenes that move the game between its others: the boot's (0), the loader (1), which reads
 * the files a scene queued one a field before going on, and the logo scene (2), which loads the
 * next scene's overlay while "NAMCO PRESENTS." fades in and out over black on the way to the title
 * or a demo. Every way to the title steps the attract cycle; start pressed from a scene ends it
 * and goes back to the mode menu (a soft reset).
 *
 * The remake has every file in hand, so a read lands as it is asked for and the drive is never
 * busy; the progress is read as the page starts and saved where the console saves its memory
 * card (`save.ts`), and no save fails.
 */
import type { FightData } from '../fight/state.ts';
import { playSong, voiceLine } from '../fight/voices.ts';
import { print } from './printer.ts';
import { saveRecords } from './records.ts';
import { Scene, type GameState } from './state.ts';

/** The start button's sound, and the menu's own. */
export const START_SOUND = 0x4cc0;
/** The raw pad's start button. */
const START = 0x800;
/** The attract cycle's step on which the title shows the attract overlay's demo in its place. */
const ATTRACT_DEMO = 1;
/** The step on which the logo scene shows no logo on the way to the title. */
const NO_LOGO = 3;
/** The first pad's buttons that pick the title's intro when held on the way to it: left, right, both. */
const INTRO_BUTTONS: Readonly<Record<number, number>> = { 8: 0, 4: 1, 0xc: 2 };
/** The buttons that must be up for a held pick to count. */
const PICK_MASK = 0xfff3;
/** The logo's fade: frames to come in, the frames it is held at least, and its steps. */
const FADE_IN = 0x20;
const HOLD = 0x5a;
/** The attract overlay's song, made ready as the overlay is in. */
const ATTRACT_SONG = 0;

/** Start newly pressed on either pad. */
export const startPressed = (game: GameState): boolean => ((game.world.input.fresh[0]! | game.world.input.fresh[1]!) & START) !== 0;

/** On to the attract overlay's intro at once, the attract cycle put on the step that shows it (the next intro in turn). */
export function goToIntro(game: GameState): void {
  game.attract.step = ATTRACT_DEMO;
  goToLogo(game, Scene.TITLE);
}

/** The picture held as last drawn (1) or let go (0). */
export function holdPicture(game: GameState, held: number): void {
  game.held = held;
}

/**
 * On to a scene by way of the logo scene, which loads its overlay. Going to the title steps the
 * attract cycle: buttons held on the first pad pick an intro (when any is earned), and every other
 * pass shows the attract overlay's demo in the title's place.
 */
export function goToLogo(game: GameState, next: number): void {
  holdPicture(game, 1);
  game.attractOverlay = 0;
  if (next === Scene.TITLE) {
    const attract = game.attract;
    let intro = attract.intro;
    let held = game.world.input.rawPads[0]!;
    if ((held & PICK_MASK) !== 0) held = 0;
    if (attract.intros === 0 || held === 0) {
      if (attract.step === ATTRACT_DEMO) intro += 1;
    } else {
      intro = INTRO_BUTTONS[held] ?? intro;
      if (attract.intros < intro) intro = attract.intro;
      else attract.step = ATTRACT_DEMO;
    }
    if (attract.intros < intro) intro = 0;
    attract.intro = intro;
    game.attractOverlay = 1;
    if (attract.step === ATTRACT_DEMO) next = Scene.ATTRACT;
    else game.attractOverlay = 0;
  }
  game.next = next;
  game.last = game.scene;
  game.scene = Scene.LOGO;
  game.step = 0;
}

/** On to a scene, through the loader when files are queued (the picture held while they load). */
export function goToScene(game: GameState, scene: number, step: number): void {
  if (game.loader.queued === 0) {
    game.scene = scene;
    game.step = step;
    return;
  }
  game.loader.next = 0;
  holdPicture(game, 1);
  game.loader.scene = scene;
  game.loader.step = step;
  game.scene = Scene.LOADER;
  game.step = 0;
}

/** A file queued for the loader (eight at most). */
export function queueFile(game: GameState): void {
  if (8 <= game.loader.queued) return;
  game.loader.queued += 1;
}

/** Scene 0: the boot's textures, then the logo on the way to the title. */
export function bootScene(game: GameState): void {
  if (game.step === 0) {
    game.step = 1;
  } else if (game.step === 1) {
    game.modeOverlay = 0xff;
    goToLogo(game, Scene.TITLE);
  }
}

/** Scene 1: the queue read a file a field, then the scene asked for. */
export function loaderScene(game: GameState): void {
  const step = game.step;
  const loader = game.loader;
  if (step === 0) {
    holdPicture(game, 0);
    game.step = 1;
    return;
  }
  if (step === 1 || step === 2) {
    loader.queued -= 1;
    if (loader.queued !== 0) {
      loader.next += 1;
      game.step = 1;
      return;
    }
  }
  if (step <= 4) {
    game.scene = loader.scene;
    game.step = loader.step;
  }
}

/**
 * Scene 2: the progress saved (once it was read), the next scene's overlay loaded and
 * started; on the way to the title or a demo, "NAMCO PRESENTS." fades in, holds a second and a
 * half and fades out over it. Start skips to the mode menu once the progress was read.
 */
export function logoScene(game: GameState, data: Pick<FightData, 'sound'>): void {
  const step = game.step;
  if (game.cardRead !== 0 && 5 < step && step < 0xb && startPressed(game)) {
    voiceLine(game.world, data, 0, START_SOUND, 0);
    goToLogo(game, Scene.MENU);
    return;
  }
  let shows = 3;
  let level = 0;
  /* The overlay started once its file is in, and finished: the attract's makes its song ready. */
  const start = (): void => {
    if (game.loaded === 0) game.loaded = 2;
  };
  const finish = (): void => {
    if (2 < game.loaded) return;
    if (game.attractOverlay !== 0) playSong(game.world, ATTRACT_SONG, true);
    game.loaded = 3;
  };
  switch (step) {
    case 0: {
      holdPicture(game, 0);
      game.world.attract = 1;
      if (3 < game.last - 2 || 3 < game.loaded) game.loaded = 0;
      if (game.attractOverlay !== game.lastAttractOverlay) {
        game.loaded = 0;
        game.lastAttractOverlay = game.attractOverlay;
      }
      const next = game.next;
      game.step = next !== Scene.ATTRACT && (next !== Scene.TITLE || game.attract.step === NO_LOGO) ? 1 : 5;
      break;
    }
    case 1:
    case 2:
    case 3:
    case 4:
      /* The progress saved on the way. */
      if (step <= 2) saveRecords(game);
      start();
      finish();
      game.step = 0xc;
      break;
    case 5:
    case 6:
      if (step === 5) {
        game.count = 0;
        game.step = 6;
      }
      level = game.count << 3;
      game.count += 1;
      shows = 0;
      if (FADE_IN < game.count) {
        shows = 1;
        game.step = 7;
        game.count = game.world.vsyncSeen;
      }
      break;
    case 7:
    case 8:
    case 9:
      if (step === 7) {
        /* The progress read the first time (as the page starts), saved after. */
        if (game.cardRead !== 0) saveRecords(game);
        game.cardRead = 1;
        game.step = 8;
      }
      shows = 1;
      if (game.step <= 8) {
        start();
        game.step = 9;
      }
      finish();
      if (HOLD < ((game.world.vsyncSeen - game.count) >>> 0)) {
        game.count = FADE_IN;
        game.step = 10;
      }
      break;
    case 10:
      level = game.count << 3;
      game.count -= 1;
      shows = 0;
      if (game.count < 1) {
        game.count = 0;
        game.step = 0xb;
        shows = 2;
      }
      break;
    case 0xb:
    case 0xc:
      if (step === 0xb) shows = 2;
      game.step = 0;
      game.scene = game.next;
      break;
  }
  drawLogo(game, shows, level);
}

/** The logo's picture: "NAMCO PRESENTS." fading in (0) or shown (1) over black, black alone (2), or nothing (3). */
function drawLogo(game: GameState, shows: number, level: number): void {
  game.logo.shows = shows;
  game.logo.level = level;
  if (shows !== 0 && shows !== 1) return;
  const x = print(game, 0, 2, 0x75, 0xf0, 'NAMCO ');
  print(game, 0, 6, x, 0xf0, 'PRESENTS.');
}
