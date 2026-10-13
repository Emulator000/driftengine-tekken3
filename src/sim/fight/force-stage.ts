/**
 * Tekken Force's stage, run once a frame (`forceStageFrame`) after the fight's own: its script,
 * read as the camera moves on (the camera's mode, enemies placed ahead or behind, waves of them,
 * waits for the enemies to go, +LIFE items, the boss called), the two enemy slots (a soldier
 * changed into the type wanted, entering, fighting, down with its time bonus shown, blinking out),
 * the boss on his way and his fight (the bonus time over his head), the stage's tally, and the
 * final stage against Dr. B. Then the waves, the slots, the progress bar, the items, the score's
 * cap and best, the timer's cap and its last seconds' voices. Who the stage brings is read from
 * its tables; the boss arrives between two held pictures (`bossArrives`).
 */
import { printCall } from './hud.ts';
import { bindMoveIds, chooseFighterBanks, MOKUJIN, placeOnRoster, setUpModel } from './match.ts';
import { setForceCameraMode } from './camera.ts';
import { forceMove } from './move.ts';
import { sizeHitSpheres } from './start.ts';
import { fadeMusic, playSong, voiceLine } from './voices.ts';
import { rotateLong } from '../math/matrix.ts';
import { projectPoint } from '../math/projection.ts';
import { div } from '../math/integers.ts';
import type { FightData, Fighter, FightState, ForceSlot } from './state.ts';

/** What the stage's choices read: Tekken Force's tables. */
type ForceData = Pick<FightData, 'force'>;

/** The soldiers' roster, and Dr. B's (the final stage's enemy). */
export const SOLDIERS = 0x15;
const DOCTOR_B = 0x13;
/** The last roster code the boss table covers. */
const LAST_CODE = 0x5b;
/** The final stage (its index), and the stage whose clear may win a key. */
const FINAL_STAGE = 4;
const KEY_STAGE = 3;

/** The stage machine's states. */
export const StageState = { SCRIPT: 0, WAIT: 1, BOSS_WAIT: 3, LOADING: 4, BOSS_IN: 5, BOSS: 6, TALLY: 7, FINAL_START: 8, FINAL: 9, FINAL_CLEAR: 10 } as const;
/** An enemy slot's states. */
export const SlotState = { CLEAR: 0, FREE: 1, CHANGE: 2, CHANGING: 3, ENTER: 4, FIGHTING: 5, DOWN: 6, FADING: 7 } as const;
/** The script's ops. */
const Op = { CAMERA: 0, ENEMY: 1, WAVE: 2, WAIT: 3, ITEM: 4, BOSS: 6 } as const;
/** An item's states. */
const ItemState = { NONE: 0, LYING: 1, TAKEN: 2 } as const;
/** The boss's kind (its health's and its gauge's), the kinds there are. */
const BOSS_KIND = 4;
const KINDS = 5;
/** The wave list's end, and where a wave's soldiers enter (ahead of the camera). */
const WAVE_END = 99;
const WAVE_ENTERS = 5000;
const WAVES = 0x31;
/** Where the boss enters (ahead of the camera), and the move every enemy enters with. */
const BOSS_ENTERS = 0x1000;
const ENTER_MOVE = 3;
/** The round's flows the stage reads. */
const FIGHTING = 1;
const STAGE_CLEAR = 8;
/** Frames: the boss's wait before loading, the loading's, a fallen enemy's text and wait, its blinking, the final clear's before start skips. */
const BOSS_WAIT = 60;
const LOADING = 2;
const DOWN = 60;
const FADE = 40;
const FINAL_SKIP = 0xb4;
/** The tally's frames: the stage bonus, the clear bonus, the clear time, the bonus time or the key. */
const TALLY = { stage: 30, clear: 60, time: 90, last: 120 } as const;
/** The tally's sounds, the timer's and the +LIFE item's. */
const TICK = 0x4c6c;
const PRIZE = 0x4ceb;
const LIFE = 0x4e6a;
const LIFE_AFTER = 0x87c0;
/** The keys' flags by the keys held before this one, and the most keys. */
const KEY_FLAGS = [1, 3, 7] as const;
const KEYS = 3;
const FINAL_CLEARED = 8;
/** The score's and the timer's caps. */
const SCORE_MOST = 99999990;
const TIMER_MOST = 0x1734;
/** The chest's joint, and how far over it the texts stand. */
const CHEST = 2;
const KILL_TEXT_LIFT = 300;
const BOSS_TEXT_LIFT = 500;
/** An item: where it stands, how near the player takes it, what it heals, how far behind it goes, its text's lift and frames. */
const ITEM = { y: 0x420, reach: 0x1f5, heal: 0x320000, behind: 5000, lift: 300, frames: 60, after: 15 } as const;
/** The progress bar: each stage's segment, its first place, how far the camera goes across one, its phase's step. */
const BAR = { segment: 60, first: 0x40, end: 0x7c, distance: 0x8000, step: 0x40, final: 0x13c } as const;

