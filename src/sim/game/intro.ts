/**
 * The attract overlay (scene 6), between title cycles: an intro played in the fight's engine (two
 * characters on stage 4 acting out a script of moves, changing model along the way, under the
 * intro's scripted camera, ending in a fade to white), then the title picture faded in with the
 * copyright and the start line, held five seconds, faded out, and the attract demo's fight. Start
 * goes to the mode menu.
 *
 * The intro is one of three (`attract.intro`): its script (events of a frame, what and three
 * arguments), its own moveset for both sides, and its own models, one for each pack it names (its
 * fight data, `introData`). Each side keeps a record: what it is doing (1 a move, 2 to 6 changing
 * model), its pack, its move, the move's last frame, and its frame.
 */
import type { SceneTables } from '../data/scenes.ts';
import { stepScenery } from '../fight/arena.ts';
import { introCamera, startIntroCamera, stepCamera, viewMatrix } from '../fight/camera.ts';
import { groundFadeOf, setUpModel, type FightTables } from '../fight/match.ts';
import { moveEvents } from '../fight/move-events.ts';
import { moveById } from '../fight/moves.ts';
import { fadeFlash, poseFighter, skeletonCamera } from '../fight/pose.ts';
import { setPushRadii } from '../fight/body.ts';
import { resetFighter } from '../fight/start.ts';
import type { FightData, Fighter } from '../fight/state.ts';
import { playSong, stopSounds, voiceLine } from '../fight/voices.ts';
import { clearDust, clearSparks, drawSparks, stepDust, stopEvents } from '../effects/sparks.ts';
import { sine } from '../math/angles.ts';
import { chooseDemoFighters } from './attract.ts';
import { goToLogo, startPressed } from './logo.ts';
import { MenuMode, startMode } from './menu.ts';
import { motorsOff, stopMotors } from './rumble.ts';
import { drawTitle, fade, nextAttractStep, TitleShows } from './title.ts';
import { Scene, type GameState } from './state.ts';

/** The intro's stage, its song, the frames it waits for the song, the sides' facing. */
const STAGE = 4;
const SONG = 0;
const SONG_WAIT = 4;
const FACING = 0x4000;
/** The start sound, the fades' table entries (the picture's and the front's), the fades' steps. */
const START_SOUND = 0x4cc0;
const PICTURE_FADE = 3;
const FRONT_FADE = 7;
const WHITE_FADE = 1;
/** The picture's fade in (from black past its first level, three a field), its hold (five seconds), its fade out (eight a field). */
const FADE_IN = { from: 0x100, offset: 0xfd, step: 3 } as const;
const HOLD = 300;
const FADE_OUT = 8;
/** The script's kinds of event. */
const Event = { MODEL: 0, MODEL_TWO: 1, MOVE: 2, MOVE_TWO: 3, WHITE: 5, END: -1 } as const;
/** What a side is doing: nothing, a move, changing model (2 to 6). */
const Doing = { NOTHING: 0, MOVE: 1, CHANGE: 2, CHANGE_WAIT: 3, CHANGE_FIND: 4, CHANGE_LOAD: 5, CHANGE_DONE: 6 } as const;
/** The replay's stage while the intro plays: none recorded. */
const NO_REPLAY_STAGE = 0x17;
const NO_KNOCKOUT = -2;

/** The intro's sides' first packs: the first and second intro's characters, the third's own. */
function firstPacks(intro: number): [number, number] {
  if (intro === 0) return [0xc, 0];
  if (intro === 1) return [0xd, intro];
  return [0x17, 0x1e];
}

/** A side given a pack: its roster code the first one with that pack, the pack as that code has it, its roster id the code over four. */
export function setPack(tables: FightTables, f: Fighter, pack: number): void {
  const codes = tables.roster.codes;
  f.rosterCode = 0;
  for (let code = 0; code < codes.length; code += 1) {
    if (codes[code]!.pack === pack) {
      f.rosterCode = code;
      break;
    }
  }
  f.costume = f.rosterCode < codes.length ? codes[f.rosterCode]!.pack : -1;
  f.roster = Math.trunc(f.rosterCode / 4);
}

/** The intro made ready to set up: its step at 0, the pause and the fade off, no moveset of the roster's, the scenery at the origin. */
function resetIntro(game: GameState): void {
  const world = game.world;
  const screen = game.attractScreen;
  screen.step = 0;
  world.attract = 1;
  world.pause.paused = 0;
  world.pause.requested = 0;
  world.pause.frozen = 0;
  world.pause.last = 0;
  screen.fading = 0;
  for (const f of world.fighters.slice(0, 2)) {
    f.character = -2;
    f.unlit = 0;
  }
}

