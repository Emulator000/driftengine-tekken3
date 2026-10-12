/**
 * Ogre's change into True Ogre: Arcade's scene between the first round won against Ogre and the
 * match against True Ogre, played in the fight's engine on Ogre's stage.
 *
 * Its set-up (a field of black): the voices keyed off, both fighters reset and stood at the
 * stage's centre facing alike, the human dressed as the ninth stage's boss, both models set up
 * again, the scenery at the origin. Then its camera's script set up (a field of black); then its
 * script, by the human's side, a frame a field: each side's move posed from a frame on and held at
 * its last, its song, and a fade to white (the scenery left out as it all but covers the picture),
 * under the camera's script; then white for four fields. Start on the human's pad cuts it short
 * (`fight-scene.ts`).
 */
import type { SceneTables } from '../data/scenes.ts';
import { layArena, stepScenery } from '../fight/arena.ts';
import { setPushRadii } from '../fight/body.ts';
import { introCamera, startIntroCamera, stepCamera } from '../fight/camera.ts';
import { chooseFighterBanks, setUpModel } from '../fight/match.ts';
import { moveEvents } from '../fight/move-events.ts';
import { moveById } from '../fight/moves.ts';
import { fadeFlash, poseFighter, skeletonCamera } from '../fight/pose.ts';
import { resetFighter } from '../fight/start.ts';
import type { FightData } from '../fight/state.ts';
import { keyOffVoices, playSong } from '../fight/voices.ts';
import { setPack } from './intro.ts';
import type { GameState } from './state.ts';
import { fade } from './title.ts';

/** What a field of the change shows: nothing of its own, black, the scene, white. */
export const OgreChangeShows = { NONE: 0, BLACK: 1, SCENE: 2, WHITE: 3 } as const;
/** The script's kinds of event: the first side's move, the second's, the fade to white, the song, the end. */
const Event = { MOVE: 2, MOVE_TWO: 3, WHITE: 5, SONG: 6, END: -1 } as const;
/** Heihachi's roster id: dressed as the ninth stage's boss he wears Jin's packs, anyone else Heihachi's (each by the boss's costume). */
const HEIHACHI = 0xd;
const JIN_PACKS = [0x12, 0x13] as const;
const HEIHACHI_PACKS = [0x1a, 0x1b] as const;
/** The ninth stage's opponent: the boss. */
const BOSS = 8;
/** The change's song, its camera's script set, the way both sides face. */
const SONG = 5;
const CAMERA_SET = 2;
const FACING = 0x4000;
/** The frames moves cut without blending once their blends are stopped. */
const NO_BLEND = 0x14;
/** The fades' table entries (the fade to white, the white held), the level past which the scenery is left out, and white. */
const FADE_LAYER = 2;
const WHITE_LAYER = 7;
const SCENERY_GONE = 0xcf;
const FULL = 0x100;
/** Where the white is held from once the script ends: four fields. */
const WHITE_HELD = 2;

/** The script played: the first side's when the human plays it, else the second's. */
const scriptOf = (game: GameState, scenes: SceneTables) => scenes.ogreChange.scripts[(game.world.match.humanSides & 1) !== 0 ? 0 : 1]!;

/**
 * The change set up: its script, fade and scenery reset, the scenery at the origin, the voices
 * keyed off, the blends stopped, both fighters reset (the first where it stands; the second on its
 * own side when the first's model pack has a fist shape of its own, else where it stands), each
 * side's record cleared, the human dressed as the boss, both models set up again, and both at the
 * centre facing alike.
 */
export function startOgreChange(game: GameState, data: FightData): void {
  const world = game.world;
  const change = game.ogreChange;
  const [a, b] = world.fighters;
  change.phase = 0;
  change.event = 0;
  change.fading = 0;
  change.sceneryOff = 0;
  world.sceneryAtOrigin = 1;
  keyOffVoices(world, false);
  for (const f of [a, b]) {
    f.blend.kind = 0;
    world.noBlendFrames = NO_BLEND;
  }
  const fists = data.skeleton.hands.fists;
  const fresh = a.costume >>> 0 < fists.length && fists[a.costume] !== 0;
  resetFighter(world, data, a, b, false);
  resetFighter(world, data, b, a, fresh);
  chooseFighterBanks(world, data);
  for (const side of change.sides) Object.assign(side, { active: 0, move: 0, frame: 0 });
  const human = (world.match.humanSides & 1) !== 0 ? a : b;
  const other = human === a ? b : a;
  const packs = human.roster === HEIHACHI ? JIN_PACKS : HEIHACHI_PACKS;
  setPack(data, human, packs[game.run.opponents[BOSS]!.costume !== 0 ? 1 : 0]);
  human.character = human.roster;
  setUpModel(world, data, human);
  setUpModel(world, data, other);
  for (const f of [a, b]) {
    f.facing = FACING;
    f.tilt.x = 0;
    f.position.fill(0);
    f.tilt.z = 0;
    f.heading = FACING;
  }
  change.shows = OgreChangeShows.BLACK;
}

