/**
 * Practice (mode 5): one endless round, its health held and its timer stopped, its own menus over
 * the paused fight (`practice-menu.ts`). It opens on MODE SELECT by itself; 1P FREESTYLE puts a
 * training dummy (standing, crouching, guarding, rolling, or played from the second pad) against
 * the human, VS CPU the computer at a chosen difficulty and stage, COMBO TRAINING the dummy while
 * select plays a stored combo on the COMBO PLAYER's fighter with its inputs shown. Its options
 * keep the damage taken and dealt (ATTACK DATA), make every clean hit on the partner a counter hit
 * (COUNTER ATTACKS), colour each fighter blue while a cancel is open to it and red while none is
 * (HIT ANALYSIS), and replay a combo of four, five or six hits as it ends (COMBO REPLAY). A hidden
 * recorder in 1P FREESTYLE records the human's inputs and plays them back.
 */
import type { SceneTables } from '../data/scenes.ts';
import { cancelOpen } from '../fight/cancel.ts';
import { resetCameraAfterReplay } from '../fight/camera.ts';
import { resetComputerRecord } from '../fight/computer.ts';
import { resetInputs, startReplay } from '../fight/flow.ts';
import { clearInput } from '../fight/input.ts';
import { endSoundScript } from '../fight/move.ts';
import { moveAt, moveById } from '../fight/moves.ts';
import { InputSource, type FightData, type FightState, type Fighter } from '../fight/state.ts';
import { keyOffVoices, reverbOff, voiceLine } from '../fight/voices.ts';
import { resetPool } from '../effects/pool.ts';
import { clearDust, clearSparks, startEvents } from '../effects/sparks.ts';
import { s16, s8 } from '../math/integers.ts';
import { rotateLong } from '../math/matrix.ts';
import { projectPoint } from '../math/projection.ts';
import { ReplayState } from '../fight/replay.ts';
import { practiceMenu } from './practice-menu.ts';
import { practiceHud } from './practice-hud.ts';
import { clearEntries, closeRecording, comboCount, idleRestart, loadCombo, play, record, resetPlayback } from './practice-recorder.ts';
import type { GameState } from './state.ts';

/** What practice reads: the match's data and the scenes' tables. */
export interface PracticeData {
  readonly match: FightData;
  readonly scenes: SceneTables;
}

export const PracticeMode = { FREESTYLE: 0, VS_CPU: 1, COMBO: 2, PLAYER_SELECT: 3, RESET: 4 } as const;
export const Partner = { CONTROLLER: 0, DUMMY: 1, COMPUTER: 2 } as const;
/** The training dummy's settings past the guards: auto guard, the quick rolls, played from a pad. */
export const Dummy = { STAND: 0, CROUCH: 1, STAND_GUARD: 2, CROUCH_GUARD: 3, GUARD_ALL: 4, AUTO_GUARD: 5, ROLL_BACK: 6, ROLL_FORWARD: 7, CONTROLLER: 8 } as const;
/** The combo replay: off, after 4, 5 or 6 hits, or on select. */
export const MANUAL_REPLAY = 4;
/** The session's steps. */
const Step = { IDLE: 0, READY: 1, ARMED: 2, RECORDING: 3, SETTLING: 4, SHOWING: 5, PLAYING: 6, ENDING: 7 } as const;
/** The input display's looks. */
export const Look = { PLAIN: 1, ALL: 2, DONE: 3, SHOWING: 4 } as const;