/** A number as the printer prints it in `width` places: padded with `fill`, a longer one cut to its last places. */
function figures(value: number, width: number, fill: ' ' | '0'): string {
  const text = String(value);
  return text.length > width ? text.slice(-width) : text.padStart(width, fill);
}

/** A soldier's roster code on a stage (0 to 4; the final stage's as the first's) by its type (0 or 1). */
export function soldierCode(data: ForceData, stage: number, type: number): number {
  return SOLDIERS * 4 + data.force.costumes[stage & 3]![type & 1]!;
}

/**
 * The roster code of the boss a player (by roster code) meets on a stage (0 to 3): the table's
 * costume, or by the player's own, the other one where the boss is the player's character.
 */
export function bossCode(data: ForceData, playerCode: number, stage: number): number {
  const [roster, costume] = data.force.bosses[Math.min(playerCode, LAST_CODE)]![stage & 3]!;
  const own = playerCode & 3;
  if (costume !== -1) return roster * 4 + costume;
  return roster * 4 + (roster === playerCode >> 2 ? (own === 0 ? 1 : 0) : own !== 0 ? 1 : 0);
}

/** The roster codes a stage may show besides the player: both soldiers and its boss; Dr. B on the final stage. */
export function stageCodes(data: ForceData, playerCode: number, stage: number): number[] {
  if (stage >= FINAL_STAGE) return [DOCTOR_B * 4];
  return [soldierCode(data, stage, 0), soldierCode(data, stage, 1), bossCode(data, playerCode, stage)];
}

/** Where a point of the fight lands on the screen. */
function projected(state: FightState, x: number, y: number, z: number): { x: number; y: number } {
  const moved = [0, 0, 0];
  rotateLong(state.view.rotation, x, y, z, moved);
  const t = state.view.translation;
  return projectPoint(state.screen, (moved[0]! + t[0]!) | 0, (moved[1]! + t[1]!) | 0, (moved[2]! + t[2]!) | 0);
}

/** A point `lift` over a fighter's chest, on the screen. */
function overChest(state: FightState, f: Fighter, lift: number): { x: number; y: number } {
  const chest = f.skeleton.joints[CHEST]!.world.translation;
  return projected(state, chest[0]!, chest[1]! - lift, chest[2]!);
}

/** A fighter put at a place, its root with it. */
function place(f: Fighter, x: number, z: number): void {
  f.position[0] = x;
  f.position[2] = z;
  f.skeleton.base.translation[0] = x;
  f.skeleton.base.translation[2] = z;
}

/** A fighter out of the fight: no health, not drawn, not in play. */
function leave(f: Fighter): void {
  f.health = 0;
  f.present = 0;
  f.pushImmune = 1;
}

/** An enemy entering the fight: drawn, at full health for its kind, in play, its entering move started on the floor. */
function enter(state: FightState, data: FightData, f: Fighter, kind: number): void {
  f.present = 1;
  f.maxHealth = data.force.health[state.force.stage]![kind]!;
  f.health = f.maxHealth;
  f.pushImmune = 0;
  forceMove(state, data, f, ENTER_MOVE);
  f.position[1] = 0;
  f.inArc = 0;
  f.airborne = 0;
}

/** A slot told to bring a soldier of a type: at once when its fighter is that type, else after changing it. */
function bring(slot: ForceSlot, type: number, kind: number): void {
  if (slot.loadedType === type) slot.state = SlotState.ENTER;
  else {
    slot.state = SlotState.CHANGE;
    slot.wantedType = type;
  }
  slot.kind = kind % KINDS;
}

