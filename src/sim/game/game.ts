/**
 * The game from power-on, a field at a time, as its main loop runs: the sounds asked for last
 * field reach the voices, the counters and both random generators step, the pads are read (each
 * pad's raw bits through its mapping, opposite directions cancelled, held, newly pressed, and the
 * menus' repeats), and the scene playing takes its step.
 */
import { theaterScene } from './theater.ts';
import { musicFrame, musicTick, syncMusic } from '../sound/music.ts';
import { recordsLoaderScene, recordsScene } from './records-screen.ts';
import { startDemo } from './attract.ts';
import { attractScene } from './intro.ts';
import { flushSound } from '../fight/fight.ts';
import { clearHudView } from '../fight/hud.ts';
import type { FightTables, MatchSetup } from '../fight/match.ts';
import type { FightData } from '../fight/state.ts';
import type { SceneTables } from '../data/scenes.ts';
import { bootScene, loaderScene, logoScene } from './logo.ts';
import { titleScene } from './title.ts';
import { menuScene, modeScene } from './menu.ts';
import { FightStep, fightScene, matchSetup } from './fight-scene.ts';
import { goToScene, holdPicture, queueFile } from './logo.ts';
import { stopMotors } from './menu.ts';
import { versusScene } from './versus.ts';
import { selectScene } from './select.ts';
import { blankGameState, Scene, type GameState } from './state.ts';

/** What the game reads: the fight's tables and the scenes', each match's data once it is loaded (null until then), and each attract intro's (its moveset and models). */
export interface GameData {
  readonly tables: FightTables;
  readonly scenes: SceneTables;
  fightData(setup: MatchSetup): FightData | null;
  introData(intro: number): FightData;
}

const PAD_BITS = 16;
const UP_DOWN = 0x5000;
const LEFT_RIGHT = 0xa000;
/** A held button repeats once its count passes this, every fourth field. */
const REPEAT_AFTER = 0x13;
/** The fight's screen: its centre and the distance to it. */
const SCREEN = { x: 192 << 16, y: 240 << 16, distance: 500 };
/** The VABs the fighters' banks open in, none loaded at the start. */
const NO_BANK = 0xff;
const FIGHTER_VABS = [2, 3];

/** The pads read: mapped, cancelled, held, newly pressed, raw, and the repeats. */
function readPads(game: GameState, raw: readonly [number, number]): void {
  const input = game.world.input;
  for (let pad = 0; pad < 2; pad += 1) {
    const bits = raw[pad]!;
    const map = game.pads.maps[pad]!;
    let mapped = 0;
    for (let bit = 0; bit < PAD_BITS; bit += 1) if ((bits >> bit) & 1) mapped |= map[bit]!;
    if ((mapped & UP_DOWN) === UP_DOWN) mapped &= 0xafff;
    if ((mapped & LEFT_RIGHT) === LEFT_RIGHT) mapped &= 0x5fff;
    input.pads.pressed[pad] = (mapped ^ input.pads.held[pad]!) & mapped;
    input.pads.held[pad] = mapped;
    const fresh = (input.rawPads[pad]! ^ bits) & bits;
    input.fresh[pad] = fresh;
    input.rawPads[pad] = bits;
    const counts = game.pads.counts[pad]!;
    let repeats = 0;
    for (let bit = PAD_BITS - 1; 0 <= bit; bit -= 1) {
      repeats <<= 1;
      if (((bits >> bit) & 1) === 0) counts[bit] = 0;
      else if (((fresh >> bit) & 1) !== 0) {
        counts[bit] = 1;
        repeats |= 1;
      } else {
        const held = (counts[bit]! + 1) & 0xff;
        counts[bit] = held;
        if (REPEAT_AFTER < held) {
          if ((held & 3) === 0) repeats |= 1;
          counts[bit] = (held - 4) & 0xff;
        }
      }
    }
    game.pads.repeats[pad] = repeats;
  }
}

export class Game {
  readonly state: GameState;
  readonly data: GameData;
  /** The data of the match being fought. */
  private match: FightData | null = null;

  /** Power on: the executable's starting values, then the boot. */
  constructor(data: GameData) {
    this.data = data;
    const game = blankGameState();
    const on = data.scenes.powerOn;
    game.next = on.next;
    game.last = on.last;
    game.attractOverlay = on.attractOverlay;
    Object.assign(game.options, { ...on.options, vibration: [...on.options.vibration], lastChoices: [...on.options.lastChoices], keys: on.keys.map((pad) => [...pad]) });
    game.earned.ball = on.ball;
    game.earned.theater = on.theater;
    game.menu.picked = on.picked;
    game.menu.toOptions = on.toOptions;
    game.records.earnedRoster = on.earnedRoster;
    game.records.extraCostumes = on.extraCostumes;
    game.versusPortraits.splice(0, 2, ...on.versusPortraits);
    game.versusBackground = on.versusBackground;
    game.records.extraDrawn = on.extraDrawn;
    on.plays.forEach((row, roster) => game.records.plays[roster]!.splice(0, 4, ...row));
    game.records.endings.splice(0, 2, ...on.endings);
    Object.assign(game.records, { newest: on.newest, playsSince: on.playsSince, scheduleStep: on.scheduleStep, scheduleStarted: on.scheduleStarted });
    on.times.forEach((time, roster) => Object.assign(game.records.times[roster]!, time));
    on.survivors.forEach((record, i) => Object.assign(game.records.survivors[i]!, record));
    Object.assign(game.records, { timeSet: on.timeSet, survivorSet: on.survivorSet, list: on.list, stageTurn: on.stageTurn, naming: on.naming, demoTurn: on.demoTurn });
    Object.assign(game.records.holder, on.holder);
    game.lastAttractOverlay = on.lastAttractOverlay;
    Object.assign(game.attract, { step: on.attractStep, intro: on.intro, intros: on.intros });
    this.state = game;
    this.boot();
  }