const UP = 0x1000;
const DOWN = 0x4000;
const BACK = 0x8000;
const LEFT_RIGHT = 0xa000;
const SELECT = 0x100;
/** The four buttons as a pad holds them; the shoulders and the circle held as the menu closes (the recorder's secret). */
const BUTTONS = 0xf0ff;
const SECRET = 0x2f;
const START_WAIT = 0x1e;
const MENU_WAIT = 3;
const LOOK_WAIT = 0x60;
const MARKER_FRAMES = 0x3c;
const COMBO_SHOWN = 0x5a;
const LONGEST_REPLAY = 300;
const SHORTEST_REPLAY = 0x5a;
const MANUAL_LONGEST = 0x118;
const AFTER_COMBO = 0x1e;
/** The recorder's last entry. */
const LAST_ENTRY = 0x31;
/** Doctor B.'s moveset, which the dummy leaves alone; the guide's buttons and their sounds. */
const DOCTOR_B = 0x12;
const GUIDE: readonly (readonly [number, number])[] = [
  [0x80, 0x4c70],
  [0x10, 0x4c71],
  [0x40, 0x4c72],
  [0x20, 0x4c73],
];
/** HIT ANALYSIS's colours: red where nothing can be done, blue where a cancel is open. */
const RED = [1, 0xfa, 0, 0];
const BLUE = [1, 0, 0, 0xfa];
const NO_COLOUR = [0, 0, 0, 0];
/** Moves that keep their combo going whatever their flag says (King's, Xiaoyu's, Bryan's), by character. */
const COMBO_KEEPERS: Readonly<Record<number, (id: number) => boolean>> = {
  4: (id) => id === 0x12d || id === 0x131 || id === 0x136 || id === 0x484,
  7: (id) => ((id - 0x5a1) & 0xffff) < 3,
  0xc: (id) => ((id - 0x832) & 0xffff) < 3,
};
/** King's throw that does not count a hit as it holds. */
const KING = { character: 3, move: 0xb82 } as const;

const human = (game: GameState): Fighter => game.world.fighters[game.world.match.streakSide]!;
const partner = (game: GameState): Fighter => game.world.fighters[game.run.newcomer]!;

/** The record of a fighter's computer player. */
function computerRecordOf(state: FightState, f: Fighter) {
  const rec = state.computer.records[f.computerRecord];
  if (rec === undefined) throw new Error(`fighter ${f.slot} has no computer record`);
  return rec;
}

/** The partner's computer record set to practice's difficulty and stage. */
function tuneComputer(game: GameState, data: FightData, f: Fighter): void {
  const p = game.practice;
  resetComputerRecord(game.world, data, computerRecordOf(game.world, f), p.cpuDifficulty, p.cpuLevel, -1);
}

/** As practice's round starts: its menus at MODE SELECT, its options as they start, the inputs cleared, its records empty. */
export function practiceRoundStart(game: GameState, data: FightData): void {
  const p = game.practice;
  const world = game.world;
  Object.assign(p, {
    paused: 0,
    wasPaused: 0,
    modeSelect: 1,
    mode: PracticeMode.FREESTYLE,
    startWait: START_WAIT,
    hitAnalysis: 0,
    attackData: 1,
    counterAttacks: 0,
    comboReplay: 0,
    partnerKind: Partner.DUMMY,
    cpuDifficulty: 1,
    cpuLevel: 2,
    inputShown: 1,
    session: 0,
    guide: 0,
    dummy: Dummy.STAND,
    player: world.match.streakSide,
    comboType: 0,
    keyOffOnPause: 0,
    menuWait: 0,
    commandList: 0,
    step: Step.IDLE,
  });
  world.practice.starting = 1;
  p.cursor.fill(0);
  p.attacking.fill(0);
  p.canAct.fill(0);
  clearEntries(p, 0);
  clearEntries(p, 1);
  resetInputs(world, InputSource.PAD);
  clearOnPause(game);
  resetComputerRecord(world, data, computerRecordOf(world, world.fighters[1]!), p.cpuDifficulty, p.cpuLevel, -1);
  resetInputs(world, InputSource.NONE);
  world.practice.counters.fill(0);
  for (const r of p.records) for (const key of Object.keys(r) as (keyof typeof r)[]) r[key] = 0;
  /* The waiting room's fight starting: the quick match or the room asked for now, its character chosen. */
  const online = game.online;
  if (online.warming === 1) Object.assign(online, { ask: online.pending, pending: '', warming: 2 });
  world.practice.waitingRoom = online.warming !== 0 ? 1 : 0;
  /*
   * ONLINE MODE's waiting room: a fight at once, as the menu's closing leaves it (the pads the
   * players', the dummy standing, the attack data shown); start opens the menu as ever.
   */
  if (game.online.warming !== 0) {
    world.practice.starting = 0;
    resetInputs(world, InputSource.PAD);
    partnerControl(game, data, human(game), partner(game));
  }
}