/** The first free enemy slot (the first's first), or none. */
function freeSlot(state: FightState): number {
  return state.force.slots.findIndex((slot) => slot.state === SlotState.FREE);
}

/** The camera's x, which the script places from and the stage's progress counts from. */
const cameraX = (state: FightState): number => state.camera.drawn.eye[0]!;

/** A +LIFE item laid in the first free place (none free: none). */
function layItem(state: FightState, x: number, z: number): void {
  const item = state.force.items.find((it) => it.state === ItemState.NONE);
  if (item === undefined) return;
  item.x = x;
  item.z = z;
  item.state = ItemState.LYING;
}

/**
 * A stage set up as its match is: the enemies' moveset back in the second slot, both slots clear
 * (each fighter its own soldier type), the name rows, the camera following right, the script from
 * its start, the counters, bar and items cleared; the final stage starts at Dr. B, a minute on the
 * timer.
 */
export function startForceStage(state: FightState, data: FightData): void {
  const force = state.force;
  const sets = data.forceSets;
  if (sets !== undefined) {
    const own = data.mokujin?.own[0] ?? data.sets[0]!;
    const enemies = sets.enemies === own ? null : sets.enemies;
    if (data.sets[1] !== enemies) {
      data.sets = [data.sets[0], enemies, data.sets[2]];
      data.moveIds = bindMoveIds(data.sets);
    }
  }
  force.slots.forEach((slot, i) => {
    Object.assign(slot, { state: SlotState.CLEAR, wait: 0, kind: 0, loadedType: i, wantedType: 0 });
    leave(state.fighters[1 + i]!);
  });
  state.hud.forceNames.splice(0, 3, ...state.fighters.map((f) => f.rosterCode));
  force.frames = 0;
  force.state = StageState.SCRIPT;
  force.cameraMode = 0;
  setForceCameraMode(state, 0);
  force.bossPhase = 0;
  force.stage = state.match.stage;
  force.script = 0;
  force.keyWon = 0;
  force.challenge = 0;
  force.skippable = 0;
  force.downSinceWait = 0;
  force.waitFor = 0;
  force.waves = 0;
  force.waveUntil = 0;
  force.waveAt = 0;
  force.bossTimer = 0;
  force.bossFrames = 0;
  force.bonusFrames = 0;
  force.drawnFrames = 0;
  force.barPhase = 0;
  force.barLatched = 0;
  for (const item of force.items) Object.assign(item, { state: ItemState.NONE, x: 0, y: ITEM.y, z: 0, end: 0 });
  force.scroll = 0;
  force.startX = 0;
  if (FINAL_STAGE <= state.match.stage) {
    force.state = StageState.FINAL_START;
    state.timer = 0xe10;
  }
  force.finalStage = FINAL_STAGE <= state.match.stage ? 1 : 0;
}

/** The script's records due, run in turn until one is not due yet or one stops it. */
function runScript(state: FightState, data: FightData, progress: number): void {
  const force = state.force;
  const script = data.force.stages[force.stage & 3]!.script;
  const at = (i: number): (typeof script)[number] | undefined => script[i];
  if (state.round.flow !== FIGHTING || !(at(force.script)?.[0]! <= progress)) return;
  for (;;) {
    const record = at(force.script);
    if (record === undefined) return;
    const [, op, x, z, arg, kind] = record;
    let stop = false;
    switch (op) {
      case Op.CAMERA:
        force.cameraMode = arg;
        setForceCameraMode(state, arg);
        break;
      case Op.ENEMY: {
        const i = freeSlot(state);
        if (i < 0) break;
        bring(force.slots[i]!, arg, kind);
        place(state.fighters[1 + i]!, cameraX(state) + x, z);
        break;
      }
      case Op.WAVE:
        force.waves += 1;
        force.waveUntil = kind & 0xffff;
        if ((arg & 0xffff) < WAVES) force.waveAt = arg;
        break;
      case Op.WAIT:
        stop = true;
        force.downSinceWait = 0;
        force.state = StageState.WAIT;
        force.waitFor = arg;
        break;
      case Op.ITEM:
        layItem(state, cameraX(state) + x, z);
        break;
      case Op.BOSS:
        force.slots.forEach((slot, i) => {
          leave(state.fighters[1 + i]!);
          slot.state = SlotState.FREE;
        });
        fadeMusic(state, 0, 0x1e);
        stop = true;
        state.match.canPause = 0;
        force.waves = 0;
        force.state = StageState.BOSS_WAIT;
        force.count = force.frames + BOSS_WAIT;
        break;
    }
    force.script += 1;
    if (!(at(force.script)?.[0]! <= progress) || stop) return;
  }
}