/** The script's events due by this frame: the sides' moves, the fade to white, the song; at its end, the white held. */
function playScript(game: GameState, data: FightData, scenes: SceneTables): void {
  const world = game.world;
  const change = game.ogreChange;
  const script = scriptOf(game, scenes);
  for (;;) {
    const event = script[change.event];
    if (event === undefined) throw new Error(`Ogre's change's script ran past its end at event ${change.event}`);
    const [frame, kind, first, second, third] = event;
    if (change.time < frame) return;
    if (kind === Event.END) {
      change.time = WHITE_HELD;
      change.phase = 2;
      return;
    }
    if (kind === Event.MOVE || kind === Event.MOVE_TWO) {
      const n = kind - Event.MOVE;
      const f = world.fighters[n]!;
      const side = change.sides[n]!;
      if (side.move !== first) {
        f.rootMove = moveById(data, f, first);
        f.move = f.rootMove;
      }
      side.move = first;
      side.frame = second;
      side.last = third;
      side.active = 1;
    } else if (kind === Event.WHITE) {
      change.fadeStep = first;
      change.fade = 0;
      change.fading = 1;
    } else if (kind === Event.SONG) playSong(world, SONG, false);
    change.event += 1;
  }
}

/** Each side playing its move posed at its frame (the first side's move events read, the eyes' opening bit not), then a frame on, held at its last. */
function poseSides(game: GameState, data: FightData): void {
  const world = game.world;
  const a = world.fighters[0];
  game.ogreChange.sides.forEach((side, n) => {
    if (side.active !== 1) return;
    const f = world.fighters[n]!;
    f.frame = side.frame + 1;
    f.rootFrame = f.frame;
    world.posingChange = 1;
    if (a.move !== null) moveEvents(world, data, a);
    else a.eventHealth = 0;
    world.skipBlend = 1;
    poseFighter(world, data, f, () => {});
    world.posingChange = 0;
    side.frame += 1;
    if (side.last < side.frame) side.frame = side.last;
  });
}

/** The camera: its script until it hands back, then the fight's camera. */
function moveCamera(game: GameState, data: FightData): void {
  const change = game.ogreChange;
  if (change.cameraDone === 0) change.cameraDone = introCamera(game.world, data, 0);
  else stepCamera(game.world, data);
}

/**
 * A field of the change: its camera's script set up (black); then its script's events, the sides
 * posed, the camera, the arena and (until it is left out) the scenery, the fade to white; then
 * white held. True once the white has held its fields.
 */
export function stepOgreChange(game: GameState, data: FightData, scenes: SceneTables): boolean {
  const world = game.world;
  const change = game.ogreChange;
  switch (change.phase) {
    case 0:
      startIntroCamera(world, data, CAMERA_SET);
      change.cameraDone = 0;
      change.time = 0;
      change.phase = 1;
      change.shows = OgreChangeShows.BLACK;
      return false;
    case 1:
      playScript(game, data, scenes);
      poseSides(game, data);
      moveCamera(game, data);
      layArena(world, data);
      if (change.sceneryOff === 0) stepScenery(world, data);
      setPushRadii(data, world.fighters[0]);
      fadeFlash(world);
      skeletonCamera(world);
      if (world.nothingDrawn === 0) world.framesDrawn = (world.framesDrawn + 1) & 0xff;
      if (change.fading !== 0) {
        if (SCENERY_GONE < change.fade) change.sceneryOff = 1;
        if (FULL < change.fade) change.fade = FULL;
        fade(game, FADE_LAYER, change.fade + FULL);
        change.fade += change.fadeStep;
      }
      change.time += 1;
      change.shows = OgreChangeShows.SCENE;
      return false;
    case 2:
      fade(game, WHITE_LAYER, 2 * FULL);
      moveCamera(game, data);
      change.time -= 1;
      change.shows = OgreChangeShows.WHITE;
      return change.time < 0;
    default:
      return true;
  }
}