/** What a pause's start and practice's round start clear: the colours, the markers, the input display. */
function clearOnPause(game: GameState): void {
  const p = game.practice;
  for (const colour of game.world.practice.colours) colour.splice(0, 4, ...NO_COLOUR);
  for (const marker of p.markers) marker.timer = 0;
  Object.assign(p, { markerAt: 0, lookWait: 0, look: 0, cancelLabel: 1 });
}

/** Who plays the partner (and the human, from its pad): the dummy, a pad, or the computer, by the mode. */
function partnerControl(game: GameState, data: FightData, h: Fighter, partnerFighter: Fighter): void {
  const p = game.practice;
  const sources = game.world.input.sources;
  h.human = 1;
  h.computer = 0;
  sources[h.slot] = InputSource.PAD;
  if (p.mode === PracticeMode.VS_CPU) p.partnerKind = Partner.COMPUTER;
  else if (p.mode === PracticeMode.FREESTYLE) p.partnerKind = p.dummy === Dummy.CONTROLLER ? Partner.CONTROLLER : Partner.DUMMY;
  else if (p.mode === PracticeMode.COMBO) {
    p.partnerKind = Partner.DUMMY;
    p.dummy = Dummy.STAND;
  }
  if (p.partnerKind === Partner.DUMMY) {
    partnerFighter.human = 0;
    partnerFighter.computer = 0;
    sources[partnerFighter.slot] = InputSource.REPLAY;
    dummy(game.world, data, partnerFighter, h, p.dummy);
  } else if (p.partnerKind === Partner.CONTROLLER) {
    partnerFighter.human = 1;
    partnerFighter.computer = 0;
    sources[partnerFighter.slot] = InputSource.PAD;
  } else if (p.partnerKind === Partner.COMPUTER) {
    partnerFighter.human = 0;
    partnerFighter.computer = 1;
    sources[partnerFighter.slot] = InputSource.PAD;
  }
}

/** Whether a fighter's next move stands it up: its pad set to up when it would, true when it already stands. */
function stand(state: FightState, data: FightData, d: Fighter): boolean {
  const next = d.next.move ?? (d.move === null ? null : moveById(data, d, moveAt(data, d.move).next));
  const flags = next === null ? 0 : moveAt(data, next).flags;
  d.input.replayHeld = (flags & 0x204) !== 0 ? UP : 0;
  return d.input.replayHeld === 0;
}

/** A quick roll out of a fall, forward or back, on every other frame while the fall's cancels allow one. */
function quickRoll(state: FightState, data: FightData, d: Fighter, forward: boolean): void {
  if (d.next.move !== null || d.holds[1] === 0 || d.move === null) return;
  const move = moveAt(data, d.move);
  if (move.stepWindow.first === 0) return;
  const cancels = data.sets[d.move.set]!.moveset.cancels;
  for (let i = move.cancels; cancels[i] !== undefined && cancels[i]!.command !== 0xc000; i += 1) {
    if (cancels[i]!.type !== 0x1c) continue;
    d.input.replayHeld = (state.frameCount & 1) !== 0 ? (forward ? 0x60 : 0x90) : 0;
    return;
  }
}