/** The boss's fight: the bonus time left over his head; at the stage's clear the clear bonus, and on the fourth stage a key or the final stage's challenge. */
function bossFight(state: FightState, data: FightData): void {
  const force = state.force;
  const [player, boss] = state.fighters;
  force.bossFrames = force.bossTimer - state.timer;
  force.bonusFrames = data.force.par[force.stage]! - force.bossFrames;
  if (force.bossFrames < 0) force.bossFrames = 0;
  if (force.bonusFrames < 0) force.bonusFrames = 0;
  if (0 < force.bonusFrames && 0 < boss.health) {
    const at = overChest(state, boss, BOSS_TEXT_LIFT);
    const t = force.bonusFrames;
    printCall(state, 0, 5, at.x - 0x16, at.y, `${figures(div(t, 60) % 60, 2, ' ')}"${figures(div(t * 100, 60) % 100, 2, '0')}`);
  }
  if (state.round.flow !== STAGE_CLEAR) return;
  force.clearBonus = (player.health >> 16) * 100;
  if (force.stage === KEY_STAGE && force.drEarned === 0) {
    if (force.keysShown < KEYS) {
      force.keyWon = 1;
      force.keyToSave = 1;
      state.match.force.flags |= KEY_FLAGS[force.keysShown]!;
    } else if (force.keysShown === KEYS) force.challenge = 1;
  }
  force.count = 0;
  force.state = StageState.TALLY;
}

/** A time as the tally shows it: minutes, seconds and hundredths. */
const clock = (t: number, hundredths: number): string => `${figures(div(t, 3600) % 60, 2, '0')}'${figures(div(t, 60) - div(t, 3600) * 60, 2, '0')}"${figures(hundredths, 2, '0')}`;

/** The stage's tally, a line at a time: the stage bonus, the clear bonus, the clear time, then the bonus time added or the key or the final stage's challenge. */
function tally(state: FightState, data: FightData): void {
  const force = state.force;
  force.count += 1;
  const count = force.count;
  if (TALLY.stage <= count) {
    const bonus = data.force.stageBonus[force.stage]!;
    if (count === TALLY.stage) {
      force.score += bonus;
      voiceLine(state, data, 0, TICK, 0);
    }
    printCall(state, 1, 4, 0x2f, 0xb4, `STAGE BONUS : ${figures(bonus, 5, ' ')}`);
  }
  if (TALLY.clear <= count) {
    if (count === TALLY.clear) {
      force.score += force.clearBonus;
      voiceLine(state, data, 0, TICK, 0);
    }
    printCall(state, 1, 1, 0x2f, 0xe8, `CLEAR BONUS : ${figures(force.clearBonus, 5, ' ')}`);
  }
  const hundredths = div(force.bossFrames * 100, 60) % 100;
  if (TALLY.time <= count) {
    if (count === TALLY.time) voiceLine(state, data, 0, TICK, 0);
    printCall(state, 1, 5, 0x2f, 0x11c, `CLEAR TIME : ${clock(force.bossFrames, hundredths)}`);
  }
  if (count < TALLY.last) return;
  force.skippable = 1;
  if (force.stage < KEY_STAGE && force.bonusFrames !== 0) {
    let bonus = div(force.bonusFrames * 100, 60) % 100;
    if (hundredths + bonus < 100) bonus = 100 - hundredths;
    printCall(state, 1, 6, 0x2f, 0x150, `BONUS TIME : ${clock(force.bonusFrames, bonus)}`);
    if (count === TALLY.last) {
      state.timer += force.bonusFrames;
      voiceLine(state, data, 0, TICK, 0);
    }
  } else if (force.keyWon === 0) {
    if (force.challenge !== 0) {
      printCall(state, 1, (count & 4) !== 0 ? 6 : 2, 0x22, 0x150, 'FINAL STAGE CHALLENGE!!');
      if (count === TALLY.last) voiceLine(state, data, 0, PRIZE, 0);
    }
  } else {
    printCall(state, 1, (count & 2) !== 0 ? 6 : 2, 0x56, 0x150, 'YOU GOT A KEY!!');
    if (count === TALLY.last) {
      force.keysShown += 1;
      voiceLine(state, data, 0, PRIZE, 0);
    }
  }
}