/** The intro's set-up: both fighters reset, its characters and their first moves, stage 4, the sparks and dust cleared, the cameras, the replay off, the song. */
function setUpIntro(game: GameState, data: FightData): void {
  const world = game.world;
  const screen = game.attractScreen;
  const [a, b] = world.fighters;
  for (const f of [a, b]) f.blend.kind = 0;
  world.noBlendFrames = 0x14;
  resetFighter(world, data, a, b);
  resetFighter(world, data, b, a);
  world.stage = STAGE;
  screen.event = 0;
  const packs = firstPacks(game.attract.intro);
  screen.sides.forEach((side, n) => Object.assign(side, { doing: Doing.NOTHING, frame: 0, pack: packs[n]!, move: 0 }));
  setPack(data, a, screen.sides[0]!.pack);
  setPack(data, b, screen.sides[1]!.pack);
  world.groundFade = groundFadeOf(STAGE);
  world.scenery.yaw = 0;
  world.scenery.yawBefore = world.camera.drawn.yaw & 0xfff;
  world.scenery.lastYaw = world.scenery.yawBefore;
  setUpModel(world, data, a);
  setUpModel(world, data, b);
  a.rootMove = moveById(data, a, screen.sides[0]!.move);
  a.move = a.rootMove;
  b.rootMove = moveById(data, b, screen.sides[1]!.move);
  a.facing = FACING;
  b.facing = FACING;
  for (const f of [a, b]) {
    f.tilt.x = 0;
    f.position.fill(0);
    f.tilt.z = 0;
    f.heading = FACING;
  }
  b.move = b.rootMove;
  world.scenery.yaw &= ~0xff;
  world.status = 0;
  stepCamera(world, data);
  startIntroCamera(world, data);
  screen.cameraDone = 0;
  clearSparks(world);
  clearDust(world, data);
  b.present = 1;
  a.present = 1;
  const replay = world.replay;
  replay.stage = NO_REPLAY_STAGE;
  replay.first = 0;
  replay.state = 0;
  replay.recordFrame = 0;
  replay.playFrame = 0;
  replay.soundShift = 0;
  replay.index = 0;
  replay.skip = 0;
  replay.recorded = 0;
  replay.knockoutStart = NO_KNOCKOUT;
  playSong(world, SONG, false);
  screen.frame = SONG_WAIT;
  screen.step = 1;
}

/** The script's events due by this frame: model changes, moves, the fade to white; true at its end. */
function playScript(game: GameState, data: FightData, scenes: SceneTables): boolean {
  const world = game.world;
  const screen = game.attractScreen;
  const script = scenes.intros[game.attract.intro]!.script;
  for (;;) {
    const event = script[screen.event];
    if (event === undefined) throw new Error(`the intro's script ran past its end at event ${screen.event}`);
    const [frame, kind, first, second, third] = event;
    if (screen.frame < frame) return false;
    if (kind === Event.END) return true;
    const n = kind === Event.MODEL || kind === Event.MOVE ? 0 : 1;
    const f = world.fighters[n]!;
    const side = screen.sides[n]!;
    switch (kind) {
      case Event.MODEL:
      case Event.MODEL_TWO:
        if (side.pack !== first) {
          setPack(data, f, first);
          side.frame = 2;
          side.doing = Doing.CHANGE;
        }
        side.pack = first;
        break;
      case Event.MOVE:
      case Event.MOVE_TWO:
        if (side.move !== first) {
          f.rootMove = moveById(data, f, first);
          f.move = f.rootMove;
        }
        side.move = first;
        side.frame = second;
        side.last = third;
        side.doing = Doing.MOVE;
        break;
      case Event.WHITE:
        screen.fade = 0;
        screen.fading = 1;
        screen.fadeStep = first;
        break;
    }
    screen.event += 1;
  }
}

/**
 * The intro's frame: set up (step 0); wait four frames for the song and start its camera (1); then
 * each frame the script's events, the arena, each side's move frame posed (or its model change a
 * step on), the sparks and dust, the scripted camera until it hands back to the attract mode's (no
 * intro of the three lasts that long: each ends on its fade to white first), and the fade to white.
 * True when the intro is over.
 */