/** The training dummy's pad this frame, as its setting plays it against the human's attack. */
function dummy(state: FightState, data: FightData, d: Fighter, o: Fighter, setting: number): void {
  if (d.character === DOCTOR_B) return;
  if (setting === Dummy.ROLL_BACK || setting === Dummy.ROLL_FORWARD) {
    d.human = 0;
    if (d.holds[1] !== 0) quickRoll(state, data, d, setting === Dummy.ROLL_BACK);
    else stand(state, data, d);
    return;
  }
  if (!stand(state, data, d)) return;
  const attacking = o.move !== null && o.frame <= moveAt(data, o.move).activeWindow.last;
  switch (setting) {
    case Dummy.CROUCH:
      d.input.replayHeld = DOWN;
      break;
    case Dummy.STAND_GUARD:
      if ((o.level & 0x10) !== 0 && attacking) d.input.replayHeld = BACK;
      break;
    case Dummy.CROUCH_GUARD:
      d.input.replayHeld = DOWN;
      if ((o.level & 8) !== 0 && attacking) d.input.replayHeld = BACK | DOWN;
      break;
    case Dummy.GUARD_ALL:
      if ((o.level & 0x18) !== 0 && attacking) d.input.replayHeld = (o.level & 0x10) !== 0 ? BACK : BACK | DOWN;
      break;
    case Dummy.AUTO_GUARD:
      d.human = 1;
      return;
  }
  d.human = 0;
}

/** The menu closed: the partner played as set, the computer tuned, the mode's session set up (the recorder's secret held as it closes). */
function menuClosed(game: GameState, data: PracticeData, h: Fighter, partnerFighter: Fighter): void {
  const p = game.practice;
  partnerControl(game, data.match, h, partnerFighter);
  if (p.partnerKind === Partner.COMPUTER) tuneComputer(game, data.match, partnerFighter);
  p.playAgain = 0;
  if (p.mode === PracticeMode.VS_CPU) {
    p.counterAttacks = 0;
    p.session = 0;
    clearEntries(p, p.humanSide);
  } else if (p.mode === PracticeMode.COMBO) {
    p.counterAttacks = 0;
    p.session = 1;
    p.inputShown = 1;
    clearEntries(p, p.player);
    resetPlayback(p, p.player);
    loadCombo(p, game.world, data.scenes.practice, p.player, 0);
  } else if (p.mode === PracticeMode.FREESTYLE) {
    p.session = (p.pad.raw & SECRET) === SECRET && p.comboReplay !== MANUAL_REPLAY ? 1 : 0;
    clearEntries(p, p.humanSide);
    resetPlayback(p, p.humanSide);
  }
}

/** Whether a fighter has stood up facing its opponent (settling its pad meanwhile). */
function settle(state: FightState, data: FightData, f: Fighter): boolean {
  if (f.facingQuadrant !== 0) {
    f.input.replayHeld = f.next.move !== null ? 0 : BACK;
    return false;
  }
  const standing = f.moveId === 3 || f.moveId === 4 || f.moveId === 5 || (f.move !== null && f.moveId === moveAt(data, f.move).next);
  if (!standing) return false;
  f.input.replayHeld = 0;
  return true;
}

/** A recording's player stopped by a clean hit on it or a move it is thrown into. */
const interrupted = (f: Fighter): boolean => (f.hitClean !== 0 ? true : f.next.move !== null && f.next.type === 4);

/** A fighter's input to be played: cleared and read from the recording. */
function playSource(state: FightState, f: Fighter): void {
  clearInput(state, f);
  state.input.sources[f.slot] = InputSource.REPLAY;
}