/** The final stage's first frame: Dr. B in the first slot, entering at his full health, the camera's window, his fight on. */
function finalStart(state: FightState, data: FightData): void {
  const force = state.force;
  const doctor = state.fighters[1];
  const slot = force.slots[0]!;
  slot.kind = BOSS_KIND;
  slot.state = SlotState.FREE;
  forceMove(state, data, doctor, ENTER_MOVE);
  doctor.present = 1;
  doctor.pushImmune = 0;
  doctor.position[1] = 0;
  doctor.inArc = 0;
  doctor.airborne = 0;
  doctor.maxHealth = data.force.health[FINAL_STAGE]![BOSS_KIND]!;
  doctor.health = doctor.maxHealth;
  state.hud.forceNames[1] = DOCTOR_B * 4;
  force.cameraMode = 2;
  setForceCameraMode(state, 2);
  force.bossPhase = 1;
  force.state = StageState.FINAL;
  force.bossTimer = state.timer;
}

/** The waves' queue: while one runs, a soldier from its list into each free slot ahead of the camera, until the stage's progress reaches its end. */
function waveQueue(state: FightState, data: FightData, progress: number): void {
  const force = state.force;
  if (force.waves !== 1) return;
  if (force.waveUntil <= progress) {
    force.waves = 0;
    return;
  }
  const [type, kind] = data.force.waves[force.waveAt]!;
  if (type === WAVE_END) return;
  const i = freeSlot(state);
  if (i < 0) return;
  bring(force.slots[i]!, type, kind);
  place(state.fighters[1 + i]!, cameraX(state) + WAVE_ENTERS, 0);
  force.waveAt += 1;
}

/** An enemy slot's frame. */
function stepSlot(state: FightState, data: FightData, i: number): void {
  const force = state.force;
  const slot = force.slots[i]!;
  const f = state.fighters[1 + i]!;
  const player = state.fighters[0];
  switch (slot.state) {
    case SlotState.CLEAR:
      f.present = 0;
      f.health = 0;
      f.pushImmune = 1;
      slot.state = SlotState.FREE;
      break;
    case SlotState.CHANGE:
      f.present = 0;
      slot.state = SlotState.CHANGING;
      slot.wait = force.drawnFrames + 2;
      break;
    case SlotState.CHANGING: {
      if (!(slot.wait < force.drawnFrames && state.nothingDrawn === 0)) break;
      slot.loadedType = slot.wantedType;
      const code = soldierCode(data, force.stage, slot.loadedType);
      placeOnRoster(data, f, { roster: SOLDIERS, costume: code & 3, computer: true });
      setUpModel(state, data, f);
      state.hud.forceNames[f.slot % 3] = code;
      slot.state = SlotState.ENTER;
      break;
    }
    case SlotState.ENTER:
      slot.state = SlotState.FIGHTING;
      enter(state, data, f, slot.kind);
      break;
    case SlotState.FIGHTING: {
      if (0 < f.health) break;
      slot.state = SlotState.DOWN;
      slot.wait = force.frames + DOWN;
      if (f.struckBySlot !== player.slot && f.hitByEffect === 0) break;
      state.timer = div(state.timer, 60) * 60 + 59 + data.force.kinds[slot.kind]!.seconds * 60;
      const at = overChest(state, f, KILL_TEXT_LIFT);
      slot.textX = at.x - 0x1b;
      slot.textY = at.y << 4;
      slot.textUntil = force.frames + DOWN;
      state.match.force.kills += 1;
      break;
    }
    case SlotState.DOWN: {
      if (force.frames < slot.textUntil) {
        const y = slot.textY >> 4;
        const seconds = String(data.force.kinds[slot.kind]!.seconds);
        printCall(state, 0, 5, slot.textX, y + 4, '+');
        printCall(state, 1, 5, slot.textX + 9, y, seconds);
        printCall(state, 0, 6, slot.textX + 9 + 13 * seconds.length, y + 6, 'SEC');
        if (state.pause.frozen === 0) slot.textY -= 8;
      }
      if (slot.wait < force.frames && f.throwing === 0) {
        slot.state = SlotState.FADING;
        slot.wait = force.frames + FADE;
        f.pushImmune = 1;
      } else if (f.hitReacting !== 0 && f.struckBySlot === player.slot) slot.wait = force.frames + DOWN;
      break;
    }
    case SlotState.FADING:
      f.present = force.frames & 1;
      if (slot.wait < force.frames) {
        force.downSinceWait += 1;
        f.present = 0;
        slot.state = SlotState.FREE;
      }
      break;
  }
}