  /** The boot: the fighters' records, the fight's screen, no bank loaded, the first scene, the demo flag up. */
  private boot(): void {
    const game = this.state;
    const world = game.world;
    const [a, b, c] = world.fighters;
    a.movesetSlot = 0;
    b.movesetSlot = 1;
    c.movesetSlot = 1;
    a.slot = 0;
    b.slot = 1;
    c.slot = 2;
    world.screen.offsetX = SCREEN.x;
    world.screen.offsetY = SCREEN.y;
    world.screen.distance = SCREEN.distance;
    for (const vab of FIGHTER_VABS) world.sound.vabs[vab] = NO_BANK;
    game.scene = Scene.BOOT;
    game.step = 0;
    world.frameCount = 0;
    world.joined[0] = 0;
    world.joined[1] = 0;
    world.attract = 1;
    world.pause.paused = 0;
    world.pause.frozen = 0;
    game.held = 0;
  }

  /** The match the game is about to fight, or is fighting, once its characters and stage are chosen; else null. */
  upcoming(): MatchSetup | null {
    const game = this.state;
    const chosen = (game.scene === Scene.VERSUS && 1 < game.step) || (game.scene === Scene.FIGHT && FightStep.LOAD <= game.step);
    return chosen ? matchSetup(game) : null;
  }

  /** Whether the next field needs a match's data not loaded yet (the page waits for it before stepping). */
  blocked(): boolean {
    const game = this.state;
    return game.scene === Scene.FIGHT && game.step === FightStep.LOAD && this.data.fightData(matchSetup(game)) === null;
  }

  /** The data of the match being fought, if any. */
  get fightData(): FightData | null {
    return this.match;
  }

  /** One field: a frame, or a field the last frame's waits still spend (only the sound's tick then). */
  field(raw: readonly [number, number]): void {
    const game = this.state;
    const world = game.world;
    const music = syncMusic(world.sound, this.data.tables.music);
    flushSound(world, this.data.tables);
    game.vblanks = (game.vblanks + 1) >>> 0;
    musicTick(music);
    world.frameRan = 0;
    if (game.vblanks < game.clock.next) return;
    world.frameRan = 1;
    game.clock.now = game.vblanks;
    world.sound.stamp = game.vblanks;
    game.movie.shows.length = 0;
    world.vsyncSeen = game.vblanks;
    game.noise = (Math.imul(game.noise, 5) + 1) >>> 0;
    world.frameSeed = Math.imul(world.frameSeed + 1, 0x10dcd) >>> 0;
    world.nothingDrawn = 0;
    world.posed = 0;
    readPads(game, raw);
    musicFrame(music, this.data.tables.music);
    world.frameCount = (world.frameCount + 1) >>> 0;
    if (game.held === 0) world.drawBuffer ^= 1;
    clearHudView(world);
    world.pauseMenu.drawn = 0;
    game.printed.length = 0;
    game.fades.length = 0;
    game.logo.shows = 3;
    /* The attract intro's own ways (its sparks, no blinking) hold while its scene plays. */
    world.attractIntro = game.scene === Scene.ATTRACT ? 1 : 0;
    this.scene();
    syncMusic(world.sound, this.data.tables.music);
    game.clock.next = Math.floor(game.clock.now) + 1;
  }

  private scene(): void {
    const game = this.state;
    switch (game.scene) {
      case Scene.BOOT:
        return bootScene(game);
      case Scene.LOADER:
        return loaderScene(game);
      case Scene.LOGO:
        return logoScene(game, this.data.tables);
      case Scene.MENU:
        return menuScene(game, this.data.tables, this.data.scenes);
      case Scene.MODE:
        return modeScene(game);
      case Scene.FIGHT:
        return fightScene(game, {
          tables: this.data.tables,
          scenes: this.data.scenes,
          load: (setup) => {
            const data = this.data.fightData(setup);
            if (data === null) throw new Error("the match's data is not loaded");
            this.match = data;
            return data;
          },
          match: this.match,
        });
      case Scene.VERSUS:
        return versusScene(game, this.data.tables, this.data.scenes);
      case Scene.OVERLAY_LOADER:
        holdPicture(game, 0);
        stopMotors(game);
        queueFile(game);
        return goToScene(game, game.next, 0);
      case Scene.MOVIE:
        return theaterScene(game, this.data.tables, this.data.scenes);
      case Scene.SELECT:
        return selectScene(game, this.data.tables, this.data.scenes);
      case Scene.RECORDS_LOADER:
        return recordsLoaderScene(game, this.data.tables, this.data.scenes);
      case Scene.RECORDS:
        return recordsScene(game, this.data.tables, this.data.scenes);
      case Scene.ATTRACT:
        return attractScene(game, { tables: this.data.tables, scenes: this.data.scenes, intro: (intro) => this.data.introData(intro) });
      case Scene.TITLE:
        return titleScene(game, this.data.tables, this.data.scenes, (g) => startDemo(g, this.data.scenes));
      default:
        throw new Error(`scene ${game.scene} is not remade yet`);
    }
  }
}