/** The session's step: COMBO TRAINING's demonstration, or the hidden recorder's recording and playback. */
function sessionStep(game: GameState, data: PracticeData, h: Fighter): void {
  const p = game.practice;
  const world = game.world;
  const tables = data.scenes.practice;
  const player = world.fighters[p.player]!;
  switch (p.step) {
    case Step.IDLE:
      if (p.mode === PracticeMode.COMBO) {
        p.guide = 1;
        resetPlayback(p, p.player);
        loadCombo(p, world, tables, p.player, p.comboType);
        p.step = Step.READY;
      } else if (p.mode === PracticeMode.FREESTYLE) p.step = Step.READY;
      break;
    case Step.READY:
      if (p.lookWait !== 0) p.lookWait -= 1;
      else {
        p.lookWait = 0;
        p.look = Look.ALL;
      }
      if (p.mode === PracticeMode.COMBO && comboCount(tables, player.character) !== 0 && (p.pad.fresh & SELECT) !== 0) {
        clearInput(world, player);
        playSource(world, player);
        p.look = Look.SHOWING;
        p.guide = 2;
        p.step = Step.SETTLING;
      } else if (p.mode === PracticeMode.FREESTYLE && p.session !== 0 && ((p.pad.fresh & SELECT) !== 0 || p.playAgain !== 0)) {
        if ((p.pad.raw & DOWN) !== 0) {
          clearEntries(p, p.player);
          p.guide = 2;
          p.look = Look.PLAIN;
          p.step = Step.ARMED;
        } else {
          if ((p.pad.raw & LEFT_RIGHT) !== 0) p.playAgain = 1;
          clearInput(world, player);
          resetPlayback(p, p.player);
          playSource(world, player);
          p.guide = 2;
          p.look = Look.PLAIN;
          p.step = Step.PLAYING;
        }
      }
      break;
    case Step.ARMED:
    case Step.RECORDING:
      /* Armed, the first input starts the recording at once. */
      if (p.step === Step.ARMED) {
        if ((p.pad.pressed & BUTTONS) === 0) break;
        p.step = Step.RECORDING;
      }
      record(p, world, p.player);
      if ((p.pad.fresh & SELECT) !== 0 || p.recorder.last[p.player] === LAST_ENTRY) {
        closeRecording(p, p.player);
        p.step = Step.READY;
      }
      break;
    case Step.SETTLING:
      if (stand(world, data.match, player) && settle(world, data.match, player)) p.step = Step.SHOWING;
      break;
    case Step.SHOWING:
      if (!play(p, world, p.player)) {
        p.lookWait = LOOK_WAIT;
        p.look = Look.DONE;
        p.step = Step.IDLE;
      } else if (interrupted(player)) {
        p.look = Look.ALL;
        p.step = Step.IDLE;
      }
      break;
    case Step.PLAYING:
      if (!play(p, world, p.player)) p.step = Step.ENDING;
      break;
    case Step.ENDING:
      if (h.moveId === 3 || (h.move !== null && h.moveId === moveAt(data.match, h.move).next)) {
        p.guide = 1;
        p.step = Step.IDLE;
        if ((p.pad.raw & SELECT) !== 0) p.playAgain = 0;
      }
      break;
  }
}

/** Whether a fighter is attacking: its move or the one coming has active frames, or the other is being hit by it. */
function attacking(data: FightData, a: Fighter, b: Fighter): boolean {
  if (a.move !== null && moveAt(data, a.move).activeWindow.first !== 0) return true;
  if (a.next.move !== null && moveAt(data, a.next.move).activeWindow.first !== 0) return true;
  return b.move !== null && b.moveId !== moveAt(data, b.move).next && (b.beingHit !== 0 || b.heldMoves !== 0);
}