/** The progress bar's frame: its phase on, its cursor across the stage's segment as the camera goes, at its end once the boss is in. */
function stepBar(state: FightState): void {
  const force = state.force;
  if (state.pause.frozen === 0) force.barPhase = (force.barPhase + BAR.step) & 0xffff;
  const end = force.stage * BAR.segment + BAR.end;
  if (force.barLatched === 0) {
    force.barPos = Math.min(force.stage * BAR.segment + BAR.first + div((cameraX(state) - state.camera.force.origin) * BAR.segment, BAR.distance), end);
    if (force.bossPhase !== 0) force.barLatched = 1;
  } else force.barPos = end;
  if (FINAL_STAGE <= force.stage) force.barPos = BAR.final;
}

/** The +LIFE items' frame: one left behind gone; one the player stands on (alive, on the floor) taken, healing without a cap; a taken one's text rising, its second sound, its end. */
function stepItems(state: FightState, data: FightData): void {
  const force = state.force;
  const player = state.fighters[0];
  const root = player.skeleton.base.translation;
  for (const item of force.items) {
    if (item.state === ItemState.LYING) {
      if (item.x < cameraX(state) - ITEM.behind) {
        item.state = ItemState.NONE;
        continue;
      }
      if (Math.abs(root[0]! - item.x) < ITEM.reach && Math.abs(root[2]! - item.z) < ITEM.reach && 0 < player.health && player.inAir === 0) {
        player.health += ITEM.heal;
        voiceLine(state, data, 0, LIFE, 0);
        const at = overChest(state, player, ITEM.lift);
        item.popupX = at.x - 0x24;
        item.popupY = at.y << 4;
        item.end = force.frames + ITEM.frames;
        item.state = ItemState.TAKEN;
        state.hitFlash[player.movesetSlot] = 1;
      }
    } else if (item.state === ItemState.TAKEN) {
      if (state.pause.frozen === 0) item.popupY -= 8;
      printCall(state, 0, (force.frames & 2) !== 0 ? 2 : 5, item.popupX, item.popupY >> 4, ' +LIFE!');
      if (force.frames === item.end - ITEM.after) voiceLine(state, data, 0, LIFE_AFTER, 0);
      if (item.end < force.frames) item.state = ItemState.NONE;
    }
  }
}

/**
 * The stage's frame, after the fight's (and on a paused frame after its input): the machine's
 * state, then the waves, the slots, the bar and the items, the caps and the timer's voices.
 * Returns 1 on the frame the boss is to be loaded.
 */