function playIntro(game: GameState, data: FightData, scenes: SceneTables): boolean {
  const world = game.world;
  const screen = game.attractScreen;
  stopEvents(world);
  if (screen.step === 0) {
    setUpIntro(game, data);
    return false;
  }
  if (screen.step === 1) {
    screen.frame -= 1;
    if (screen.frame < 0) {
      screen.cameraDone = introCamera(world, data, 0);
      screen.frame = 0;
      screen.step = 2;
    }
    return false;
  }
  if (screen.step !== 2) return true;
  if (playScript(game, data, scenes)) return true;
  const [a, b] = world.fighters;
  if (world.nothingDrawn === 0) {
    viewMatrix(data, world.camera.drawn, world.view);
    world.groundShown = 0 < sine(data.math, world.camera.drawn.pitch + 0xef) ? 1 : 0;
  }
  stepScenery(world, data);
  setPushRadii(data, a);
  fadeFlash(world);
  skeletonCamera(world);
  if (world.nothingDrawn === 0) world.framesDrawn = (world.framesDrawn + 1) & 0xff;
  screen.sides.forEach((side, n) => {
    const f = world.fighters[n]!;
    switch (side.doing) {
      case Doing.MOVE: {
        const frame = side.frame + 1;
        f.frame = frame;
        f.rootFrame = frame;
        /* A side still on an id its moveset lacks plays no events (the game reads stray bytes there that never match its frame). */
        for (const g of [a, b]) {
          if (g.move !== null) moveEvents(world, data, g);
          else g.eventHealth = 0;
        }
        world.skipBlend = 1;
        poseFighter(world, data, f, () => {});
        side.frame += 1;
        if (side.last < side.frame) side.doing = Doing.NOTHING;
        break;
      }
      case Doing.CHANGE: {
        side.frame = ((side.frame - 1) << 16) >> 16;
        if (side.frame < 0) side.doing = Doing.CHANGE_WAIT;
        break;
      }
      case Doing.CHANGE_WAIT:
        side.doing = Doing.CHANGE_FIND;
        break;
      case Doing.CHANGE_FIND:
        side.doing = Doing.CHANGE_LOAD;
        break;
      case Doing.CHANGE_LOAD:
        setUpModel(world, data, f);
        side.doing = Doing.CHANGE_DONE;
        break;
      case Doing.CHANGE_DONE:
        side.doing = Doing.NOTHING;
        break;
    }
  });
  drawSparks(world, 1);
  stepDust(world, data, 1);
  if (screen.cameraDone === 0) screen.cameraDone = introCamera(world, data, 0);
  else stepCamera(world, data);
  if (screen.fading !== 0) {
    if (0x100 < screen.fade) screen.fade = 0x100;
    fade(game, WHITE_FADE, screen.fade + 0x100);
    screen.fade += screen.fadeStep;
  }
  screen.frame += 1;
  a.lastFrame = a.frame;
  b.lastFrame = b.frame;
  return false;
}

/** What the attract overlay reads: the tables, and the intro's fight data (its moveset and models), loaded. */
export interface AttractData {
  readonly tables: FightTables;
  readonly scenes: SceneTables;
  intro(intro: number): FightData;
}

/**
 * Scene 6: start goes to the mode menu. Otherwise: set up (0), the intro (1, 2), the picture's
 * textures (3), the picture faded in (4, 5), held five seconds (6), faded out (7), then the attract
 * demo's fight started.
 */
export function attractScene(game: GameState, data: AttractData): void {
  const world = game.world;
  const screen = game.attractScreen;
  if (0 < game.step && startPressed(game)) {
    nextAttractStep(game);
    stopSounds(world, true);
    voiceLine(world, data.tables, 0, START_SOUND, 0);
    stopMotors(game);
    goToLogo(game, Scene.MENU);
    return;
  }
  switch (game.step) {
    case 0:
      world.mode = MenuMode.DEMO;
      world.match.trueOgres = 0;
      world.attract = 1;
      motorsOff(game);
      game.step = 1;
      screen.draw = TitleShows.FADED;
      game.count = 0;
      break;
    case 1:
      screen.draw = TitleShows.BLACK;
      resetIntro(game);
      game.step = 2;
      break;
    case 2:
      screen.draw = TitleShows.OTHER_MOVIE;
      if (playIntro(game, data.intro(game.attract.intro), data.scenes)) game.step = 3;
      break;
    case 3:
      screen.draw = TitleShows.OTHER_MOVIE;
      game.step = 4;
      break;
    case 4:
    case 5: {
      if (game.step === 4) {
        screen.draw = TitleShows.PICTURE;
        game.count = FADE_IN.from;
        game.step = 5;
      }
      const level = game.count + FADE_IN.offset;
      if (game.count < 1) {
        game.count = HOLD;
        game.step = 6;
      } else {
        game.count -= FADE_IN.step;
        fade(game, PICTURE_FADE, level);
      }
      break;
    }
    case 6:
      screen.draw = TitleShows.TITLE;
      game.count -= 1;
      if (game.count === 0) {
        game.count = 0x100;
        game.step = 7;
      }
      break;
    case 7:
      if (game.count < 1) {
        screen.draw = TitleShows.FADED;
        game.step = 8;
        break;
      }
      game.count -= FADE_OUT;
      fade(game, FRONT_FADE, game.count);
      break;
    default:
      game.count = 0x100;
      nextAttractStep(game);
      screen.draw = TitleShows.FADED;
      startMode(game, MenuMode.DEMO, 0, (g) => chooseDemoFighters(g, data.scenes));
  }
  drawTitle(game, data.scenes, screen.draw);
}