/** A fighter's damage record (what it took from the other), a frame on. */
function damageRecord(game: GameState, data: FightData, a: Fighter, b: Fighter): void {
  const r = game.practice.records[a.movesetSlot]!;
  const best = a.hitRecords[a.bestHit ?? 0]!;
  if (a.ownDamage !== 0) r.frames = s16(r.frames + 1);
  if (b.moveStarted !== 0) r.frames = 0;
  if (b.throwHold <= 0) r.hold = 0;
  if (b.moveStarted !== 0 && b.move !== null) {
    r.lastFlag = r.flag;
    r.flag = (moveAt(data, b.move).hitFlags >> 13) & 1;
    if (COMBO_KEEPERS[b.character]?.(b.moveId) === true) r.flag = 1;
  }
  if (a.hitClean === 0 && a.ownDamage === 0) {
    if (r.flag !== 0 && r.lastFlag !== 0) {
      if (b.whiffed !== 0) r.hits = 0;
    } else if (a.beingHit === 0 && a.heldMoves === 0) r.hits = 0;
  } else if (a.throwHold < 0) {
    if (a.ownDamage !== 0) {
      if (r.hold !== s8(b.throwHold)) {
        if (!(b.character === KING.character && b.moveId === KING.move)) r.hits = s8(r.hits + 1);
        r.hold = s8(b.throwHold);
      }
    } else if (a.hitClean !== 0) r.hits = s8(r.hits + 1);
  } else if (a.heldMoves === 0 && (r.flag === 0 || r.lastFlag === 0)) r.hits = 1;
  else r.hits = s8(r.hits + 1);
  if (100 <= r.hits) {
    r.hits = 0;
    r.timer = COMBO_SHOWN;
  }
  r.newHits = 0;
  r.endedHits = 0;
  if (r.hits !== r.lastHits) {
    if (r.lastHits < r.hits) {
      r.newHits = r.hits;
      r.shownHits = r.hits;
    }
    if (r.hits === 0) r.endedHits = r.lastHits;
  }
  if (r.hits < 2) {
    if (2 <= r.frames) r.timer = COMBO_SHOWN;
  } else if (r.newHits !== 0) r.timer = COMBO_SHOWN;
  if (0 < r.timer) r.timer -= 1;
  r.lastHits = r.hits;
  if (a.hitClean !== 0) {
    r.counter = a.counterHit !== 0 ? 1 : 0;
    r.clean = a.fromBehind !== 0 ? 1 : 0;
  }
  if (a.throwHold < 0) {
    r.counter = 0;
    r.clean = 0;
  }
  let add: number;
  if (a.hitReacting === 0 && a.hitClean === 0 && a.ownDamage === 0) add = best.dealt;
  else {
    let raw = 0;
    let dealt = 0;
    if (a.ownDamage !== 0) raw = dealt = a.ownDamage;
    else if (a.hitClean !== 0) {
      raw = best.raw;
      dealt = best.dealt;
    }
    r.raw = s16(raw);
    r.dealt = s16(dealt);
    if (r.hits < 2 && r.frames < 2) r.combo = dealt;
    else {
      r.combo = (r.combo + dealt) | 0;
      r.comboShown = r.combo;
    }
    if (1000 <= r.combo) {
      r.combo = 0;
      r.comboShown = 999;
    }
    if (r.combo < -999) {
      r.combo = 0;
      r.comboShown = -999;
    }
    add = 0 < a.ownDamage ? a.ownDamage : best.dealt;
  }
  r.total = (r.total + add) | 0;
}

/** The hit markers: each a frame shorter; a clean hit on the partner marks where it landed, by its level. */
function markers(game: GameState, data: FightData, h: Fighter, partnerFighter: Fighter): void {
  const p = game.practice;
  const world = game.world;
  for (const marker of p.markers) marker.timer = Math.max(marker.timer - 1, 0);
  if (partnerFighter.hitClean === 0 || h.move === null) return;
  p.markerAt = (p.markerAt + 1) & 3;
  const hit = hitCode(data, h);
  let at: readonly number[];
  if (hit < 0x18) at = h.segments[0]!.to;
  else {
    const part = partnerFighter.hitRecords[partnerFighter.bestHit ?? 0]!.part;
    at = partnerFighter.skeleton.joints[data.hitTables.hitSphereJoints[part]!]!.world.translation;
  }
  const moved = [0, 0, 0];
  rotateLong(world.view.rotation, at[0]!, at[1]!, at[2]!, moved);
  const point = projectPoint(world.screen, (moved[0]! + world.view.translation[0]!) | 0, (moved[1]! + world.view.translation[1]!) | 0, (moved[2]! + world.view.translation[2]!) | 0);
  Object.assign(p.markers[p.markerAt]!, { level: h.level, timer: MARKER_FRAMES, x: point.x, y: point.y });
}