export function forceStageFrame(state: FightState, data: FightData): number {
  const force = state.force;
  let result = 0;
  const progress = cameraX(state) - force.startX;
  const frozen = state.pause.frozen !== 0;
  if (!frozen) force.frames += 1;
  if (state.nothingDrawn === 0) force.drawnFrames += 1;
  switch (force.state) {
    case StageState.SCRIPT:
      runScript(state, data, progress);
      break;
    case StageState.WAIT:
      if (force.waitFor < 0) {
        if (force.slots.every((slot) => slot.state === SlotState.FREE)) force.state = StageState.SCRIPT;
      } else if (force.waitFor <= force.downSinceWait) force.state = StageState.SCRIPT;
      break;
    case StageState.BOSS_WAIT:
      if (force.count < force.frames && !frozen) {
        force.state = StageState.LOADING;
        force.count = force.frames + LOADING;
      }
      break;
    case StageState.LOADING:
      printCall(state, 0, 6, 0xf2, 0x1a6, 'NOW LOADING...');
      if (force.count < force.frames && !frozen) {
        result = 1;
        force.state = StageState.BOSS_IN;
      }
      break;
    case StageState.BOSS_IN:
      state.match.canPause = 1;
      force.state = StageState.BOSS;
      force.bossPhase = 1;
      force.bossTimer = state.timer;
      break;
    case StageState.BOSS:
      bossFight(state, data);
      break;
    case StageState.TALLY:
      tally(state, data);
      break;
    case StageState.FINAL_START:
      finalStart(state, data);
      break;
    case StageState.FINAL:
      force.bossFrames = Math.max(0, force.bossTimer - state.timer);
      if (state.round.flow === STAGE_CLEAR) {
        force.count = 0;
        force.state = StageState.FINAL_CLEAR;
        state.match.force.flags |= FINAL_CLEARED;
      }
      break;
    case StageState.FINAL_CLEAR:
      if (FINAL_SKIP < force.count) force.skippable = 1;
      force.count += 1;
      break;
  }
  waveQueue(state, data, progress);
  for (let i = 0; i < force.slots.length; i += 1) stepSlot(state, data, i);
  stepBar(state);
  stepItems(state, data);
  force.score = Math.min(force.score, SCORE_MOST);
  if (force.best < force.score) {
    state.match.force.newRecord = 1;
    force.best = force.score;
  }
  state.timer = Math.min(state.timer, TIMER_MOST);
  if (!frozen && state.round.flow === FIGHTING && state.timer % 60 === 0 && 60 <= state.timer && state.timer <= 300) {
    voiceLine(state, data, 0, data.sound.effects[4 + state.timer / 60]!, 0);
  }
  return result;
}

/**
 * The boss arrives (the picture held): put on the first enemy's record, named, kept with the run,
 * Mokujin's moveset drawn; the voices' banks, the second moveset slot made his and the move ids
 * bound again; his model and the player's set up, his song; then he enters ahead of the camera at
 * his full health, his hit spheres sized, and the player's root put back on its place.
 */
export function bossArrives(state: FightState, data: FightData): void {
  const force = state.force;
  const [player, boss] = state.fighters;
  const code = force.codes[2]!;
  const roster = code >> 2;
  placeOnRoster(data, boss, { roster, costume: code & 3, computer: true });
  state.hud.forceNames[1] = code;
  state.match.force.bosses[force.stage & 3] = code;
  let set = data.forceSets?.boss ?? null;
  const mokujin = data.mokujin;
  if (roster === MOKUJIN && mokujin !== undefined) {
    const rosters: number[] = [];
    for (let r = 0; r < 0x16; r += 1) if ((mokujin.draws & (1 << r)) !== 0) rosters.push(r);
    state.noise = (Math.imul(state.noise, 5) + 1) >>> 0;
    const drawn = rosters.length === 0 ? 0 : rosters[(state.noise & 0xfff) % rosters.length]!;
    boss.character = Math.min(data.roster.codes[drawn * 4]!.moveset, 0x14);
    set = mokujin.movesets.get(boss.character) ?? set;
  }
  chooseFighterBanks(state, data);
  if (set !== null) {
    data.sets = [data.sets[0], set === data.sets[0] ? null : set, data.sets[2]];
    data.moveIds = bindMoveIds(data.sets);
  }
  setUpModel(state, data, boss);
  setUpModel(state, data, player);
  state.stageSong = data.roster.codes[code]!.song;
  playSong(state, state.stageSong, false);
  const slot = force.slots[0]!;
  slot.kind = BOSS_KIND;
  slot.state = SlotState.FREE;
  forceMove(state, data, boss, ENTER_MOVE);
  place(boss, cameraX(state) + BOSS_ENTERS, 0);
  boss.present = 1;
  boss.maxHealth = data.force.health[force.stage]![BOSS_KIND]!;
  boss.health = boss.maxHealth;
  boss.pushImmune = 0;
  boss.position[1] = 0;
  boss.inArc = 0;
  boss.airborne = 0;
  sizeHitSpheres(data, boss);
  place(player, player.position[0]!, player.position[2]!);
}