/** The human's move's first hit code (0x18 and past name the effects' segments). */
function hitCode(data: FightData, f: Fighter): number {
  if (f.move === null) return 0;
  const hit = moveAt(data, f.move).hit;
  if (hit === null) return 0;
  const table = 'shared' in hit ? data.sharedHits[hit.shared] : data.sets[f.move.set]!.moveset.hitTables[hit.table];
  return table?.codes[0] ?? 0;
}

/** The frame unpaused: who plays whom, the session, the guide's sounds, the counters, the records and markers. */
function unpausedStep(game: GameState, data: PracticeData, h: Fighter, partnerFighter: Fighter): void {
  const p = game.practice;
  const world = game.world;
  partnerControl(game, data.match, h, partnerFighter);
  if (p.session === 0) {
    p.guide = 0;
    p.look = Look.PLAIN;
    p.lookWait = 0;
    if (idleRestart(p, world, data.match, p.player)) clearEntries(p, p.player);
    record(p, world, p.player);
  } else if (0 <= p.step && p.step < 10) sessionStep(game, data, h);
  p.guidePressed = h.input.replayHeld & (h.input.replayHeld ^ p.guideLast);
  p.guideLast = h.input.replayHeld;
  if (p.guide !== 0 && (p.mode !== PracticeMode.FREESTYLE || p.session === 0)) {
    for (const [bit, code] of GUIDE) if ((p.guidePressed & bit) !== 0) voiceLine(world, data.match, h.movesetSlot, code, 0);
  }
  world.practice.counters[partnerFighter.movesetSlot] = p.counterAttacks !== 0 ? 1 : 0;
  const v = attacking(data.match, h, partnerFighter) ? 1 : 0;
  p.attacking[h.movesetSlot] = v;
  p.attacking[partnerFighter.movesetSlot] = v;
  damageRecord(game, data.match, h, partnerFighter);
  damageRecord(game, data.match, partnerFighter, h);
  markers(game, data.match, h, partnerFighter);
}

/** HIT ANALYSIS: whether a cancel is open to each fighter, every frame. */
function hitAnalysis(game: GameState, data: FightData, h: Fighter, partnerFighter: Fighter): void {
  const p = game.practice;
  if (p.hitAnalysis === 0) return;
  p.canAct[h.movesetSlot] = cancelOpen(game.world, data, h, partnerFighter) ? 1 : 0;
  p.canAct[partnerFighter.movesetSlot] = cancelOpen(game.world, data, partnerFighter, h) ? 1 : 0;
}

/** Each fighter's colour: off, or by HIT ANALYSIS red or blue (not while starting or paused). */
function tint(game: GameState): void {
  const p = game.practice;
  if (game.world.practice.starting !== 0 || p.paused !== 0) return;
  for (let slot = 0; slot < 2; slot += 1) game.world.practice.colours[slot]!.splice(0, 4, ...(p.hitAnalysis === 0 ? NO_COLOUR : p.canAct[slot] === 0 ? RED : BLUE));
}

/** COMBO REPLAY: the replay's end puts the fight back as it was; a combo ended (or select, set to MANUAL) replays it. */
function comboReplay(game: GameState, data: FightData, partnerFighter: Fighter, h: Fighter): void {
  const p = game.practice;
  const world = game.world;
  const r = p.records[partnerFighter.movesetSlot]!;
  r.hitsEnded = r.hits === 0 && r.hitsSeen !== 0 ? r.hitsSeen : 0;
  r.hitsSeen = r.hits;
  if (world.replay.state === ReplayState.ENDED) {
    const replay = world.replay;
    Object.assign(replay, { state: ReplayState.RECORDING, recordFrame: 0, playFrame: 0, knockoutStart: -2, soundShift: 0, index: 0, skip: 0, recorded: 0 });
    resetPool(world);
    startEvents(world);
    clearSparks(world);
    clearDust(world, data);
    endSoundScript(partnerFighter);
    endSoundScript(h);
    p.sinceReplay = 0;
    resetCameraAfterReplay(world, data, partnerFighter, h);
  }
  if (world.replaying !== 0) return;
  if (p.paused === 0) {
    if (p.comboReplay === MANUAL_REPLAY) p.sinceCombo = 0;
    else if (r.hitsEnded === 0 && r.hits === 0 && p.attacking[h.movesetSlot] !== 0 && h.move !== null) p.sinceCombo = moveAt(data, h.move).length;
    else p.sinceCombo += 1;
    p.sinceReplay = Math.min(p.sinceReplay + 1, LONGEST_REPLAY);
  } else p.sinceCombo = 0;
  if (p.sinceReplay < SHORTEST_REPLAY) return;
  let go = false;
  if (p.comboReplay === 1) go = 4 <= r.endedHits;
  else if (p.comboReplay === 2) go = 5 <= r.endedHits;
  else if (p.comboReplay === 3) go = 6 <= r.endedHits;
  else if (p.comboReplay === MANUAL_REPLAY && (p.pad.fresh & SELECT) !== 0) {
    p.sinceReplay = Math.min(p.sinceReplay, MANUAL_LONGEST);
    go = true;
  }
  if (!go) return;
  let n = p.sinceReplay;
  if (p.comboReplay !== MANUAL_REPLAY && p.sinceCombo !== 0) n = p.sinceCombo + AFTER_COMBO;
  n = Math.min(Math.max(Math.min(n, p.sinceReplay), SHORTEST_REPLAY), LONGEST_REPLAY);
  p.sinceReplay = 0;
  p.sinceCombo = 0;
  p.pad.fresh &= ~SELECT;
  startReplay(world, data, n - 2);
  reverbOff(world);
  clearSparks(world);
  clearDust(world, data);
  endSoundScript(partnerFighter);
  endSoundScript(h);
}

/** Practice's frame, after the fight's: its menus while paused, else its step; the analysis, the colours and the combo replay always. */
export function practiceFrame(game: GameState, data: PracticeData): void {
  const p = game.practice;
  const world = game.world;
  world.hud.shown = 0;
  p.humanSide = world.match.streakSide;
  p.partnerSide = game.run.newcomer;
  const h = human(game);
  const other = partner(game);
  const side = world.match.streakSide;
  if (world.nothingDrawn === 0) {
    p.pad.raw = world.input.rawPads[side]!;
    p.pad.fresh = world.input.fresh[side]!;
    p.pad.repeats = game.pads.repeats[side]!;
  } else Object.assign(p.pad, { raw: 0, fresh: 0, repeats: 0 });
  p.pad.held = world.input.pads.held[side]!;
  p.pad.pressed = world.input.pads.pressed[side]!;
  if (world.replaying === 0) {
    p.paused = world.pause.requested & 0xff;
    if (world.practice.starting !== 0) {
      Object.assign(p.pad, { raw: 0, fresh: 0, repeats: 0 });
      if (world.pause.requested !== 0) {
        p.startWait -= 1;
        if (p.startWait < 0) {
          p.startWait = 0;
          world.practice.starting = 0;
          resetInputs(world, InputSource.PAD);
          clearEntries(p, 0);
          clearEntries(p, 1);
        }
      }
    }
    if (p.paused !== p.wasPaused) {
      if (p.paused === 0) menuClosed(game, data, h, other);
      else {
        p.commandList = 0;
        p.pad.fresh &= ~0x800;
        p.step = Step.IDLE;
        resetInputs(world, InputSource.PAD);
        clearOnPause(game);
        p.menuWait = MENU_WAIT;
        if (p.keyOffOnPause !== 0) keyOffVoices(world, false);
      }
    }
    p.wasPaused = p.paused;
    if (p.menuWait !== 0) p.menuWait -= 1;
    if (p.paused === 0) unpausedStep(game, data, h, other);
    else if (p.menuWait === 0 && world.nothingDrawn === 0) practiceMenu(game, data);
    practiceHud(game, data);
  }
  hitAnalysis(game, data.match, h, other);
  tint(game);
  comboReplay(game, data.match, other, h);
}
