/**
 * The computer player: once a frame for each fighter the computer plays, a pad word chosen from
 * what both fighters are doing, read by the input code as a human's would be, already relative to
 * the fighter's facing.
 *
 * A frame first plays on any input script (a list of steps, one a frame), or holds what the
 * record's mode or the frame's skipping says; otherwise it notices what changed (the distance and
 * the bands it falls in, the opponent's attack and when it lands, whether the guard stops it) and
 * decides, in turn: a throw's escape or follow-up, getting up, a downed fighter's choice, the
 * characters' own answers, keeping the guard, the follow-ups listed while a move plays, waiting
 * through a hold, answering the attack coming, turning to face, attacking, and walking. An attack
 * is chosen by gathering the moves the fighter could cancel into now (`candidates`), marking those
 * of a kind, and playing one of them. At the end the counters run down, the record learns from the
 * hits it took, and the pad goes out.
 *
 * Draws use the game's random numbers and the second generator that steps by five times itself
 * plus three (`random.mix`), in the original's order.
 */
import type { Cancel, Move } from '../data/moveset.ts';
import { angle4096 } from '../math/angles.ts';
import { cpuDiv, div, s16, s8 } from '../math/integers.ts';
import { isqrt } from '../math/roots.ts';
import { nextRandom } from '../math/random.ts';
import { cancelTest } from './cancel.ts';
import { hitOf, moveAt, sameMove } from './moves.ts';
import { Mode, type CancelRef, type Candidate, type ComputerRecord, type FightData, type Fighter, type FightState, type MoveRef, type ScriptStep } from './state.ts';

/** The tuning's halfwords by what reads them; the first two are also four bytes, the waits before escaping a hold. */
const Tune = {
  WAIT: 2,
  WAIT_EXTRAS: 3,
  THROW_FOLLOW_UP_LIMIT: 7,
  PRESS: 8,
  ESCAPE: 9,
  THROW_FOLLOW_UP: 10,
  FOLLOW_UP: 11,
  REACH: 12,
  QUICK: 13,
  CROUCH: 14,
  CROUCH_CAP: 15,
  COUNTER: 16,
  COUNTER_CAP: 17,
  SIDESTEP: 18,
  ANSWER: 19,
  ANSWER_CAP: 20,
  CROUCH_BACK: 21,
  CROUCH_BACK_CAP: 22,
  ATTACK_LIMIT: 25,
  ATTACK_LIMIT_TOO: 27,
  CHARACTER: 29,
  RISING_ATTACK: 30,
  PATIENCE: 35,
  TURN: 36,
  BACK_OFF: 38,
  SCRIPTED: 45,
  SPECIAL_CROUCH: 47,
  RISE: 49,
} as const;

/** Cancel commands the computer reads: a list's end, a jump into a shared list, the dashes in and back. */
const END = 0xc000;
const CALL = 0xc00c;
const DASH_IN = 0xc001;
const DASH_BACK = 0xc002;
/** The attack kinds (a move's `hitLevel` low half) the guards are judged by, and the guard moves (their flags' low half). */
const HIGH = 0x412;
const MID = 0x217;
const LOW = 0x10f;
const SPECIAL_MID = 0x31f;
const SPECIAL_LOW = 0x51f;
const THROW_KIND = 0x607;
const THROW_KIND_TOO = 0x706;
const GETTING_UP = 0x4c02;
const STANDING_GUARD = 0x1052;
const CROUCHING_GUARD = 0x2829;
const GUARD_BACK = 0x2021;
/** Pads: the directions (up, forward, down, back, as the input reads them) and buttons. */
const UP = 0x1000;
const FORWARD = 0x2000;
const DOWN = 0x4000;
const BACK = 0x8000;
const DOWN_BACK = 0xc000;
const DOWN_FORWARD = 0x6000;
const HELD_DIRECTION = 0xf000;
/** The distance past which the opponent counts as out of reach. */
const OUT_OF_REACH = 0xb87;
/** At most this many candidates. */
const CANDIDATES = 0xb4;

/**
 * Tekken Ball's court as the computer sees it: where each fighter stands along the line from the
 * first to the second (the first always the lesser), where the ball is along it and how far off it.
 */
interface Court {
  readonly along: readonly [number, number];
  readonly ball: number;
  readonly across: number;
}

/** One frame's decisions for a fighter (and in Tekken Ball the court). */
interface Turn {
  readonly state: FightState;
  readonly data: FightData;
  readonly self: Fighter;
  readonly opponent: Fighter;
  readonly rec: ComputerRecord;
  readonly court: Court | null;
}

/** What a frame's decisions read of both fighters' moves: the moves and each one's active window and frame. */
interface Moment extends Turn {
  readonly myMove: Move;
  readonly myStart: number;
  readonly myEnd: number;
  readonly myFrame: number;
  readonly theirMove: Move;
  readonly theirStart: number;
  readonly theirEnd: number;
  readonly theirFrame: number;
}

/* ---- Random numbers. ---- */

const stepMix = (t: Turn): void => {
  t.state.random.mix = (Math.imul(t.state.random.mix, 5) + 3) >>> 0;
};
/** The second generator's bits under `mask`, then stepped. */
function mixBits(t: Turn, mask: number): number {
  const value = t.state.random.mix & mask;
  stepMix(t);
  return value;
}
const mix12 = (t: Turn): number => mixBits(t, 0xfff);
const rand = (t: Turn): number => nextRandom(t.state.random);
/** A draw from both generators, 15 bits, the second then stepped. */
function mixedRand(t: Turn): number {
  const value = (rand(t) + t.state.random.mix) & 0x7fff;
  stepMix(t);
  return value;
}
const randBelow = (t: Turn, n: number): number => Math.imul(mixedRand(t), n) >> 15;

/* ---- What the computer reads of moves and cancel lists. ---- */

function moveOf(t: Turn, ref: MoveRef | null): Move {
  if (ref === null) throw new Error('the computer reads a move that is not there');
  return moveAt(t.data, ref);
}
/** A move's damage as the halfword holding it with its two flag bits. */
const damageWord = (move: Move): number => s16(move.damage | (move.damageFlags << 14));
const kindOf = (move: Move): number => move.hitLevel >>> 0;
/** A move by id, as the fighter's moveset slot binds it. */
function moveById(t: Turn, id: number): MoveRef | null {
  const ref = t.data.moveIds[t.self.computerRecord]![id & 0xffff];
  if (ref === undefined) throw new Error(`move id ${id} is outside the id table`);
  return ref;
}

const entryAt = (t: Turn, ref: CancelRef): Cancel => (ref.shared ? t.data.cancels.shared[ref.index]! : t.data.sets[ref.set]!.moveset.cancels[ref.index]!);
const listOf = (ref: MoveRef, move: Move): CancelRef => ({ shared: false, set: ref.set, index: move.cancels });
const nextOf = (ref: CancelRef): CancelRef => ({ shared: ref.shared, set: ref.set, index: ref.index + 1 });

/** An entry as its items: itself, or the entries of the shared list it names. */
function expand(t: Turn, ref: CancelRef): CancelRef[] {
  const entry = entryAt(t, ref);
  if (entry.command !== CALL) return [ref];
  return Array.from({ length: entry.start }, (_, i) => ({ shared: true, set: -1, index: entry.target + i }));
}

/** A cancel list's entries in order, each shared list expanded where it is named. */
function* cancelEntries(t: Turn, list: CancelRef): Generator<CancelRef> {
  for (let at = list; entryAt(t, at).command !== END; at = nextOf(at)) yield* expand(t, at);
}
const movesList = (t: Turn, ref: MoveRef | null): CancelRef => listOf(ref!, moveOf(t, ref));

/**
 * An entry's condition as the computer reads it: the fighter's moveset (1 to 0x17, or not 0x18 to
 * 0x2e), the opponent's (0x2f to 0x45), the fighter's roster id (0x46 to 0x5c, or not 0x5d to
 * 0x73); past 0x73 never, where the game's own reading has no end.
 */
function conditionHolds(t: Turn, entry: Cancel): boolean {
  const c = entry.condition;
  if (c === 0) return true;
  if (c < 0x18) return t.self.character === c - 1;
  if (c < 0x2f) return t.self.character !== c - 0x18;
  if (c < 0x46) return t.opponent.character === c - 0x2f;
  if (c < 0x5d) return t.self.roster === c - 0x46;
  if (c <= 0x73) return t.self.roster !== c - 0x5d;
  return false;
}

/* ---- Input scripts. ---- */

/** A script step as a pad word: its direction's bits and its buttons. */
function stepPad(t: Turn, step: number): number {
  let pad = (step & 0x100) !== 0 ? 0x80 : 0;
  if ((step & 0x200) !== 0) pad |= 0x10;
  if ((step & 0x400) !== 0) pad |= 0x40;
  if ((step & 0x800) !== 0) pad |= 0x20;
  return pad | t.data.computer.stepPads[step & 0xf]!;
}

const poolOf = (t: Turn, pool: ScriptStep['pool']): Int16Array => (pool === 'scripts' ? t.data.computer.steps : t.data.computer.sequenceSteps);
function stepAt(t: Turn, pool: ScriptStep['pool'], at: number): number {
  const step = poolOf(t, pool)[at];
  if (step === undefined) throw new Error(`the computer's ${pool} have no step ${at}`);
  return step;
}

/** A script started at a step: that step held now, the rest played on unless the next is the end. */
function startScript(t: Turn, at: number, pool: ScriptStep['pool'] = 'scripts'): void {
  t.rec.script = stepAt(t, pool, at + 1) === 0 ? null : { pool, at: at + 1 };
  t.rec.pad = stepPad(t, stepAt(t, pool, at) & 0xffff);
}

/** The plans dropped: nothing pending, a calm of 40 frames. */
function calm(rec: ComputerRecord): void {
  rec.calm = 0x28;
  rec.walkKind = 0;
  rec.walkLeft = 0;
  rec.holdFrames = -1;
}

/**
 * A sidestep script (0 or 1, or -1 to choose: by how the fighter is turned, at random when square,
 * the other way when on the far side), then the plans dropped.
 */
function sidestep(t: Turn, which: number): void {
  if (which === -1) {
    const turned = t.self.theirOff & 0xffff;
    which = 0;
    if (0x7efe < (turned - 0x101) >>> 0) {
      which = 1;
      if (0x7efd < ((turned + 0x7fff) & 0xffff)) which = (rand(t) >> 4) & 1;
    }
    if (t.opponent.screenX < t.self.screenX) which = 1 - which;
  }
  startScript(t, t.data.computer.sidesteps[which]!);
  calm(t.rec);
}

/** The input sequence a cancel command names, as where it starts among the sequences' steps, or -1. */
function sequenceOf(t: Turn, command: number): number {
  const sequences = t.data.computer.sequences;
  command &= 0xffff;
  if (command < 0xc00e) {
    if (command === DASH_IN) return sequences.dashForward;
    if (command === DASH_BACK) return sequences.dashBack;
  } else if (command < 0xc7ff) {
    if (command - 0xc00e < 0x3f) return sequences.a[command - 0xc00e]!;
  } else if (command - 0xc7ff < 0x29) return sequences.b[command - 0xc7ff]!;
  return -1;
}

/**
 * A cancel command played. A plain one becomes this frame's pad (the first of nine direction masks
 * its bits meet, from the ninth down, and its buttons); the pad is returned. A sequence starts as a
 * script and -1 is returned; a command naming none returns 0 and plays nothing. `move` is noted as
 * the move played.
 */
function perform(t: Turn, command: number, move: MoveRef | null): number {
  const tables = t.data.computer;
  let result: number;
  if ((command & 0xc000) === 0) {
    let direction = 9;
    for (; 0 < direction; direction -= 1) if ((tables.commandMasks[direction]! & (command >> 5) & 0x1ff) !== 0) break;
    let buttons = 0;
    let bits = command;
    for (let i = 0; i < 4; i += 1) {
      if ((bits & 1) !== 0) buttons |= tables.buttonPads[i]!;
      bits = (bits & 0xffff) >> 1;
    }
    t.rec.pad = tables.commandPads[direction]! | buttons;
    result = t.rec.pad;
  } else {
    const sequence = sequenceOf(t, command);
    if (sequence < 0 || (command & 0xc000) !== 0xc000) return 0;
    startScript(t, sequence + 1, 'sequences');
    result = -1;
  }
  t.rec.performed = move;
  return result;
}

/* ---- A frame. ---- */

/** The record of the fighter the computer plays. */
const recordOf = (state: FightState, f: Fighter): ComputerRecord => state.computer.records[f.computerRecord]!;

/**
 * A computer fighter's pad for this frame, held and newly pressed. A script playing steps on;
 * otherwise the moves are weighed and one chosen; then the counters run down and the pad goes out.
 */
export function computerInput(state: FightState, self: Fighter, data: FightData): [number, number] {
  const rec = recordOf(state, self);
  const opponent = state.fighters[rec.opponent]!;
  const t: Turn = { state, data, self, opponent, rec, court: state.mode === TEKKEN_BALL ? measureCourt(state, data) : null };
  state.computer.lastSelf = self.slot;
  state.computer.lastOpponent = opponent.slot;
  rec.performed = null;
  const lastFrame = rec.lastFrame;
  rec.lastFrame = s16(self.frame);
  if (self.frame !== lastFrame) rec.steps = s16(rec.steps + 1);
  const myMove = moveOf(t, self.move);
  const theirMove = moveOf(t, opponent.move);
  rec.ownFlags = myMove.flags >>> 0;
  rec.ownKind = kindOf(myMove);
  rec.ownKindLow = kindOf(myMove) & 0xffff;
  rec.theirFlags = theirMove.flags >>> 0;
  rec.theirKind = kindOf(theirMove);
  rec.theirKindLow = kindOf(theirMove) & 0xffff;
  rec.distance = self.targetDistance | 0;
  /* Where the opponent stands and what it is doing, as bits. */
  let around = (self.facingOffSize << 16) | 0;
  around = 0x40000000 < around ? 1 : 0;
  rec.turned = s16(self.facingOffSize);
  if (((self.facingOff & 0xffff) - 0x4e38) >>> 0 < 0x31c8) around |= 2;
  if (((self.facingOff + 0x8000) & 0xffff) < 0x31c7) around |= 4;
  if (s16(opponent.level) === HIGH && opponent.frame <= theirMove.activeWindow.last && state.distance < 0x700) around |= 8;
  if (self.facingQuadrant === 0) around |= 0x10;
  rec.groundFire = 0;
  rec.fireComing = 0;
  rec.around = around;
  if (opponent.character === 0xe && hitCode(t, opponent.move) === 0x18) rec.fireComing = 1;
  else if (opponent.character === 0x13 && hitCode(t, opponent.move) === 0x1a) {
    rec.groundFire = 1;
    rec.theirKind = (rec.theirKind | 0x10000) >>> 0;
  }
  if (!holding(t)) {
    decide({
      ...t,
      myMove,
      myStart: myMove.activeWindow.first,
      myEnd: myMove.activeWindow.last,
      myFrame: self.frame,
      theirMove,
      theirStart: theirMove.activeWindow.first,
      theirEnd: theirMove.activeWindow.last,
      theirFrame: opponent.frame,
    });
  }
  return settle(t);
}

const TEKKEN_BALL = 7;

/* ---- Tekken Ball's court. ---- */

/** A product's sum rounded toward zero out of 12 fraction bits. */
const r12 = (v: number): number => ((v | 0) < 0 ? (v | 0) + 0xfff : v | 0) >> 12;

/** The court measured along the line from the first fighter to the second, crossing x = 0. */
function measureCourt(state: FightState, data: FightData): Court {
  const [x0, , z0] = state.fighters[0]!.skeleton.base.translation as [number, number, number];
  const [x1, , z1] = state.fighters[1]!.skeleton.base.translation as [number, number, number];
  const [bx, , bz] = state.ball.position as [number, number, number];
  const dx = (x1 - x0) | 0;
  const dz = (z1 - z0) | 0;
  const a = -angle4096(dx, dz, data.math) & 0xfff;
  const sin = data.math.sine[a]!;
  const cos = data.math.sine[a + 0x400]!;
  const k = (z0 - cpuDiv(Math.imul(dz, x0), dx)) | 0;
  const along = (x: number, z: number): number => r12(Math.imul(x, cos) - Math.imul((z - k) | 0, sin));
  return { along: [along(x0, z0), along(x1, z1)], ball: along(bx, bz), across: r12(Math.imul(bx, sin) + Math.imul((bz - k) | 0, cos)) };
}

/** How far the ball is from a fighter. */
function ballDistance(court: Court, f: Fighter): number {
  const d = (court.along[f.movesetSlot]! - court.ball) | 0;
  return isqrt((Math.imul(d, d) + Math.imul(court.across, court.across)) | 0);
}

/** The ball behind the fighter: it backs away. */
function backFromBall(m: Moment): boolean {
  const court = m.court!;
  const behind = m.rec.index === 0 ? court.ball < court.along[0] : court.along[1] < court.ball;
  if (behind) startScript(m, m.data.computer.backAway);
  return behind;
}

/** The ball ahead of the fighter: for the first, well ahead; for the second, ahead but near. */
function ballAhead(m: Moment): boolean {
  const court = m.court!;
  if (m.rec.index === 0) return court.along[0] + BALL_AHEAD < court.ball;
  return court.along[1] - BALL_AHEAD < court.ball && court.ball < court.along[1];
}

/** How far ahead the ball must be (or within, for the second fighter). */
const BALL_AHEAD = 0x7d0;

/**
 * The first byte of a move's hit data, signed (its first code). A move with none has -1 for its
 * pointer, and the byte read there is the scratchpad's last, which nothing writes: 0.
 */
function hitCode(t: Turn, ref: MoveRef | null): number {
  const hit = hitOf(t.data, ref!);
  return hit === null ? 0 : s8(hit.codes[0]!);
}

/**
 * What a frame holds before any decision: a script's next step; nothing in mode 0; up in mode 1
 * while the move asks for it; or, on frames skipped (every other one in the attract mode), the
 * direction held on. True when the pad is settled.
 */
function holding(t: Turn): boolean {
  const rec = t.rec;
  const script = rec.script;
  if (script !== null) {
    rec.script = stepAt(t, script.pool, script.at + 1) === 0 ? null : { pool: script.pool, at: script.at + 1 };
    rec.pad = stepPad(t, stepAt(t, script.pool, script.at));
    return true;
  }
  if (rec.mode === 0) {
    rec.pad = 0;
    return true;
  }
  if (rec.mode === 1) {
    rec.pad = (rec.ownFlags & 4) << 10;
    return true;
  }
  if (t.state.computer.halfRate !== 0 && (t.state.frameCount & rec.index & 1) !== 0) {
    rec.pad = rec.lastPad & HELD_DIRECTION;
    return true;
  }
  /* Tekken Force: an enemy the other's attack holds still keeps its direction. */
  if (t.state.mode === Mode.TEKKEN_FORCE && 0 < t.state.computer.forceHold[rec.index]!) {
    rec.pad = rec.lastPad & HELD_DIRECTION;
    return true;
  }
  return false;
}

/** The decisions for a frame not already settled. Each step reads and writes the record; the pad lands in it. */
function decide(m: Moment): void {
  notice(m);
  judgeGuard(m);
  pace(m);
  if (inThrow(m) || rising(m) || m.self.next.move !== null) return;
  if (downed(m) || answers(m, 'against') || answers(m, 'own')) return;
  if (keepGuard(m)) return;
  m.rec.takenCount = 0;
  m.rec.candidateCount = 0;
  if (followUps(m) || ranLong(m)) return;
  if (m.court !== null && backFromBall(m)) return;
  if (holdThrough(m) || answerComing(m) || respond(m)) return;
  dropFollowUps(m);
  if (turnToFace(m)) return;
  if (!hangsBack(m) && attack(m)) return;
  walk(m);
}

/**
 * Tekken Force: an enemy walks instead of attacking while the other's attack makes it wait, or,
 * by its pacing's odds, while the player is not facing it.
 */
function hangsBack(m: Moment): boolean {
  const { state, self, rec } = m;
  if (state.mode !== Mode.TEKKEN_FORCE) return false;
  if (0 < state.computer.forceWait[rec.index]!) return true;
  if (state.fighters[0].opponent === self.slot) return false;
  return mix12(m) < rec.pacing![2];
}

/** Whether neither fighter is being pushed. */
const still = (f: Fighter): boolean => f.push[0] === 0 && f.push[1] === 0 && f.push[2] === 0;

/**
 * What changed since last frame: the moves' starts and frames counted, the opponent's attack timed
 * (frames until it lands, whether one is coming, a special one), how far the opponent is and which
 * of the bands that falls in, by the fighter's reach and by the opponent's.
 */
function notice(m: Moment): void {
  const { self, opponent, rec, myMove, myStart, myFrame, theirMove, theirStart, theirEnd, theirFrame } = m;
  rec.dropLows = 0;
  if (((myMove.hitFlags >> 8) & 0x20) === 0) rec.specialsDropped = 0;
  const urgedNext = rec.urgeNext;
  const pressedNext = rec.pressNext;
  rec.urgeNext = 0;
  rec.pressNext = 0;
  rec.urge = urgedNext;
  rec.press = pressedNext;
  if (opponent.health <= div(opponent.maxHealth, 10)) {
    for (const at of [Tune.REACH, Tune.QUICK, Tune.COUNTER, Tune.COUNTER_CAP]) rec.tuning[at] = 0;
  }
  const roll = mix12(m);
  if (rec.tuning[Tune.PATIENCE]! <= roll && 0x1fff < rec.turned && s16(self.theirOffSize) < 0x6001 && rec.farBand < 3) rec.urge = 1;
  rec.moveChanged = !sameMove(self.move, rec.move) || myFrame < rec.lastMoveFrame ? 1 : 0;
  rec.moveFrames = s16(rec.moveFrames + 1);
  if (!sameMove(rec.move, self.move)) {
    rec.move = self.move;
    rec.moveFrames = 0;
  }
  rec.lastMoveFrame = s16(myFrame);
  if ((rec.ownFlags & 0x400000) !== 0) calm(rec);
  if (myStart === 0) {
    if ((rec.ownKind & 0x80000) === 0 && s8(opponent.beingHit) === 0) rec.attacks = 0;
  } else if (myStart === myFrame) rec.attacks = s16(rec.attacks + 1);
  if (theirStart === 0) {
    /* The original reads the fighter's own being hit here, unlike the line above. */
    if ((rec.theirKind & 0x80000) === 0 && s8(self.beingHit) === 0) rec.theirAttacks = -1;
  } else if (theirStart === theirFrame) {
    rec.theirAttacks = s16(rec.theirAttacks + 1);
    if (10 < rec.theirAttacks) rec.theirAttacks = 10;
  }
  let distance = rec.distance;
  /* In Tekken Ball the ball nearer than the opponent is what is near. */
  if (m.court !== null) {
    const ball = ballDistance(m.court, self);
    if (ball < distance) distance = ball;
  }
  const before = rec.lastDistance;
  rec.lastDistance = distance;
  const reach = distance - rec.theirCharacter[5]! - 0x80;
  rec.closing = (distance - before) | 0;
  if (reach < rec.ownCharacter[0]!) {
    let skip = false;
    if (still(self) && still(opponent)) rec.nearBand = 1;
    else {
      rec.nearBand = 0;
      if (rec.attacking !== 0) skip = true;
      else rec.wait = s16(rec.wait - 1);
    }
    if (!skip && rec.attacking === 0) rec.wait = s16(rec.wait - 1);
    rec.farFrames = 0;
  } else if (reach < rec.ownCharacter[1]!) {
    rec.nearBand = 2;
    rec.farFrames = 0;
  } else if (reach < rec.ownCharacter[2]!) {
    rec.nearBand = 3;
    rec.farFrames = 0;
  } else {
    let added: number;
    let base: number;
    if (reach < rec.ownCharacter[3]!) {
      rec.nearBand = 4;
      added = ((rand(m) + m.state.random.mix) & 0x7fff) * 2;
      base = rec.farFrames + 4;
    } else {
      rec.nearBand = 5;
      added = ((rand(m) + m.state.random.mix) & 0x7fff) * 3;
      base = rec.farFrames + 5;
    }
    stepMix(m);
    rec.farFrames = s16(base + (added >> 15));
  }
  if (rec.attacking === 0 || opponent.inAir !== 0) rec.wait = s16(rec.wait - 1);
  distance = rec.distance - rec.ownCharacter[5]!;
  if (rec.closing < 0) distance += rec.closing;
  let band = 1;
  if (rec.theirCharacter[0]! + 0x80 <= distance) {
    band = 2;
    if (rec.theirCharacter[1]! + 0x100 <= distance) {
      band = 3;
      if (rec.theirCharacter[2]! + 0x200 <= distance) {
        band = 4;
        if (rec.theirCharacter[3]! + 0x280 <= distance) band = 5;
      }
    }
  }
  rec.farBand = band;
  /* A held attack's frames, until the move reaches its own count. */
  let held = true;
  if (theirStart === 0 && (rec.theirFlags & 0x80000) !== 0) {
    rec.heldFrames = s16(rec.heldFrames + 1);
    held = (theirMove.next & 0xffff) === s16(opponent.moveId);
  }
  if (held) rec.heldFrames = 0;
  const coming = 0 < rec.heldFrames || (theirStart !== 0 && theirFrame <= theirEnd + 1) ? 1 : 0;
  rec.coming = coming;
  if (coming === 0 || theirStart - 3 <= theirFrame) rec.comingFrames = 0;
  else rec.comingFrames = (rec.comingFrames + 1) | 0;
  if (myStart === 0 || theirFrame <= theirEnd + 1) rec.ownAttackFrames = 0;
  else rec.ownAttackFrames = (rec.ownAttackFrames + 1) | 0;
  if (rec.coming === 0) rec.attackCountdown = -1;
  else if (0 < rec.attackCountdown) rec.attackCountdown = s16(rec.attackCountdown - 1);
  if (rec.coming === 0 && (rec.theirFlags & 0x200000) !== 0) rec.coming = 1;
  if ((rec.theirFlags & 0x80000) === 0) rec.theirTravel = 0;
  else rec.theirTravel = s16(rec.theirTravel + 1);
  const special = (rec.theirKind & 0x400000) !== 0 && (theirStart === 0 || theirFrame <= theirEnd) ? 1 : 0;
  rec.special = special;
  if (rec.coming === 0 && special === 0) {
    rec.due = 999;
    rec.crouch = 0;
  } else if (theirStart === 0) {
    rec.due = s16(entryAt(m, movesList(m, opponent.move)).to - theirFrame + 1);
  } else {
    let late = 0x3e5;
    if (theirFrame <= theirEnd) {
      rec.due = s16(theirStart - theirFrame);
      if (rec.due < 0x65) return;
      late = 0x3e6;
    }
    rec.special = 0;
    rec.coming = 0;
    rec.due = late;
  }
}

/**
 * Whether the opponent's coming attack is one the fighter's guard already stops: by the attack's
 * kind against the guard move playing, and a special attack by the guard alone. Also the opponent's
 * height and a few kinds it notes.
 */
function judgeGuard(m: Moment): void {
  const { self, opponent, rec } = m;
  rec.theyAreHigh = opponent.skeleton.joints[2]!.world.translation[1]! < -0xc1b ? 1 : 0;
  if (0x3000 < s16(self.theirOffSize) || ((rec.theirFlags & 0x200000) === 0 && rec.theirKindLow !== THROW_KIND && rec.theirKindLow !== THROW_KIND_TOO)) rec.retreat = 0;
  if (-1 < rec.reversalWindow && rec.farBand < 2 && rec.tuning[Tune.PATIENCE]! <= mix12(m)) rec.crouch = 1;
  let low = 0;
  if ((rec.theirFlags & 0x204) !== 0 && (rec.theirFlags & 0xffff) !== GETTING_UP) low = opponent.inAir === 0 ? 1 : 0;
  rec.lowComing = low;
  const rolling = opponent.character === 4 && s16(opponent.moveId) === 0x456 ? 1 : 0;
  rec.rolling = rolling;
  if (rolling !== 0) rec.theirAttacks = -1;
  const guard = rec.ownFlags & 0xffff;
  const stops = (...guards: number[]): number => (guards.includes(guard) ? 1 : 0);
  let result = 0;
  if (rec.distance < OUT_OF_REACH && rec.rolling === 0) {
    if (rec.special !== 0) result = rec.theirKindLow === MID ? 0 : stops(GUARD_BACK, CROUCHING_GUARD);
    else if (rec.coming !== 0 && rec.turned <= 0x3000) {
      switch (rec.theirKindLow) {
        case HIGH:
          result = stops(GUARD_BACK, CROUCHING_GUARD, STANDING_GUARD);
          break;
        case MID:
          result = stops(STANDING_GUARD);
          break;
        case LOW:
          result = stops(CROUCHING_GUARD);
          break;
        case SPECIAL_MID:
          result = stops(CROUCHING_GUARD, STANDING_GUARD);
          break;
        case THROW_KIND_TOO:
          result = stops(CROUCHING_GUARD, GUARD_BACK);
          break;
      }
    }
  }
  rec.guardStops = result;
}

/**
 * The fighter's own rhythm: how long it keeps a guard up (counted down, a new random length of 20
 * to 42 frames when the guard starts), whether its move is active, and whether a hold move is still
 * in its window.
 */
function pace(m: Moment): void {
  const { rec, myMove, myStart, myEnd, myFrame } = m;
  if ((rec.ownFlags & 1) === 0) rec.guardLeft = -1;
  else if (0 < rec.guarding) rec.guardLeft = s16(rec.guardLeft - 1);
  else if (((myMove.hitFlags >> 8) & 0x10) === 0) {
    const a = m.state.random.mix;
    const b = (Math.imul(a, 5) + 3) >>> 0;
    const c = (Math.imul(b, 5) + 3) >>> 0;
    m.state.random.mix = (Math.imul(c, 5) + 3) >>> 0;
    rec.guardLeft = (a & 7) + (b & 0xf) + 0x14 + (c & 7);
  }
  rec.attacking = myStart === 0 ? 0 : 1;
  let hold = 0;
  if ((myMove.flags & 0x200000) !== 0 && (kindOf(myMove) & 0x200000) !== 0) hold = myEnd < myFrame ? 0 : 1;
  rec.holdWindow = hold;
}

/* ---- Throws. ---- */

/** Moves a thrown fighter always tries to escape (by id, some only for the thrower's moveset). */
function escapeIsSure(opponent: Fighter): boolean {
  const id = s16(opponent.moveId);
  const moveset = opponent.character;
  return [0x189, 0x18e, 0x17f, 0x181].includes(id) || ((moveset === 9 || moveset === 0) && id === 0x172) || (moveset === 3 && id === 0x152);
}

/**
 * In a throw. Thrown, once per throw move and by the tuning's chance (or always for the throws in
 * `escapeIsSure`), one of the move's cancels is played: the escapes' own commands for the entries
 * tested `:`, `;` and `<` (1, 2, 1), else the entry's command. Throwing, a follow-up is chosen once
 * per move by the tuning's chance among up to six cancels the fighter may take (a few only
 * sometimes, by character), and played on the frame its window opens. True when settled.
 */
function inThrow(m: Moment): boolean {
  const { self, opponent, rec } = m;
  if (self.throwHold === 0) {
    rec.throwMove = null;
    rec.throwFollowUps = 0;
    rec.throwFollowUpFrame = -1;
    rec.throwFollowUp = null;
    return false;
  }
  calm(rec);
  const move = self.move;
  if (self.throwHold < 1) {
    if (sameMove(move, rec.throwMove)) {
      rec.pad = 0;
      return true;
    }
    rec.throwFollowUps = s16(rec.throwFollowUps - 1);
    rec.throwMove = move;
    if (escapeIsSure(opponent) || mix12(m) < rec.tuning[Tune.ESCAPE]!) {
      const entries: CancelRef[] = [];
      for (const entry of cancelEntries(m, movesList(m, self.move))) {
        entries.push(entry);
        if (0x2f < entries.length) break;
      }
      let command = 0;
      if (0 < entries.length) {
        const pick = entryAt(m, entries[Math.imul(entries.length, mixedRand(m)) >> 15]!);
        const test = s8(pick.test);
        command = test === 0x3a ? 1 : test === 0x3b ? 2 : test === 0x3c ? 1 : s16(pick.command);
      }
      if (command !== 0) perform(m, command, null);
      else rec.pad = 0;
    }
    return true;
  }
  if (!sameMove(move, rec.throwMove) && -1 < rec.throwFollowUps && rec.throwFollowUps < rec.tuning[Tune.THROW_FOLLOW_UP_LIMIT]! - 1 && mix12(m) < rec.tuning[Tune.THROW_FOLLOW_UP]!) {
    const chosen: CancelRef[] = [];
    const moveset = self.character;
    for (const ref of cancelEntries(m, movesList(m, move))) {
      const entry = entryAt(m, ref);
      if (!conditionHolds(m, entry)) continue;
      const stepped = (Math.imul(m.state.random.mix, 5) + 3) >>> 0;
      const roll = m.state.random.mix & 0x70;
      const target = s16(entry.target);
      let ok = true;
      if (target === 0x3a7) continue;
      if (target === 0xd41) ok = moveset === 4 ? roll !== 0 : true;
      else if (target === 0xd24 || target === 0xd32) ok = moveset === 0 || moveset === 0xd ? roll === 0 : true;
      else if (target === 0xde2) {
        if (moveset === 0 && roll !== 0) continue;
      } else if ((target === 0xd25 || target === 0xd34) && (moveset === 0 || moveset === 0xd)) continue;
      m.state.random.mix = stepped;
      if (ok && (entry.test === 0 || cancelTest(m.state, m.data, entry, self, opponent))) {
        chosen.push(ref);
        if (5 < chosen.length) break;
      }
    }
    if (chosen.length < 1) {
      rec.throwFollowUps = -1;
      rec.throwFollowUpFrame = -1;
      rec.throwFollowUp = null;
    } else {
      rec.throwFollowUps = s16(rec.throwFollowUps + 1);
      rec.throwMove = self.move;
      const pick = chosen[Math.imul(chosen.length, mixedRand(m)) >> 15]!;
      rec.throwFollowUpFrame = entryAt(m, pick).from + 1;
      rec.throwFollowUp = pick;
    }
  }
  if (self.frame !== rec.throwFollowUpFrame) {
    rec.pad = 0;
    return true;
  }
  const entry = entryAt(m, rec.throwFollowUp!);
  perform(m, s16(entry.command), moveById(m, entry.target));
  return true;
}

/* ---- Getting up. ---- */

/** The candidates, the moves the fighter could cancel into now. */
const candidateAt = (t: Turn, i: number): Candidate => t.state.computer.candidates[i]!;

/**
 * A fighter getting up (its move's flags `GETTING_UP`, before the move's window): the moves it
 * could rise into gathered and, by the tuning's chance, those whose cancel is of the two rising
 * transitions (0x1c, 0x1d) taken and one chosen; otherwise nothing held. True when settled.
 */
function rising(m: Moment): boolean {
  const { self, rec } = m;
  if ((rec.ownFlags & 0xffff) !== GETTING_UP || s8(moveOf(m, self.move).activeWindow.first) !== 0) return false;
  calm(rec);
  rec.takenCount = 0;
  rec.move = self.move;
  const count = gather(m, 1);
  rec.candidateCount = count;
  if (0 < count && mix12(m) < rec.tuning[Tune.RISE]!) {
    let marked = 0;
    for (let i = 0; i < rec.candidateCount; i += 1) {
      const candidate = candidateAt(m, i);
      if (candidate.taken === 0 && (entryAt(m, candidate.entry!).type - 0x1c) >>> 0 < 2) {
        candidate.taken = 1;
        marked += 1;
      }
    }
    rec.takenCount = s16(rec.takenCount + marked);
    if (0 < marked) {
      chooseCandidate(m);
      return true;
    }
  }
  rec.pad = 0;
  return true;
}

/* ---- On the ground. ---- */

/**
 * Each free candidate that passes `test` (given its move and its cancel entry) taken, the count
 * added to the taken when there were any candidates; returns how many were taken.
 */
function markCandidates(t: Turn, test: (move: Move, entry: Cancel, ref: MoveRef) => boolean): number {
  const rec = t.rec;
  let marked = 0;
  for (let i = 0; i < rec.candidateCount; i += 1) {
    const candidate = candidateAt(t, i);
    if (candidate.taken !== 0 || !test(moveOf(t, candidate.move), entryAt(t, candidate.entry!), candidate.move!)) continue;
    candidate.taken = 1;
    marked += 1;
  }
  if (0 < rec.candidateCount) rec.takenCount = s16(rec.takenCount + marked);
  return marked;
}

/**
 * On the ground (not hit this move, the move's flags 0x404): a move with an escape (an entry tested
 * `1`) is waited out and then answered by a button; otherwise the moves it could take are
 * gathered and, by what the opponent is doing, a set of the six choices is allowed and one drawn at
 * random: rising, rolling or moving back is a pad held, the others take candidates of their kind.
 * True when settled.
 */
function downed(m: Moment): boolean {
  const { self, opponent, rec } = m;
  if (s8(self.inAir) !== 0 || (rec.ownFlags & 0x404) === 0) return false;
  const settleWith = (pad: number): boolean => {
    rec.pad = pad;
    return true;
  };
  let escape = false;
  for (const entry of cancelEntries(m, movesList(m, self.move))) if (s8(entryAt(m, entry).test) === 0x31) escape = true;
  if (escape) {
    const wait = s16(rec.escapeWait - 1);
    rec.escapeWait = wait;
    if (-1 < wait) return settleWith(0);
    const k = m.state.random.mix & 3;
    const next = (rec.tuning[k >> 1]! >> ((k & 1) * 8)) & 0xff;
    stepMix(m);
    rec.pad = 0x10;
    rec.escapeWait = next;
    return true;
  }
  rec.takenCount = 0;
  rec.move = self.move;
  const count = gather(m, 1);
  rec.candidateCount = count;
  if (count < 1) return settleWith(0);
  calm(rec);
  rec.downedHold = 0x10;
  if (rec.groundFire !== 0 && (self.stance & 0x200) !== 0) return settleWith(BACK);
  const theirMove = moveOf(m, opponent.move);
  const pinned = ((rec.theirFlags & 0x200000) !== 0 && s8(theirMove.activeWindow.first) === 0) || (rec.theirKindLow === THROW_KIND && (rec.theirKind & 0x10000) === 0 && rec.due < 0x1d);
  if (pinned && opponent.frame < theirMove.activeWindow.last) return settleWith(0);
  let mask = 0;
  if (s8(theirMove.activeWindow.first) === 0) {
    if (2 < rec.nearBand) mask = rec.farBand < 4 ? 0x3f : 7;
    else if ((rec.steps & 1) !== 0) {
      mask = 7;
      if (rec.wait < 0) {
        const roll = m.state.random.mix & 0x3f;
        stepMix(m);
        if (roll === 0) mask = 0x38;
      }
    }
  } else if (rec.due < 0xc && opponent.frame <= theirMove.activeWindow.last) {
    if (rec.theirKindLow === LOW || (rec.theirKind & 0x10000) !== 0) {
      if ((rec.steps & 1) !== 0) {
        const before = m.state.random.mix;
        const stepped = (Math.imul(before, 5) + 3) >>> 0;
        if ((before & 2) === 0) {
          let rolls = true;
          if (s8(moveOf(m, opponent.move).stepWindow.first) === 0 && rec.turned <= 0x4000) {
            mask = 4;
            m.state.random.mix = stepped;
            rolls = (rec.theirFlags & 0x200000) !== 0;
          }
          if (rolls) {
            mask = (stepped & 0x3f) === 0 ? 4 : 2;
            m.state.random.mix = (Math.imul(stepped, 5) + 3) >>> 0;
          }
        } else {
          mask = 0x38;
          m.state.random.mix = stepped;
        }
      }
    } else if (rec.farBand < 3 && (rec.farBand < 2 || rec.closing < 0xb)) {
      const roll = m.state.random.mix & 0xf;
      stepMix(m);
      mask = roll !== 0 ? 0x3f : 0;
    } else mask = 1;
  } else if (rec.nearBand < 2) mask = (rec.theirFlags & 2) !== 0 ? 0x38 : 0x28;
  if (mask === 0) return settleWith(0);
  let action: number;
  do {
    const value = rand(m) + m.state.random.mix;
    stepMix(m);
    action = m.data.computer.downedActions[((value & 0x7fff) * 6) >> 15]!;
  } while ((mask & action) === 0);
  switch (action) {
    case 1:
      return settleWith(UP);
    case 2:
      return settleWith((rec.steps & 7) === 0 ? 0x4080 : 0x80);
    case 4:
      return settleWith(self.character === 0x12 ? FORWARD : BACK);
    case 8:
      markApproaches(m);
      break;
    case 0x10:
      markCandidates(m, (move) => (kindOf(move) & 0x10000) !== 0 || (kindOf(move) & 0xffff) === LOW);
      break;
    case 0x20:
      markCandidates(m, (move, entry) => s16(entry.command) === -0x3fff || ((move.flags & 0xa0000) === 0x80000 && (move.flags & 0x600000) === 0));
      break;
  }
  if (0 < rec.takenCount) chooseCandidate(m);
  return true;
}

/* ---- Guarding. ---- */

/**
 * Keeping the guard up: while the opponent's attack is one the guard stops and it is coming (the
 * countdown running, or within 30 frames of its window), the direction held stays. When the
 * opponent's attack whiffed, the chance not to (the tuning's counter chance plus the attacks
 * counted times the difficulty) is rolled first, and failing it urges the fighter on instead.
 */
function keepGuard(m: Moment): boolean {
  const { opponent, rec } = m;
  if (s8(opponent.whiffed) !== 0 && mix12(m) < rec.tuning[Tune.COUNTER]! + rec.theirAttacks * m.state.computer.difficulty * 0x1e) {
    rec.urge = 1;
    return false;
  }
  const start = moveOf(m, opponent.move).activeWindow.first;
  if ((-1 < rec.attackCountdown || start === 0 || start - 0x1e < opponent.frame) && rec.guardStops !== 0) {
    rec.pad = rec.lastPad & HELD_DIRECTION;
    return true;
  }
  return false;
}

/* ---- Follow-ups and waiting. ---- */

/** Whether a move's guard kind (its `hitLevel`) is one a distance band allows. */
function bandAllows(t: Turn, kind: number, band: number): boolean {
  let bits = (kind & 0xffff0000) >>> 0;
  if ((kind & 0x1c0000) === 0) bits = (bits | 0xc0000) >>> 0;
  return (bits & t.data.computer.followUpKinds[band]!) !== 0;
}

/**
 * When the fighter's move has just started, what it should go on into is listed while the move
 * plays, and the direction held meanwhile: the move's special follow-ups (a target flagged 0x20 in
 * its hit flags' second byte, up to four) while they are wanted; else follow-ups of the kinds the
 * distance band allows (up to 48, a few kinds only by chance) while those are; else, unless in a
 * hold's window, the string's next presses (entries open at frame 1 for a single frame, up to ten,
 * the latest frame kept). True when settled.
 */
function followUps(m: Moment): boolean {
  const { self, rec } = m;
  let settled = false;
  if (rec.moveChanged !== 0) {
    rec.move = self.move;
    rec.lastMoveFrame = s16(self.frame);
    const cancels = (): Generator<CancelRef> => cancelEntries(m, movesList(m, rec.move));
    if (0 < rec.specialsWanted) {
      let count = 0;
      for (const ref of cancels()) {
        const entry = entryAt(m, ref);
        if (!conditionHolds(m, entry) || ((moveOf(m, moveById(m, entry.target)).hitFlags >> 8) & 0x20) === 0) continue;
        rec.specials[count] = ref;
        count += 1;
        if (3 < count) break;
      }
      rec.specialCount = count;
      settled = true;
      if (count < 1) {
        rec.specialCount = 0;
        rec.specialsWanted = 0;
      } else rec.pad = rec.lastPad & HELD_DIRECTION;
    } else if (0 < rec.followUpsWanted) {
      let count = 0;
      const lowAttack = rec.lowComing;
      const chance = rec.tuning[Tune.FOLLOW_UP]!;
      stepMix(m);
      const allowed = m.data.computer.followUpKinds[rec.nearBand]!;
      for (const ref of cancels()) {
        const entry = entryAt(m, ref);
        if (!conditionHolds(m, entry)) continue;
        const target = moveOf(m, moveById(m, entry.target));
        if ((lowAttack !== 0 && (kindOf(target) & 0x400000) !== 0) || (target.flags & 0x20000) !== 0) continue;
        let kind = kindOf(target);
        if ((kind & 0x200000) === 0 && (target.flags & 0x80000) === 0) {
          if ((kind & 0x400000) === 0) continue;
          const roll = m.state.random.mix & 0x7fff;
          stepMix(m);
          if (roll <= chance) continue;
          kind = kindOf(target);
        }
        let bits = (kind & 0xffff0000) >>> 0;
        if ((kind & 0x1c0000) === 0) bits = (bits | 0xc0000) >>> 0;
        if ((bits & allowed) === 0) continue;
        rec.followUps[count] = ref;
        count += 1;
        if (0x2f < count) break;
      }
      rec.followUpCount = count;
      settled = true;
      if (0 < count) rec.pad = rec.lastPad & HELD_DIRECTION;
      else {
        rec.followUpCount = 0;
        rec.followUpsWanted = 0;
      }
    } else if (rec.holdWindow === 0) {
      if (s8(moveOf(m, self.move).activeWindow.first) === 0) {
        rec.stringCount = 0;
        rec.followUpCount = 0;
        rec.specialCount = 0;
        rec.stringWanted = 0;
        rec.followUpsWanted = 0;
        rec.specialsWanted = 0;
      } else {
        let count = 0;
        const chance = rec.tuning[Tune.PATIENCE]!;
        if (rec.stringSkip === 0) {
          rec.stringLast = 0;
          for (const ref of cancels()) {
            const entry = entryAt(m, ref);
            if (entry.from !== 1 || entry.to !== entry.start || !conditionHolds(m, entry)) continue;
            if (((moveOf(m, moveById(m, entry.target)).hitFlags >> 8) & 0x20) !== 0 && mix12(m) < chance) continue;
            rec.string[count] = ref;
            if (entry.to < 0x3c && rec.stringLast < entry.to) rec.stringLast = entry.to;
            count += 1;
            if (9 < count) break;
          }
          rec.stringCount = count;
        } else rec.stringSkip = 0;
        settled = true;
        if (count < 1) {
          rec.stringCount = 0;
          rec.stringWanted = 0;
        } else {
          rec.pad = rec.lastPad & HELD_DIRECTION;
          rec.stringWanted = s16(rec.stringWanted + 1);
        }
      }
    }
  }
  rec.lastMoveFrame = s16(self.frame);
  return settled;
}

/** Every free candidate taken; returns how many, added to the taken. */
function takeAll(t: Turn, count: number): number {
  let taken = 0;
  for (let i = 0; i < count; i += 1) {
    const candidate = candidateAt(t, i);
    if (candidate.taken !== 0) continue;
    candidate.taken = 1;
    taken += 1;
  }
  t.rec.takenCount = s16(t.rec.takenCount + taken);
  return taken;
}

/** The moves the fighter could take now gathered; a move held over 220 frames takes any of them. */
function ranLong(m: Moment): boolean {
  const { rec } = m;
  const count = gather(m, 0);
  rec.candidateCount = count;
  if (rec.moveFrames <= 0xdc || takeAll(m, count) <= 0) return false;
  chooseCandidate(m);
  return true;
}

/**
 * In a hold's window with moves gathered and no fire coming: when the attack lands before the
 * fighter's window, or the opponent is far, or the fighter is mid-turn, any candidate is taken and
 * one chosen (the wait dropped when one is); the frame is settled either way.
 */
function holdThrough(m: Moment): boolean {
  const { self, rec } = m;
  if (rec.holdWindow === 0 || rec.candidateCount === 0 || rec.fireComing !== 0) return false;
  if (rec.due < moveOf(m, self.move).activeWindow.first - self.frame || 2 < rec.nearBand || self.facingQuadrant === 2) {
    if (0 < takeAll(m, rec.candidateCount) && -1 < chooseCandidate(m)) rec.wait = -1;
  }
  return true;
}

/** Facing the attack due in 9 to 11 frames, turned less than a quarter, not mid-sidestep. */
const facingAttack = (rec: ComputerRecord): boolean => ((rec.due & 0xffff) - 9) >>> 0 < 3 && rec.turned < 0x4000 && (rec.ownFlags & 0x400000) === 0;

/** The opponent attacking: a move whose kind's low half is set and not a throw's, or an attack held. */
const theyAttack = (rec: ComputerRecord): boolean => (s16(rec.theirKind) !== 0 && s16(rec.theirKind) !== THROW_KIND) || 0 < rec.heldFrames;

/**
 * An attack coming (counted, the opponent not far): by the tuning's chance (or an urge) the attacks
 * that land first are taken while it is 2 to 29 frames off; when the fighter is not attacking and
 * the opponent's is a real attack, it crouches back by chance (down-back, or back from a mid,
 * unless already crouched); and by chance it sidesteps the attack due in 9 to 11 frames when
 * facing it and not too close. True when settled.
 */
function answerComing(m: Moment): boolean {
  const { self, rec } = m;
  if (rec.coming === 0 || rec.theirAttacks < 0 || 4 <= rec.farBand) return false;
  if (rec.urge !== 0 || mix12(m) < rec.tuning[Tune.ANSWER]!) {
    const due = rec.due;
    if (due < 0x1e && 1 < due && 0 < markFasterAttacks(m) && -1 < chooseCandidate(m)) return true;
  }
  if (rec.attacking === 0) {
    if (theyAttack(rec) && (rec.crouch !== 0 || mix12(m) < rec.tuning[Tune.CROUCH_BACK]!)) {
      let pad = 0;
      if (self.facingQuadrant === 0) {
        pad = rec.theirKindLow === MID ? BACK : DOWN_BACK;
        calm(rec);
      }
      rec.pad = pad;
      return true;
    }
  }
  if (rec.tuning[Tune.SIDESTEP]! <= mix12(m)) return false;
  if (!facingAttack(rec) || rec.farBand <= 1) return false;
  sidestep(m, -1);
  rec.wait = s16(rec.wait - 10);
  return true;
}

/* ---- Answering an attack. ---- */

/**
 * What to do about the opponent's attack, as a response kind: 0 nothing particular (the attack
 * planner decides), 1 counter, 2 crouch, 3 follow the retreat plan, 4 sidestep, 5 and 6 a few moves
 * by id, 7 and 8 a character's scripted answer, 9 a guard move. Each step's chance is the tuning's.
 */
function responseKind(m: Moment): number {
  const { self, opponent, rec } = m;
  if (-1 < rec.theirAttacks || rec.rolling !== 0) return 0;
  if (rec.attackCountdown === 0 && rec.attacking === 0) return 2;
  if (rec.retreat === 0 && (rec.coming === 0 || 4 <= rec.farBand)) return 0;
  const theirMove = moveOf(m, opponent.move);
  if ((s8(theirMove.activeWindow.first) !== 0 && theirMove.activeWindow.last < opponent.frame) || self.theirQuadrant === 2) rec.retreat = 2;
  const kind = rec.theirKindLow;
  if (rec.retreat === 0 && (kind === THROW_KIND || kind === THROW_KIND_TOO || (rec.theirFlags & 0x200000) !== 0) && mix12(m) < rec.tuning[Tune.CHARACTER]!) rec.retreat = 1;
  if (rec.answerHold < 0 && rec.retreat !== 2 && rec.retreat !== 0) return 3;
  const threat = (): boolean =>
    rec.coming !== 0 && rec.guardStops === 0 && s16(self.theirOffSize) < 0x5000 && rec.distance < OUT_OF_REACH && bandAllows(m, kindOf(moveOf(m, opponent.move)), rec.farBand);
  const due = rec.due;
  const responses = m.data.computer.responses[self.character]!;
  if (((rec.due & 0xffff) - 8) >>> 0 < 2 && rec.ownKindLow === 0 && s8(self.inAir) === 0 && responses.flag !== 0 && ((moveOf(m, opponent.move).hitFlags >> 8) & 8) === 0 && s8(opponent.inAir) === 0) {
    if (threat() && mix12(m) < rec.tuning[Tune.SCRIPTED]!) return 5;
  }
  if (self.character === 9 && due < 0x1b && 0x15 < due && rec.ownKindLow === 0 && s8(self.inAir) === 0) {
    if (threat() && mix12(m) < rec.tuning[Tune.SCRIPTED]!) return 6;
  }
  if (((rec.due & 0xffff) - 4) >>> 0 < 7 && rec.ownKindLow === 0 && s8(self.inAir) === 0 && s8(opponent.inAir) === 0 && threat() && mix12(m) < rec.tuning[Tune.SCRIPTED]!) {
    if ([HIGH, MID, THROW_KIND, THROW_KIND_TOO].includes(rec.theirKindLow) && responses.answer >= 0) return 7;
    if (rec.theirKindLow === LOW && responses.lowAnswer >= 0) return 8;
  }
  if ((rec.theirKind & 0x400000) !== 0) {
    if (escapeIsSure(opponent) && mix12(m) < rec.tuning[Tune.CHARACTER]!) return 1;
    if ((rec.theirKind & 0x400000) !== 0 && rec.due <= 0x1d && mix12(m) < rec.tuning[Tune.SPECIAL_CROUCH]!) {
      rec.crouch = 2;
      return 2;
    }
  }
  if (theyAttack(rec)) {
    if (rec.guardStops !== 0 || rec.attacking !== 0) return 0;
    if (rec.crouch !== 0) return 2;
    if (mix12(m) < rec.tuning[Tune.CROUCH]! || (0x1e < rec.heldFrames && mix12(m) < rec.tuning[Tune.CROUCH_CAP]!)) {
      rec.crouch = 5;
      return 2;
    }
  }
  if ((8 < rec.attackCountdown && (mix12(m) & 0x1f) === 0) || (rec.seenTwice !== 0 && (mix12(m) & 0xf) === 0)) return 1;
  /* A counter: against the attack seen hurting it last by one chance, else by the counter chance; failing both, a sidestep or nothing. */
  if (sameMove(opponent.move, rec.hurtBy[0]!) && rec.rolling === 0 && mix12(m) < rec.tuning[Tune.COUNTER_CAP]!) return 1;
  const counter = rec.rolling === 0 && mix12(m) < rec.tuning[Tune.COUNTER]!;
  if (!counter) {
    if (rec.heldFrames < 0x1f || rec.tuning[Tune.COUNTER_CAP]! <= mix12(m)) {
      if (!facingAttack(rec) || rec.farBand !== 2) return 0;
      if ((rec.ownFlags & 1) !== 0 || s8(self.inAir) !== 0 || rec.attacking !== 0 || rec.theirKindLow !== HIGH) return 0;
      return mix12(m) < rec.tuning[Tune.SIDESTEP]! ? 4 : 0;
    }
  }
  if (rec.theirKindLow !== HIGH) return 1;
  return (mix12(m) & 0x3f) === 0 ? 9 : 1;
}

/** Crouching from what is coming: down-back, or back from a mid, unless already crouched. */
function crouchBack(t: Turn): boolean {
  let pad = 0;
  if (t.self.facingQuadrant === 0) {
    pad = t.rec.theirKindLow === MID ? BACK : DOWN_BACK;
    calm(t.rec);
  }
  t.rec.pad = pad;
  return true;
}

/**
 * A response played: taking candidates and choosing among them, crouching, a retreat plan, a
 * sidestep, or a script. False when the attack planner should decide after all.
 */
function respond(m: Moment): boolean {
  const { self, rec } = m;
  /** The shared ending: with candidates taken, one chosen, and the plans dropped when one is. */
  const chooseTaken = (taken: number): boolean => {
    if (taken <= 0) return false;
    if (-1 < chooseCandidate(m)) calm(rec);
    return true;
  };
  switch (responseKind(m)) {
    case 1: {
      const kind = rec.theirKindLow;
      let taken: number;
      if (rec.coming === 0) taken = markQuickAttacks(m);
      else if (kind === THROW_KIND || kind === THROW_KIND_TOO || (rec.theirFlags & 0x200001) !== 0) taken = markFasterAttacksSave412(m);
      else taken = markFasterAttacks(m);
      if (kind === HIGH) taken += markCandidates(m, (move) => move.activeWindow.first !== 0 && (move.flags & 0x20001) === 1 && bandAllows(m, kindOf(move), rec.nearBand));
      return chooseTaken(taken);
    }
    case 2: {
      const taken = markDefences(m);
      if (0 < taken) return chooseTaken(taken);
      return crouchBack(m);
    }
    case 3:
      return retreat(m);
    case 4:
      sidestep(m, -1);
      rec.wait = s16(rec.wait - 10);
      return true;
    case 5:
      return chooseTaken(markCandidates(m, (_, entry) => entry.target === 0x1ee || entry.target === 0x6a3));
    case 6:
      return chooseTaken(markCandidates(m, (_, entry) => entry.target === 0x22c));
    case 7:
      startScript(m, m.data.computer.responses[self.character]!.answer);
      return true;
    case 8:
      startScript(m, m.data.computer.responses[self.character]!.lowAnswer);
      return true;
    case 9: {
      const taken = markCandidates(m, guardMove);
      if (taken <= 0) return false;
      rec.urgeNext = 1;
      rec.wait = -1;
      return chooseTaken(taken);
    }
    default:
      return false;
  }
}

/**
 * Response 3: the retreat plan (1 means draw one: at a close band by the tuning's patience, else
 * 3), unless the opponent is high up. Out of reach, plans other than 1 and 2 end and nothing is
 * held. Plan 3 steps in or takes attacks on the guard by the attack's timing, 4 steps back or
 * forward, 5 sidesteps the late attacks, 6 backs away by script; 1 and 2 leave it to the attack
 * planner.
 */
function retreat(m: Moment): boolean {
  const { self, opponent, rec } = m;
  if (rec.theyAreHigh !== 0) return false;
  let distance = rec.distance;
  if (rec.retreat === 1) {
    let plan = 3;
    if (3 <= rec.nearBand || mix12(m) < rec.tuning[Tune.PATIENCE]!) plan = m.data.computer.retreatPlans[Math.imul(mixedRand(m), 7) >> 15]!;
    rec.retreat = plan;
  }
  if (opponent.character === 4) distance -= 0x12c;
  const plan = rec.retreat;
  const settleWith = (pad: number): boolean => {
    rec.pad = pad;
    return true;
  };
  if (2 <= (plan - 1) >>> 0 && OUT_OF_REACH <= distance) {
    rec.retreat = 0;
    return settleWith(0);
  }
  const due = rec.due;
  const backTurned = s16(self.theirOffSize);
  switch (plan) {
    case 3: {
      calm(rec);
      const theirMove = moveOf(m, opponent.move);
      if (theirMove.activeWindow.first !== 0 && theirMove.activeWindow.last < opponent.frame) return false;
      if (0x1d <= due) {
        if (3 <= rec.nearBand) {
          rec.pad = stepIn(m);
          rec.wait = mix12(m) & 0xf;
          return true;
        }
        return markAttacksOnGuard(m) <= 0;
      }
      if (9 <= due) {
        if (OUT_OF_REACH <= distance) return settleWith(0);
        if (rec.nearBand < 3) {
          if (markAttacksOnGuard(m) <= 0) return true;
          rec.wait = -1;
          return false;
        }
        if (0x4000 <= backTurned) return false;
        rec.retreat = 4;
        return settleWith(BACK);
      }
      if (OUT_OF_REACH <= distance) return settleWith(0);
      return settleWith(backTurned < 0x4000 ? BACK : 0);
    }
    case 4:
      calm(rec);
      if (0x4001 <= backTurned && 2 <= rec.farBand) return settleWith(FORWARD);
      if (OUT_OF_REACH <= distance) return settleWith(0);
      if (9 <= due && rec.nearBand < 2) {
        if (markAttacksOnGuard(m) <= 0) return true;
        rec.wait = -1;
        return false;
      }
      startScript(m, m.data.computer.backAway);
      return true;
    case 5:
      if ((rec.ownFlags & 0x400000) !== 0 || (mix12(m) & 7) !== 0 || due < 7) {
        rec.pad = FORWARD;
        return false;
      }
      if (0x4000 <= backTurned) rec.retreat = 3;
      sidestep(m, -1);
      return true;
    case 6:
      calm(rec);
      if (OUT_OF_REACH <= distance) return settleWith(0);
      if (0x1d <= due) return settleWith(0 < rec.farBand ? BACK : 0);
      if (2 <= rec.farBand || due < 8) {
        startScript(m, m.data.computer.backAway);
        return true;
      }
      rec.holdFrames = 0x14;
      return settleWith(0x3000);
    default:
      return false;
  }
}

/* ---- The attack planner. ---- */

/** Whether an entry's window is open now and its tests pass (tests `$ % & 0 '` read where the opponent stands). */
function followUpOpen(t: Turn, entry: Cancel): boolean {
  const frame = t.self.frame;
  if (frame < entry.from || entry.to < frame || !conditionHolds(t, entry)) return false;
  const bits = t.rec.around;
  switch (entry.test) {
    case 0:
      return true;
    case 0x24:
      return (bits & 1) !== 0;
    case 0x25:
      return (bits & 2) !== 0;
    case 0x26:
      return (bits & 4) !== 0;
    case 0x30:
      return (bits & 8) !== 0;
    case 0x27:
      return (bits & 0x10) !== 0;
    default:
      return cancelTest(t.state, t.data, entry, t.self, t.opponent);
  }
}

/**
 * The follow-ups `followUps` listed, dropped: the original tests each to pick one, but its count of
 * open entries is never raised, so the pick never runs; the tests still do (they note the attack
 * class), and all three lists end.
 */
function dropFollowUps(m: Moment): void {
  const { rec } = m;
  if (0 < rec.specialsWanted) {
    for (let i = 0; i < rec.specialCount; i += 1) followUpOpen(m, entryAt(m, rec.specials[i]!));
    rec.specialsWanted = 0;
    rec.specialCount = 0;
    rec.specialsDropped = 1;
  }
  if (0 < rec.followUpsWanted) {
    for (let i = 0; i < rec.followUpCount; i += 1) followUpOpen(m, entryAt(m, rec.followUps[i]!));
    rec.followUpsWanted = 0;
    rec.followUpCount = 0;
  }
  if (-1 < rec.stringWanted) {
    for (let i = 0; i < rec.stringCount; i += 1) followUpOpen(m, entryAt(m, rec.string[i]!));
    rec.stringWanted = 0;
    rec.stringCount = 0;
  }
}

/** Not attacking and turned from the opponent: step or turn back toward it. True when settled. */
function turnToFace(m: Moment): boolean {
  const { self, opponent, rec } = m;
  if (rec.attacking !== 0) return false;
  const settleWith = (pad: number): boolean => {
    rec.pad = pad;
    return true;
  };
  const theirMove = moveOf(m, opponent.move);
  if (theirMove.stepWindow.first !== 0 && rec.farBand < 2 && mix12(m) < rec.tuning[Tune.TURN]!) {
    if (rec.turned < 0x4000 && rec.closing < -10) return settleWith(DOWN_FORWARD);
    if (0x15 <= theirMove.stepWindow.last - opponent.frame && 0x4001 <= rec.turned) return settleWith(FORWARD);
  }
  const forwardOrBack = (): number => (rec.turned < 0x4000 ? FORWARD : BACK);
  if (0x6001 <= rec.turned && rec.farBand < 2) {
    if (opponent.inAir !== 0) return settleWith(0);
    if (rec.lowComing !== 0) return settleWith((rec.steps & 1) !== 0 ? 0x4040 : 0x4020);
    if (rec.tuning[Tune.PATIENCE]! <= mix12(m)) {
      rec.wait = -2;
      return false;
    }
    return settleWith(self.character === 7 ? forwardOrBack() : FORWARD);
  }
  if (rec.turned < 0x1001) return false;
  if (rec.turned <= mixBits(m, 0x7fff)) return false;
  if (mix12(m) < rec.tuning[Tune.PATIENCE]!) return false;
  rec.walkLeft = 8;
  rec.walkKind = 0;
  rec.calm = 0x30;
  if (self.character === 7) return settleWith(forwardOrBack());
  if (rec.coming !== 0 && mixBits(m, 7) === 0) {
    if (self.facingQuadrant !== 0) return settleWith(0);
    calm(rec);
    return settleWith(rec.theirKindLow === MID ? BACK : DOWN_BACK);
  }
  return settleWith(rec.farBand < 3 && (rec.steps & 1) !== 0 ? BACK : FORWARD);
}

/**
 * The attack chosen: candidates of a kind are taken by what the opponent is doing and how far it
 * is, one is played, and the plans it starts noted. True when settled; false leaves the frame to
 * walking.
 */
function attack(m: Moment): boolean {
  const { self, rec } = m;
  if (0 < rec.guardHold) {
    rec.guardHold = s16(rec.guardHold - 1);
    rec.pad = rec.lastPad & HELD_DIRECTION;
    return true;
  }
  if (5 <= rec.guardPlan) {
    rec.pad = rec.lastPad & HELD_DIRECTION;
    return true;
  }
  if (4 <= rec.nearBand || rec.theyAreHigh !== 0 || rec.attackLimit <= rec.attacks) return false;
  if (2 < rec.nearBand && randBelow(m, 12) !== 0) return false;
  if (1 < rec.nearBand && randBelow(m, 8) === 0) return false;
  if (rec.walkKind !== 0) {
    if (0 < rec.attackCountdown || (rec.coming !== 0 && rec.farBand < 4)) {
      rec.pad = BACK;
      return true;
    }
    if ((rec.theirFlags & 4) !== 0 && randBelow(m, 0x1000) < 0x100) return false;
  }
  const wait = rec.wait;
  const chance = rec.tuning[Tune.PRESS]!;
  if (rec.specialsDropped !== 0) {
    let dropped = 0;
    for (let i = 0; i < rec.candidateCount; i += 1) {
      const candidate = candidateAt(m, i);
      if (candidate.taken < 0 || ((moveOf(m, candidate.move).hitFlags >> 8) & 0x20) === 0) continue;
      if (0 < candidate.taken) dropped += 1;
      candidate.taken = -1;
    }
    rec.takenCount = s16(rec.takenCount - dropped);
  }
  if (0x19 < rec.comingFrames && rec.attackCountdown < 0 && rec.guardStops === 0) {
    const due = rec.due - (mixBits(m, 7) + 4);
    rec.attackCountdown = s16(Math.max(due, 3));
  }
  let taken = rec.attackCountdown < 1 ? plan(m, wait, chance) : 0;
  if (taken === 0 && 2 < rec.farBand && self.recovery === 0 && self.health <= div(self.maxHealth, 10) && mixBits(m, 3) === 0 && mix12(m) < rec.tuning[Tune.COUNTER]!) {
    taken = markCandidates(m, (move) => ((move.hitFlags >> 8) & 0x100) !== 0);
  }
  if (taken < 0) {
    calm(rec);
    return true;
  }
  const index = chooseCandidate(m);
  if (index < 0) return false;
  calm(rec);
  const move = moveOf(m, candidateAt(m, index).move);
  if (m.state.attract === 0 && ((move.hitFlags >> 8) & 0x20) !== 0) rec.specialsWanted = 1;
  else if (((rec.ownFlags & 0x80000) !== 0 && mixBits(m, 0x3f) < 0x20) || ((move.flags & 0x80000) !== 0 && mixBits(m, 0x3f) < 0x30)) rec.followUpsWanted = 1;
  const guard = rec.performed === null ? 0 : s16(moveOf(m, rec.performed).flags & 0xffff);
  if (guard === GUARD_BACK || guard === CROUCHING_GUARD) rec.guardHold = 0xc;
  return true;
}

/** A guard move: flagged 1, no active frames. */
const guardMove = (move: Move): boolean => (move.flags & 1) === 1 && s8(move.activeWindow.first) === 0;

/**
 * The candidates taken for `attack`: the count taken, or -1 when a script or sidestep was started
 * instead. `wait` is the wait as the frame began (-1 forces a choice), `chance` the tuning's press
 * chance (0 when the opponent cannot be pressed).
 */
function plan(m: Moment, wait: number, chance: number): number {
  const { self, opponent, rec } = m;
  const patience = rec.tuning[Tune.PATIENCE]!;
  if (rec.urge !== 0 || rec.press !== 0 || (0x19 < rec.comingFrames && div(patience, 2) <= mix12(m)) || ((rec.ownAttackFrames - 1) >>> 0 < 0x13 && patience <= mix12(m))) wait = -1;
  if (mix12(m) < rec.tuning[Tune.TURN]! && s8(opponent.inAir) !== 0 && s16(rec.theirFlags) !== GETTING_UP) {
    const theirMove = moveOf(m, opponent.move);
    const end = theirMove.stepWindow.last;
    const start = theirMove.stepWindow.first;
    const frame = opponent.frame;
    if (start + div(end - start, 2) <= frame && frame <= end && rec.turned < 0x4001 && rec.nearBand === 2) rec.wait = -1;
  }
  if (s16(opponent.moveId) === 6 && rec.nearBand < 3 && mix12(m) < rec.tuning[Tune.COUNTER]!) rec.wait = s16(rec.wait - 2);
  if ((rec.theirFlags & 0x605) !== 0 || s8(opponent.inAir) !== 0 || s8(opponent.counterWindow) !== 0 || opponent.character === 0x13 || rec.due < 10) {
    chance = 0;
    rec.press = 0;
  }
  if (m.court !== null && ballAhead(m)) return markApproaches(m);
  const low = (move: Move): boolean => {
    const kind = kindOf(move);
    return move.activeWindow.first < 0x51 && ((kind & 0x10000) !== 0 || (kind & 0xffff) === SPECIAL_LOW) && (kind & 0x400000) === 0;
  };
  const dashes = (move: Move, entry: Cancel): boolean => entry.command === DASH_IN || ((move.flags & 0xa0000) === 0x80000 && (move.flags & 0x600000) === 0);
  const risingLow = (move: Move): boolean => (kindOf(move) & 0x10000) !== 0 && s8(move.activeWindow.first) === 0 && s8(move.stepWindow.first) === 0;
  if (rec.lowComing !== 0 && rec.rolling === 0) {
    let taken = 0;
    if (rec.attacking === 0) {
      if (patience <= mix12(m)) wait = -1;
      if (rec.turned < 0x4001 || mixBits(m, 0xf) !== 0) {
        if (wait < 0) {
          const roll = mix12(m);
          if (roll < 0x334) taken = markCandidates(m, (move, _, ref) => s8(entryAt(m, listOf(ref, move)).test) === 0x35 && (kindOf(move) & 0x400000) === 0);
          else if (roll < 0x3af) {
            sidestep(m, roll & 1);
            taken = -1;
          } else if (roll < 0x6e2) taken = markCandidates(m, low);
          else if (roll < 0x75d && (rec.ownFlags & 1) === 0) taken = markCandidates(m, guardMove);
          else if (roll < 0x829) taken = markCandidates(m, (_, entry) => entry.command === DASH_BACK);
          else if ((rec.nearBand - 2) >>> 0 < 2 && roll < 0x9c3) {
            startScript(m, m.data.computer.approach);
            taken = -1;
          } else taken = markCandidates(m, (move) => low(move) || (move.activeWindow.first < 0x51 && (kindOf(move) & 0xffff) === LOW && (kindOf(move) & 0x400000) === 0));
        }
      } else taken = markCandidates(m, (move) => (move.flags & 0x20000) !== 0);
    }
    return taken < 0 ? -1 : taken;
  }
  if (s16(rec.theirFlags) === GETTING_UP && mix12(m) < rec.tuning[Tune.RISING_ATTACK]!) {
    let taken = 0;
    if (rec.nearBand < 3) {
      if (1 < rec.nearBand) taken = mixBits(m, 0xf) === 0 ? markCandidates(m, (_, entry) => entry.command === DASH_IN) : markCandidates(m, risingLow);
    } else if (rec.closing < 0x33 && mixBits(m, 7) === 0) taken = markCandidates(m, risingLow);
    else {
      taken = markCandidates(m, (_, entry) => entry.command === DASH_IN);
      if (0 < taken) {
        rec.walkKind = 2;
        rec.walkLeft = 0xfa;
        rec.calm = 0x136;
      }
    }
    if (rec.nearBand < 4 && rec.theyAreHigh === 0 && patience <= mix12(m)) {
      rec.wait = -1;
      if (s8(opponent.inAir) === 0 && mixBits(m, 0x3f) < 0x20 && rec.dropLows === 0) taken += markBeatingKindsSave412(m);
      else taken += markBeatingKinds(m);
    }
    return taken;
  }
  if (-1 < rec.travelPlan) {
    const taken = markCandidates(m, (move) => s8(move.activeWindow.first) !== 0 && ((move.flags & 0x80000) !== 0 || (kindOf(move) & 0x200000) !== 0) && (move.flags & 0x20000) === 0);
    if (0 < taken) rec.travelPlan = -1;
    return taken;
  }
  const fallback = (): number => {
    if (0 < wait) return 0;
    return (rec.theirFlags & 1) !== 0 ? markAttacksOnGuard(m) : markApproaches(m);
  };
  if (rec.heldFrames !== 0) {
    if (rec.urge === 0 && rec.tuning[Tune.COUNTER]! <= mix12(m)) return fallback();
    return markAgainstAttack(m);
  }
  if ((rec.coming !== 0 || rec.special !== 0) && rec.rolling === 0) {
    if (rec.urge !== 0 || mix12(m) < rec.tuning[Tune.COUNTER]!) return markAgainstAttack(m);
    return fallback();
  }
  if (0 < wait) {
    if (2 < rec.nearBand || (rec.ownFlags & 1) !== 0 || 3 < mix12(m)) return 0;
    return markCandidates(m, guardMove);
  }
  if (0 <= rec.guardPlan) {
    const taken = markCandidates(m, (move) => (move.flags & 0xa0000) === 0x80000 && s8(move.stepWindow.first) === 0);
    rec.guardPlan = -1;
    return taken;
  }
  if ((rec.press !== 0 || mix12(m) < chance) && rec.nearBand < 2 && opponent.character !== 0x13) {
    const lowEnough = (move: Move, entry: Cancel): boolean => (kindOf(move) & 0x400000) !== 0 && (entry.command & 0xffe0) === 0;
    let taken: number;
    if (mix12(m) < rec.tuning[Tune.FOLLOW_UP]!) {
      taken = markCandidates(m, (move, entry) => (kindOf(move) & 0x400000) !== 0 && (entry.command & 0xc200) !== 0x200);
      if (taken < 1) taken = markCandidates(m, lowEnough);
    } else taken = markCandidates(m, lowEnough);
    if (0 < taken) return taken;
  }
  /* A scripted opener of the character's, by chance, when its move may be played. */
  const openers = m.data.computer.responses[self.character]!.openers;
  if (rec.openerWait < 0 && 0 < openers.length && rec.attacking === 0 && (rec.ownFlags & 1) === 0 && s16(self.moveId) !== openers[0]!.moveId && rec.turned < 0x2001 && s8(self.inAir) === 0 && rec.nearBand < 3 && rec.lowComing === 0) {
    const roll = mix12(m);
    for (const opener of openers) {
      if (roll <= opener.odds) {
        if (canPlay(m, opener.moveId)) {
          startScript(m, opener.script);
          rec.followUpsWanted = 1;
          rec.openerWait = mixBits(m, 0xf) + 0x1c;
          return -1;
        }
        break;
      }
    }
  }
  if (rec.nearBand < 3 && s8(self.inAir) === 0 && (rec.ownFlags & 1) === 0 && mixBits(m, 0x3f) < 0xe) return markCandidates(m, guardMove);
  if (mixBits(m, 0x3f) < 0x20) return mixBits(m, 1) !== 0 ? markCandidates(m, dashes) : markBeatingKinds(m);
  if (rec.guardPlan < 0 && rec.travelPlan < 0 && (rec.ownFlags & 1) === 0 && s8(self.inAir) === 0 && mix12(m) < 0x200) {
    const taken = markCandidates(m, guardMove);
    if (0 < taken) {
      rec.guardPlan = 0x12;
      rec.wait = -1;
      return taken;
    }
  }
  let taken = markCandidates(m, dashes);
  if (mix12(m) < rec.tuning[Tune.REACH]!) return taken + markReachingAttacks(m);
  if (mix12(m) < rec.tuning[Tune.QUICK]!) return taken + markQuickAttacks(m);
  if ((rec.theirFlags & 1) !== 0 && patience <= mix12(m)) return taken + markAttacksOnGuard(m);
  if (mixBits(m, 0x3f) < 10) return taken + markButtonAttacks(m);
  if (s8(self.inAir) === 0 && rec.travelPlan < 0 && randBelow(m, 0x1000) < 0x200) {
    /* The earlier count is dropped here, as in the original. */
    taken = markCandidates(m, (move) => s8(move.stepWindow.first) !== 0 && (move.flags & 0x20000) === 0 && ((move.flags & 0x80000) !== 0 || (kindOf(move) & 0x200000) !== 0));
    if (0 < taken) {
      rec.travelPlan = s16(randBelow(m, 4) + randBelow(m, 4) + randBelow(m, 4) + 1);
      return taken;
    }
  }
  if (randBelow(m, 0x1000) < 10) {
    return taken + markCandidates(m, (move, entry) => s8(move.activeWindow.first) === 0 && s8(move.stepWindow.first) === 0 && (move.flags & 0x20000) === 0 && entry.target !== 0x1ee && entry.target !== 0x6a3);
  }
  return taken + markApproaches(m);
}

/* ---- Walking. ---- */

/** Whether the opponent's coming attack should stop a walk: one the guard does not already stop, near, of the band's kinds. */
function walkStopper(m: Moment): boolean {
  const { self, opponent, rec } = m;
  if (rec.coming === 0 || rec.guardStops !== 0 || 0x5000 <= s16(self.theirOffSize) || OUT_OF_REACH <= rec.distance) return false;
  const kind = kindOf(moveOf(m, opponent.move));
  let bits = (kind & 0xffff0000) >>> 0;
  if ((kind & 0x1c0000) === 0) bits = (bits | 0xc0000) >>> 0;
  return (bits & m.data.computer.walkStopKinds[rec.farBand]!) !== 0;
}

/**
 * When no attack was chosen: a walk under way (frames left, a dash in) goes on or is broken off by
 * an attack coming; with nothing going on, a new walk is drawn (`stroll`). Unsettled, the pad falls
 * back to the guard, the direction held, or nothing.
 */
function walk(m: Moment): void {
  const { rec } = m;
  let settled = false;
  if (rec.downedHold < 0) {
    if (0 <= rec.walkLeft) {
      let stop = (rec.fireComing !== 0 && rec.distance < 7001) || rec.nearBand <= 0;
      if (!stop) stop = rec.tuning[Tune.PATIENCE]! <= mix12(m) && walkStopper(m);
      if (stop) {
        calm(rec);
        settled = stroll(m);
      } else if (rec.walkKind === 2) {
        let pad = FORWARD;
        if ((rec.fireComing !== 0 && rec.distance < 7001) || (rec.farBand < 3 && mix12(m) < 0x20)) {
          calm(rec);
          pad = BACK;
        }
        rec.pad = pad;
        settled = true;
      } else {
        settled = true;
        if (rec.wait < 0x24 && rec.farBand === 2 && mixBits(m, 0xf) === 0 && 0 < markCandidates(m, (_, entry) => entry.command === DASH_IN) && -1 < chooseCandidate(m)) {
          rec.walkKind = 0;
          rec.walkLeft = 0;
          rec.calm = 0x28;
        } else rec.pad = rec.lastPad & HELD_DIRECTION;
      }
    } else if (rec.attacking === 0 && rec.guardLeft < 0 && rec.holdFrames < 0 && rec.travelPlan < 0) settled = stroll(m);
  }
  if (settled) return;
  if (0 <= rec.guardLeft) rec.pad = DOWN;
  else if (0 <= rec.holdFrames) rec.pad = rec.lastPad & HELD_DIRECTION;
  else rec.pad = 0;
}

/** The walk drawn when the record is free, by the band, by the fighter's reach while waiting is short, else by the opponent's. */
function strollKind(m: Moment, roll: number): number {
  const rec = m.rec;
  if (rec.wait < 0x24) {
    switch (rec.nearBand) {
      case 0:
      case 1:
        return roll < 0x14 ? 3 : 0;
      case 2:
        if (roll < 0x7a) return 5;
        if (roll < 0x1eb) return 1;
        if (roll < 0x214) return 3;
        return roll < div(rec.tuning[Tune.SIDESTEP]! << 12, 1000) ? 8 : 0;
      case 3:
        return roll < 0x666 ? 2 : roll < 0xb33 ? 1 : 0;
      case 4:
        return roll < 0xcc ? 2 : roll < 0x599 ? 4 : 1;
      case 5:
        return rec.farFrames < 0x2d1 && rec.lowComing === 0 && 0x11d < roll ? 1 : 4;
      default:
        return 0;
    }
  }
  let kind = 0;
  switch (rec.farBand) {
    case 0:
    case 1:
      kind = roll < 0x199 ? 6 : roll < 0x333 ? 3 : 0;
      break;
    case 2:
      kind = roll < 0x28 ? 2 : roll < 0x170 ? 3 : 0;
      break;
    case 3:
      if (roll < 0x1eb) kind = 2;
      else if (roll < 0x214) kind = 5;
      else if (roll < 0x218) kind = 3;
      else if (roll < 0x22d) kind = 1;
      else if (roll < 0x241 && (rec.ownFlags & 2) !== 0) kind = 8;
      break;
    case 4:
      if (roll < 0x80) kind = 2;
      else if (roll < 0x90) kind = 5;
      else if (roll < 0xc0) kind = 8;
      else if (roll < 0x3c0) kind = 1;
      break;
    case 5:
      if (0x2d1 <= rec.farFrames || rec.lowComing !== 0 || roll < 0x51) kind = 4;
      else if (roll < 0xcc) kind = 2;
      else if (roll < 0x400) kind = 1;
      else if (roll < 0x5eb) kind = 5;
      break;
  }
  if ((kind === 3 || kind === 6) && rec.tuning[Tune.BACK_OFF]! <= mix12(m)) kind = 0;
  return kind;
}

/**
 * A new walk, drawn by `strollKind` (none while fire is coming): 1 dash in, 2 walk in for a while,
 * 3 back away, 4 dash in for long, 5 walk in for long, 6 back dash, 8 sidestep. The dashes are the
 * candidates whose command is a dash, falling back to walking when there are none. Backing off is
 * often dropped when the opponent is attacking. True when settled.
 */
function stroll(m: Moment): boolean {
  const { rec } = m;
  if (0 <= rec.calm || 0 <= rec.holdFrames) return false;
  const roll = randBelow(m, 0x1000);
  let kind = 0;
  if (rec.fireComing === 0) {
    kind = strollKind(m, roll);
    if ((kind === 3 || kind === 6) && ((rec.theirFlags & 0x80000) !== 0 || rec.theirKindLow !== 0) && mix12(m) < rec.tuning[Tune.PATIENCE]!) kind = 0;
  }
  const crouched = 0 < rec.guarding;
  const walkFor = (frames: number, wait: number, pad: number): boolean => {
    rec.walkKind = 0;
    rec.walkLeft = frames;
    rec.calm = wait;
    rec.pad = pad;
    return true;
  };
  const forward = crouched ? DOWN_FORWARD : FORWARD;
  const dashes = (command: number): number => markCandidates(m, (_, entry) => entry.command === command);
  const walkIn = (): boolean => {
    const band = rec.nearBand;
    if (-1 < band && band < 3) {
      const v = randBelow(m, 8);
      return walkFor(v + 4, v + 0x2c, forward);
    }
    if (band === 3) {
      const v = randBelow(m, 10);
      return walkFor(v + 10, v + 0x32, forward);
    }
    const v = randBelow(m, 15);
    return walkFor(v + 15, v + 0x37, forward);
  };
  const backAway = (): boolean => {
    const v = randBelow(m, 5);
    return walkFor(v + 0x14, v + 0x3c, crouched ? DOWN_BACK : BACK);
  };
  switch (kind) {
    case 1:
      if (dashes(DASH_IN) <= 0) return walkIn();
      rec.walkKind = 0;
      rec.walkLeft = 0;
      rec.calm = 0x28;
      return -1 < chooseCandidate(m);
    case 2:
      return walkIn();
    case 3:
      return backAway();
    case 4:
      if (dashes(DASH_IN) <= 0) {
        const v = randBelow(m, 0x14);
        return walkFor(v + 0x28, v + 0x50, forward);
      }
      rec.walkKind = 2;
      rec.walkLeft = 0xfa;
      rec.calm = 0x136;
      return -1 < chooseCandidate(m);
    case 5: {
      const v = randBelow(m, 0x14);
      return walkFor(v + 0x28, v + 0x50, forward);
    }
    case 6:
      if (dashes(DASH_BACK) <= 0) return backAway();
      rec.calm = 0x3c;
      return -1 < chooseCandidate(m);
    case 8:
      if (3 <= rec.farBand || 0xb <= rec.due) sidestep(m, -1);
      return -1 < chooseCandidate(m);
    default:
      return false;
  }
}

/* ---- The frame's end. ---- */

/** A count run down, unless it has run out (below 0). */
const countDown = (value: number): number => (-1 < value ? s16(value - 1) : value);

/**
 * The counters run down and the pad goes out (held, and pressed: held and not held last frame).
 * Here the record also learns: hurt by a move it has seen twice among the last eight that hurt it,
 * it re-tunes to the arcade's last stage for 600 frames; hit (outside the attract mode), its
 * chances to crouch and counter rise toward their caps.
 */
function settle(t: Turn): [number, number] {
  const { self, opponent, rec } = t;
  const flags = rec.ownFlags;
  rec.guarding = (flags & 0x205) === 1 ? 1 : 0;
  if (rec.performed !== null && rec.holdFrames < 0 && s8(moveOf(t, rec.performed).stepWindow.first) !== 0) rec.holdFrames = moveOf(t, rec.performed).stepWindow.first;
  rec.holdFrames = countDown(rec.holdFrames);
  rec.walkLeft = countDown(rec.walkLeft);
  rec.calm = countDown(rec.calm);
  rec.reversalWindow = countDown(rec.reversalWindow);
  rec.travelPlan = countDown(rec.travelPlan);
  rec.guardPlan = countDown(rec.guardPlan);
  rec.openerWait = countDown(rec.openerWait);
  rec.downedHold = countDown(rec.downedHold);
  rec.answerHold = countDown(rec.answerHold);
  if (rec.retune === 0) tune(t, -1, -1, -1);
  rec.retune = countDown(rec.retune);
  if (t.state.mode === Mode.TEKKEN_FORCE) {
    const computer = t.state.computer;
    if (0 <= computer.forceWait[rec.index]!) computer.forceWait[rec.index] = computer.forceWait[rec.index]! - 1;
    if (0 <= computer.forceHold[rec.index]!) computer.forceHold[rec.index] = computer.forceHold[rec.index]! - 1;
  }
  const guardMoveHeld = (flags & 0xffff) === STANDING_GUARD || (flags & 0xffff) === CROUCHING_GUARD;
  rec.inGuard = guardMoveHeld ? 1 : 0;
  if (s8(self.hitReacting) !== 0) {
    calm(rec);
    rec.followUpsWanted = 0;
    rec.specialsWanted = 0;
    rec.stringWanted = 0;
  }
  if (s8(self.whiffed) !== 0 && rec.farBand < 3) rec.reversalWindow = 0x1e;
  if (s8(opponent.whiffed) !== 0 && rec.nearBand < 2 && mix12(t) < rec.tuning[Tune.COUNTER]!) rec.wait = s16(rec.wait - 3);
  if (self.health < rec.lastHealth && rec.tuning[Tune.PATIENCE]! <= mix12(t)) {
    rec.wait = s16(rec.wait - 3);
    if (t.state.computer.halfRate === 0) {
      rec.seenTwice = 0;
      let seen = 0;
      for (let i = 0; i < 8; i += 1) if (sameMove(rec.hurtBy[i]!, opponent.move)) seen += 1;
      if (1 < seen) {
        if (rec.retune < 1) tune(t, 0, 9, -1);
        rec.retune = 600;
        rec.seenTwice = 1;
      }
      rec.hurtBy[rec.hurtIndex & 0xffff] = opponent.move;
      rec.hurtIndex = (rec.hurtIndex + 1) & 7;
    }
  }
  rec.lastHealth = self.health;
  if (s8(self.hitReacting) !== 0 && t.state.attract === 0) {
    calm(rec);
    const raise = (at: number, by: number, cap: number): void => {
      rec.tuning[at] = s16(rec.tuning[at]! + by);
      if (rec.tuning[cap]! < rec.tuning[at]!) rec.tuning[at] = rec.tuning[cap]!;
    };
    raise(Tune.CROUCH, 10, Tune.CROUCH_CAP);
    raise(Tune.COUNTER, 10, Tune.COUNTER_CAP);
    if (0 < rec.theirAttacks) {
      raise(Tune.CROUCH_BACK, 0x28, Tune.CROUCH_BACK_CAP);
      raise(Tune.ANSWER, 0x14, Tune.ANSWER_CAP);
    }
  }
  const held = rec.pad & 0xffff;
  const pressed = held & (held ^ (rec.lastPad & 0xffff));
  rec.lastPad = held;
  return [held, pressed];
}

/* ---- Candidates. ---- */

/**
 * The moves the fighter could cancel into now, from its move's list (entries open now, conditions
 * and tests holding), at most 0xb4, each free. With `mode` 0 the list's end entry names the move
 * that follows on its own; while that entry's window is open, that move's entries opening at frame
 * 0 or 1 are added too (their tests `& 0 '` waived). Then moves flagged 0x800000 are set aside, and
 * lows too when an answer asked for it.
 *
 * The original also sets aside a move equal to a stack word it never writes; on the computer's own
 * call paths that word holds a return address, so it matches no move and is left out here.
 */
function gather(t: Turn, mode: number): number {
  const { self, rec } = t;
  let count = 0;
  const add = (ref: CancelRef): boolean => {
    if (CANDIDATES - 1 < count) return false;
    const candidate = candidateAt(t, count);
    candidate.move = moveById(t, entryAt(t, ref).target);
    candidate.entry = ref;
    candidate.taken = 0;
    count += 1;
    return true;
  };
  let at = movesList(t, rec.move);
  let full = false;
  for (; entryAt(t, at).command !== END && !full; at = nextOf(at)) {
    for (const ref of expand(t, at)) {
      if (!followUpOpen(t, entryAt(t, ref))) continue;
      if (!add(ref)) {
        full = true;
        break;
      }
    }
    if (full) break;
  }
  if (mode !== 0) return count;
  const frame = self.frame;
  const end = entryAt(t, at);
  const next = moveById(t, end.target);
  if (end.from <= frame && frame <= end.to && !sameMove(next, self.move)) {
    const bits = rec.around;
    outer: for (let list = movesList(t, next); entryAt(t, list).command !== END; list = nextOf(list)) {
      for (const ref of expand(t, list)) {
        const item = entryAt(t, ref);
        if (1 < item.from || item.to < frame || !conditionHolds(t, item)) continue;
        const test = item.test;
        let open = true;
        if (test === 0x24) open = (bits & 1) !== 0;
        else if (test === 0x25) open = (bits & 2) !== 0;
        else if (test !== 0 && test !== 0x26 && test !== 0x30 && test !== 0x27) open = cancelTest(t.state, t.data, item, self, t.opponent);
        if (open && !add(ref)) break outer;
      }
    }
  }
  for (let i = 0; i < count; i += 1) {
    const candidate = candidateAt(t, i);
    if ((moveOf(t, candidate.move).flags & 0x800000) !== 0) candidate.taken = -1;
  }
  if (rec.dropLows !== 0) {
    rec.candidateCount = count;
    dropLows(t);
  }
  return count;
}

/** The lows (and kind `LOW`) among the candidates set aside, for an answer that asked for it. */
function dropLows(t: Turn): number {
  const rec = t.rec;
  let dropped = 0;
  for (let i = 0; i < rec.candidateCount; i += 1) {
    const candidate = candidateAt(t, i);
    if (candidate.taken < 0) continue;
    const kind = kindOf(moveOf(t, candidate.move));
    if ((kind & 0x10000) === 0 && (kind & 0xffff) !== LOW) continue;
    if (0 < candidate.taken) dropped += 1;
    candidate.taken = -1;
  }
  rec.takenCount = s16(rec.takenCount - dropped);
  return dropped;
}

/**
 * One of the taken candidates played and noted, its index returned (-1 when none). On odd steps it
 * counts from the first, where the first two draws both land on the first taken; on even steps
 * from the last. When the count runs past the taken ones, the last (odd) or first (even) candidate
 * is played whatever its flag.
 */
function chooseCandidate(t: Turn): number {
  const rec = t.rec;
  const count = rec.takenCount;
  if (count <= 0) return -1;
  let pick = Math.imul(count, mixedRand(t)) >> 15;
  const n = rec.candidateCount;
  let chosen: number;
  if ((rec.steps & 1) !== 0) {
    chosen = n - 1;
    for (let i = 0; i < n; i += 1) {
      if (candidateAt(t, i).taken <= 0) continue;
      pick -= 1;
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
  } else {
    chosen = 0;
    for (let i = n - 1; 0 <= i; i -= 1) {
      if (candidateAt(t, i).taken <= 0) continue;
      pick -= 1;
      if (pick < 0) {
        chosen = i;
        break;
      }
    }
  }
  if (chosen < 0) return -1;
  const candidate = candidateAt(t, chosen);
  perform(t, entryAt(t, candidate.entry!).command, candidate.move);
  noteChosen(t, entryAt(t, candidate.entry!));
  return chosen;
}

/** A cancel just played, noted: throws counted; an attack sets a new wait (the tuning's base plus one of four extras) and drops the plans. */
function noteChosen(t: Turn, entry: Cancel): void {
  const rec = t.rec;
  const move = moveOf(t, moveById(t, entry.target));
  if ((kindOf(move) & 0x400000) !== 0) rec.throwFollowUps = s16(rec.throwFollowUps + 1);
  if (s8(move.activeWindow.first) === 0) return;
  rec.wait = s16(rec.tuning[Tune.WAIT]! + rec.tuning[Tune.WAIT_EXTRAS + mixBits(t, 3)]!);
  /* Tekken Force: an enemy's attack makes the other wait before attacking, and hold still unless it already is. */
  if (t.state.mode === Mode.TEKKEN_FORCE) {
    const other = 2 - t.self.slot;
    const computer = t.state.computer;
    computer.forceWait[other] = rec.pacing![0];
    if (computer.forceHold[other]! < 0) computer.forceHold[other] = rec.pacing![1];
  }
  rec.guardPlan = -1;
  if (0 < rec.travelPlan) rec.travelPlan = -1;
  calm(rec);
}

/**
 * Whether the fighter can cancel into move `id` now: an open entry for it in its move's list or,
 * failing that, among the follow-on move's entries opening at frame 1 (the follow-on read from
 * where the scan ended, as in the original).
 */
function canPlay(t: Turn, id: number): boolean {
  const self = t.self;
  let found = false;
  let tail = movesList(t, self.move);
  for (let at = tail; entryAt(t, at).command !== END; at = nextOf(at)) {
    tail = entryAt(t, at).command === CALL ? { shared: true, set: -1, index: entryAt(t, at).target } : at;
    for (const ref of expand(t, at)) {
      const item = entryAt(t, ref);
      if (item.target === id && followUpOpen(t, item)) {
        found = true;
        break;
      }
      tail = nextOf(ref);
    }
  }
  if (found) return true;
  const frame = self.frame;
  const end = entryAt(t, tail);
  const next = moveById(t, end.target);
  if (sameMove(next, self.move) || frame < end.from || end.to < frame) return false;
  for (let at = movesList(t, next); entryAt(t, at).command !== END; at = nextOf(at)) {
    for (const ref of expand(t, at)) {
      const item = entryAt(t, ref);
      if (item.target !== id || item.from !== 1) continue;
      if (followUpOpen(t, item)) {
        found = true;
        break;
      }
    }
  }
  return found;
}

/** Whether a throw (a target whose kind is flagged 0x400000) is among the fighter's open cancels. */
function throwOpen(t: Turn): boolean {
  let found = false;
  for (let at = movesList(t, t.self.move); entryAt(t, at).command !== END; at = nextOf(at)) {
    for (const ref of expand(t, at)) {
      const item = entryAt(t, ref);
      if (followUpOpen(t, item) && (kindOf(moveOf(t, moveById(t, item.target))) & 0x400000) !== 0) {
        found = true;
        break;
      }
    }
  }
  return found;
}

/* ---- The kinds of candidates taken. ---- */

/** An attack the near band allows, or one flagged 0x10000. */
const inReach = (t: Turn, move: Move): boolean => bandAllows(t, kindOf(move), t.rec.nearBand) || (move.flags & 0x10000) !== 0;

/** A move with no step window, or one that travels or is flagged 0x200000 in its kind. */
const free = (move: Move): boolean => s8(move.stepWindow.first) === 0 || (move.flags & 0x80000) !== 0 || (kindOf(move) & 0x200000) !== 0;

/** An attack that is not a throw nor flagged 0x20000. */
const strike = (move: Move): boolean => s8(move.activeWindow.first) !== 0 && (kindOf(move) & 0x400000) === 0 && (move.flags & 0x20000) === 0;

/** Dashes in, travelling moves, and attacks in reach. */
function markApproaches(t: Turn): number {
  return markCandidates(t, (move, entry) => free(move) && (entry.command === DASH_IN || (move.flags & 0x80000) !== 0 || (strike(move) && inReach(t, move))));
}

/** Attacks in reach other than kinds `HIGH` and `THROW_KIND_TOO` (both of which the guards stop). */
function markAttacksOnGuard(t: Turn): number {
  return markCandidates(t, (move) => {
    const kind = kindOf(move) & 0xffff;
    return free(move) && kind !== HIGH && kind !== THROW_KIND_TOO && strike(move) && inReach(t, move);
  });
}

/** Attacks in reach with damage, no step window, active before frame 14. */
function markQuickAttacks(t: Turn): number {
  return markCandidates(t, (move) => 0 < damageWord(move) && s8(move.stepWindow.first) === 0 && move.activeWindow.first < 0xe && strike(move) && inReach(t, move));
}

/** Attacks of the near band's kinds, less the kinds the opponent's move stops. */
function markReachingAttacks(t: Turn): number {
  return markCandidates(t, (move) => {
    if (!strike(move) || s8(move.stepWindow.first) !== 0 || damageWord(move) < 0 || !bandAllows(t, kindOf(move), t.rec.nearBand)) return false;
    const theirs = t.rec.theirFlags;
    const kind = kindOf(move) & 0xffff;
    if ((theirs & 2) !== 0) return kind !== HIGH;
    if ((theirs & 1) !== 0) return kind !== HIGH && kind !== LOW;
    if ((theirs & 4) !== 0) return kind !== HIGH && kind !== MID;
    return true;
  });
}

/** Whether an attack's kind answers the opponent's move. */
function beatsTheirState(t: Turn, kind: number): boolean {
  const theirs = t.rec.theirFlags;
  if ((theirs & 0xffff) === GETTING_UP) return true;
  if ((theirs & 0x400) !== 0) return kind === HIGH || kind === MID || kind === SPECIAL_MID;
  if ((theirs & 4) !== 0) return kind === LOW || kind === SPECIAL_LOW;
  if ((theirs & 1) !== 0) return kind === MID || kind === LOW;
  if ((theirs & 2) !== 0) return kind === LOW || kind === MID || kind === HIGH;
  return false;
}

/** Attacks in reach of the kinds that answer the opponent's move. */
function markBeatingKinds(t: Turn): number {
  return markCandidates(t, (move) => strike(move) && s8(move.stepWindow.first) === 0 && bandAllows(t, kindOf(move), t.rec.nearBand) && beatsTheirState(t, kindOf(move) & 0xffff));
}

/** As `markBeatingKinds`, kind `HIGH` left out. */
function markBeatingKindsSave412(t: Turn): number {
  return markCandidates(t, (move) => {
    const kind = kindOf(move) & 0xffff;
    return kind !== HIGH && strike(move) && s8(move.stepWindow.first) === 0 && bandAllows(t, kindOf(move), t.rec.nearBand) && beatsTheirState(t, kind);
  });
}

/** Attacks in reach whose command has no direction. */
function markButtonAttacks(t: Turn): number {
  return markCandidates(t, (move, entry) => (entry.command & 0x3fe0) === 0 && strike(move) && -1 < damageWord(move) && s8(move.stepWindow.first) === 0 && bandAllows(t, kindOf(move), t.rec.nearBand));
}

/** Attacks with damage in reach that land before the opponent's. */
function markFasterAttacks(t: Turn): number {
  return markCandidates(t, (move) => strike(move) && 0 < damageWord(move) && (s8(move.stepWindow.first) === 0 || (move.flags & 0x80000) !== 0) && move.activeWindow.first < t.rec.due && bandAllows(t, kindOf(move), t.rec.nearBand));
}

/** Attacks with damage in reach that land first, kind `HIGH` left out. */
function markFasterAttacksSave412(t: Turn): number {
  return markCandidates(t, (move) => strike(move) && 0 < damageWord(move) && move.activeWindow.first < t.rec.due && (kindOf(move) & 0xffff) !== HIGH && bandAllows(t, kindOf(move), t.rec.nearBand));
}

/**
 * Defences against what is coming, near enough to matter: against a special attack, guard moves
 * (not for a mid) and, far, back dashes; against an attack, the guard moves of the kinds that stop
 * it, and back dashes when far. Closing in fast at a close band, back dashes only.
 */
function markDefences(t: Turn): number {
  const rec = t.rec;
  if (0xb86 < rec.distance) return 0;
  const backDashes = (): number => markCandidates(t, (_, entry) => entry.command === DASH_BACK);
  const guardOf =
    (...guards: number[]) =>
    (move: Move, entry: Cancel): boolean =>
      entry.command !== DASH_BACK && guards.includes(move.flags & 0xffff);
  let taken = 0;
  if (rec.special !== 0) {
    if (rec.theirKindLow !== MID) taken = markCandidates(t, guardMove);
    return rec.farBand < 3 ? taken : taken + backDashes();
  }
  if (rec.coming !== 0) {
    switch (rec.theirKindLow) {
      case SPECIAL_MID:
        taken = markCandidates(t, (move, entry) => (move.flags & 0x100) === 0 && guardOf(STANDING_GUARD, CROUCHING_GUARD)(move, entry));
        break;
      case MID:
        taken = markCandidates(t, guardOf(STANDING_GUARD));
        break;
      case LOW:
        taken = markCandidates(t, (move) => s16(move.flags & 0xffff) === CROUCHING_GUARD);
        if (2 < rec.farBand) taken += backDashes();
        break;
      case HIGH:
        if (s16(t.self.stance & 0xffff) === GUARD_BACK || s16(t.self.stance & 0xffff) === CROUCHING_GUARD) taken = markCandidates(t, guardMove);
        else {
          taken = markCandidates(t, guardOf(STANDING_GUARD));
          if (mixBits(t, 0xfff) % 50 === 0) taken += markCandidates(t, guardMove);
          if (2 < rec.farBand) taken += backDashes();
        }
        break;
      case THROW_KIND_TOO:
        taken = markCandidates(t, guardMove);
        if (2 < rec.farBand) taken += backDashes();
        break;
    }
  }
  if (rec.closing < -0x46 && rec.farBand < 3) taken = backDashes();
  return taken;
}

/** Against an attack coming: sometimes a dash in at the middle bands, and the attacks that land first (kind `HIGH` left out against a guard). */
function markAgainstAttack(t: Turn): number {
  const roll = (t.state.random.mix >> 1) & 0xfff;
  stepMix(t);
  const band = t.rec.nearBand;
  let taken = 0;
  if ((band === 2 && roll < 0x20) || (band === 3 && roll < 0x400)) taken = markCandidates(t, (_, entry) => entry.command === DASH_IN);
  return taken + ((t.rec.theirFlags & 1) === 0 ? markFasterAttacks(t) : markFasterAttacksSave412(t));
}

/** The plans dropped, and forward on even steps. */
function stepIn(t: Turn): number {
  calm(t.rec);
  return (t.rec.steps & 1) === 0 ? FORWARD : 0;
}

/* ---- Characters' own answers. ---- */

/**
 * A character's own answer, by the tuning's chance, when no downed hold is running: the one for
 * the opponent's character (`against`) or the fighter's own (`own`). An answer is a pad word, or -1
 * nothing, -2 settled (a script started), -3 choose among what it took. True when settled.
 */
function answers(m: Moment, which: 'against' | 'own'): boolean {
  const rec = m.rec;
  if (0 <= rec.downedHold) return false;
  if (rec.tuning[Tune.CHARACTER]! <= mix12(m)) return false;
  const routine = which === 'against' ? rec.againstAnswer : rec.ownAnswer;
  if (routine === 'none') return false;
  const answer = characterAnswer(m, routine);
  if (answer === -2) return true;
  if (answer === -3) return 0 < rec.takenCount && -1 < chooseCandidate(m);
  if (answer === -1) return false;
  if (answer === FORWARD || answer === BACK) {
    rec.walkLeft = 0x10;
    rec.walkKind = 0;
    rec.calm = 0x38;
  }
  rec.pad = answer;
  return true;
}

function characterAnswer(m: Moment, routine: Exclude<ComputerRecord['againstAnswer'], 'none'>): number {
  switch (routine) {
    case 'against 0':
      return answerMoveset0(m);
    case 'against 4':
      return answerMoveset4(m);
    case 'against 14':
      return answerMovesetE(m);
    case 'against 19':
      return answerMoveset13(m);
    case 'own 3':
      return ownMoveset3(m);
    case 'own 6':
      return ownMoveset6(m);
  }
}

/** Against moveset 0: its move 0x2c7 close by is backed away from once past frame 15, waited out before. */
function answerMoveset0(m: Moment): number {
  const { opponent, rec } = m;
  if (s16(opponent.moveId) !== 0x2c7 || 3 <= rec.farBand) return -1;
  if (opponent.frame < 0x10) {
    rec.wait = -1;
    return -1;
  }
  return BACK;
}

/** Against moveset 0x13: its move 0x137 is pressed close (the wait dropped), walked back from far. */
function answerMoveset13(m: Moment): number {
  const { opponent, rec } = m;
  if (s16(opponent.moveId) !== 0x137) return -1;
  if (rec.farBand < 2) {
    rec.wait = -1;
    return -2;
  }
  return rec.farBand < 4 ? -1 : BACK;
}

/** Own moveset 6: in its move 0xde3, forward most of the time (not in frames 13 to 17 with an attack due soon). */
function ownMoveset6(m: Moment): number {
  const { self, rec } = m;
  if (s16(self.moveId) !== 0xde3) return -1;
  if (((self.frame & 0xffff) - 0xd) >>> 0 < 5 && rec.due < 10) return -1;
  return (rand(m) & 0xf) !== 0 ? FORWARD : -1;
}

/**
 * The sidestep `sidestep` would choose (away from the opponent's side), played, its direction
 * returned; -1 and nothing played when square on, mid-sidestep, or far (7001 and on).
 */
function sidestepAway(m: Moment): number {
  const { self, opponent, rec } = m;
  const across = opponent.screenX < self.screenX;
  if ((moveOf(m, self.move).flags & 0x400000) !== 0 || 7001 <= rec.distance >>> 0) return -1;
  const turned = self.theirOff & 0xffff;
  let which = 0;
  if (0x7efe < (turned - 0x101) >>> 0) {
    which = 1;
    if (0x7efd < ((turned + 0x7fff) & 0xffff)) return -1;
  }
  if (across) which = 1 - which;
  sidestep(m, which);
  return which;
}

/** Lows set aside at the next gathering. */
const setLowsAside = (rec: ComputerRecord): void => {
  rec.dropLows = 1;
};

/** Against moveset 4: its moves 0x16f, 0x456, 0x459 to 0x45b, 0x16a, 0x43a and 0x458, 0x49c to 0x49e each answered by distance. */
function answerMoveset4(m: Moment): number {
  const { self, opponent, rec } = m;
  const id = s16(opponent.moveId);
  const frame = opponent.frame;
  const turned = s16(self.theirOffSize);
  const near = rec.nearBand;
  const far = rec.farBand;
  if (id === 0x16f) {
    if (far < 3) rec.wait = -1;
    return -1;
  }
  if (id === 0x456) {
    if (3 <= far) return FORWARD;
    rec.answerHold = 4;
    setLowsAside(rec);
    rec.wait = -1;
    return -1;
  }
  if (((opponent.moveId & 0xffff) - 0x459) >>> 0 < 3) {
    if (near <= 0) {
      const theirMove = moveOf(m, opponent.move);
      if (theirMove.activeWindow.first <= frame && frame <= theirMove.activeWindow.last) return 0;
      setLowsAside(rec);
      rec.wait = -1;
      rec.answerHold = 4;
      return -2;
    }
    if (((opponent.facingOffSize & 0xffff) - 0x2000) >>> 0 < 0x4001) {
      rec.answerHold = 0x14;
      if (near < 2) {
        setLowsAside(rec);
        rec.wait = -1;
        return -1;
      }
      return FORWARD;
    }
    if (3 <= near) {
      rec.answerHold = 10;
      return FORWARD;
    }
    if ((rand(m) & 7) !== 0 || (rec.ownFlags & 0x400001) !== 0) return 0;
    sidestep(m, -1);
    return -2;
  }
  if (id === 0x472) return -1;
  if (id === 0x16a || id === 0x43a) {
    const theirMove = moveOf(m, opponent.move);
    if (theirMove.activeWindow.first !== 0 && theirMove.activeWindow.last < frame) {
      rec.wait = -1;
      return 0;
    }
    if (0x1000 < turned) return 2 <= far ? FORWARD : -1;
    if (3 <= far && rec.distance >>> 0 < 0xa8d) {
      startScript(m, m.data.computer.backAway);
      return -2;
    }
    if (far < 2 && 0xb <= rec.due) return -1;
    if (3 <= far || rec.due < 0xb) return 0;
    sidestep(m, rand(m) & 1);
    return -2;
  }
  if (id === 0x458 || id === 0x49c || id === 0x49d || id === 0x49e) {
    if (0x4000 <= turned) {
      if (near < 2) rec.wait = -1;
      return -1;
    }
    if (near < 2) {
      rec.wait = 1;
      return 0;
    }
    if (3 <= near) return FORWARD;
    setLowsAside(rec);
    rec.wait = -1;
    return -1;
  }
  return -1;
}

/** Against moveset 0xe: its moves 0xde4 and 0x16e answered by their timing and the distance. */
function answerMovesetE(m: Moment): number {
  const { self, opponent, rec } = m;
  const theirMove = moveOf(m, opponent.move);
  const id = s16(opponent.moveId);
  const frame = opponent.frame;
  const near = (): number => rec.nearBand;
  const sometimes = (): number => ((rand(m) & 7) === 0 ? FORWARD : 0);
  const pressOn = (): number => {
    rec.wait = -1;
    return FORWARD;
  };
  const stepAside = (): number => {
    const which = sidestepAway(m);
    if (which === -1) return FORWARD;
    sidestep(m, which);
    return -2;
  };
  if (id === 0xde4) {
    rec.answerHold = 8;
    if ((frame - 9) >>> 0 < 5 && near() < 2 && (rand(m) & 0x1f) === 0) {
      setLowsAside(rec);
      return pressOn();
    }
    const start = theirMove.activeWindow.first;
    if (frame < start - 0x1e) {
      if (near() < 2) return pressOn();
      if (near() < 3) {
        rec.wait = s16(rec.wait - 4);
        return FORWARD;
      }
      return stepAside();
    }
    if (frame < start - 0x14) {
      if (s16(self.facingOffSize) < 0x3800) {
        const band = near();
        if (band < 3) return 0;
        return band < 4 ? FORWARD : sometimes();
      }
      if (near() < 3) return FORWARD;
      const which = sidestepAway(m);
      if (2 <= which >>> 0) return FORWARD;
      sidestep(m, which);
      return -2;
    }
    const end = theirMove.activeWindow.last;
    if (frame < end) {
      const angle = s16(self.facingOffSize);
      if (0x6000 <= angle) {
        rec.wait = 8;
        return BACK;
      }
      if (0x3800 <= angle) {
        if (2 <= near()) return FORWARD;
        rec.wait = 8;
        return 0;
      }
      const which = sidestepAway(m);
      if (which !== -1) {
        sidestep(m, which);
        return -2;
      }
      return self.facingQuadrant === 0 ? FORWARD : 0;
    }
    if (frame < end + 0x28) return 2 <= near() ? sometimes() : pressOn();
    return 3 <= near() ? sometimes() : pressOn();
  }
  if (id !== 0x16e) return -1;
  rec.answerHold = 8;
  if (frame < theirMove.activeWindow.first - 8) {
    let which = -1;
    if (((self.facingOff + 0x2000) & 0xffff) < 0x4001 && (moveOf(m, self.move).flags & 0x400000) === 0 && rec.distance >>> 0 < 0x1b59) {
      which = self.screenX < opponent.screenX ? 1 : 0;
    }
    const band = near();
    if (band <= 0) return pressOn();
    if (band < 3) return FORWARD;
    if ((rand(m) & 7) !== 0 || self.facingQuadrant !== 0 || 2 <= which >>> 0) return sometimes();
    sidestep(m, which);
    return -2;
  }
  if (theirMove.activeWindow.last <= frame) return -1;
  if (self.facingQuadrant === 0) return rec.distance >>> 0 < 0x1b59 ? DOWN_FORWARD : 0;
  const band = near();
  if (band < 2) return m.data.computer.dodgePads[rand(m) & 3]!;
  return band < 3 ? DOWN_FORWARD : sometimes();
}

/**
 * Own moveset 3, by the tuning's follow-up chance and no wait running: one of three scripts when
 * the opponent guards close by and its move 0x15 can be played; else, when a throw is open, one of
 * two scripts against a guard close by, or of two against a low attack.
 */
function ownMoveset3(m: Moment): number {
  const { self, opponent, rec } = m;
  const roll = mix12(m);
  const scripts = m.data.computer.kingScripts;
  if (0 < rec.wait || rec.tuning[Tune.FOLLOW_UP]! <= roll) return -1;
  const ready = (): boolean => moveOf(m, self.move).activeWindow.first === 0 && 9 <= rec.due && self.facingQuadrant === 0;
  if (
    opponent.character !== 0x13 && (rec.theirFlags & 2) !== 0 && rec.nearBand < 3 && opponent.inAir === 0 && opponent.counterWindow === 0 &&
    ready() && self.theirQuadrant === 0 && (rand(m) & 7) === 0 && canPlay(m, 0x15)
  ) {
    startScript(m, scripts[4 + ((rand(m) & 0xfff) % 3)]!);
    rec.followUpsWanted = 1;
    return -2;
  }
  if ((rec.theirFlags & 1) !== 0 && rec.nearBand < 2 && opponent.counterWindow === 0 && ready() && self.theirQuadrant === 0 && throwOpen(m)) {
    startScript(m, scripts[2 + (rand(m) & 1)]!);
    return -2;
  }
  if (rec.lowComing === 0 || 2 <= rec.nearBand) return -1;
  if ((self.theirQuadrant !== 0 && self.theirQuadrant !== 2) || self.facingQuadrant !== 0 || opponent.counterWindow !== 0) return -1;
  if (moveOf(m, self.move).activeWindow.first !== 0 || rec.due < 9 || rec.rolling !== 0 || !throwOpen(m)) return -1;
  startScript(m, scripts[rand(m) & 1]!);
  return -2;
}

/* ---- Each round's start. ---- */

/**
 * The record's tuning: `level` (else the difficulty, at most 2) and `stage` (else the arcade's, at
 * most 9; the attract mode plays stage 4) pick its tuning; each fighter's character its rows.
 * `mode` is kept (0 holds nothing, 1 holds up while the move asks).
 */
function tune(t: Turn, level: number, stage: number, mode: number): void {
  const rec = t.rec;
  if (level < 1) level = t.state.computer.difficulty;
  if (stage < 1) stage = t.state.computer.arcadeStage;
  rec.mode = s16(mode);
  if (t.state.attract !== 0) stage = 4;
  if (2 < level >>> 0) level = 2;
  if (9 < stage >>> 0) stage = 9;
  const tuning = t.data.computer.tuning[level]![stage]!;
  for (let i = 0; i < tuning.length; i += 1) rec.tuning[i] = tuning[i]!;
  const row = (f: Fighter): readonly number[] => t.data.computer.characters[t.data.roster.rowOf(f.roster)]!;
  row(t.self).forEach((v, i) => (rec.ownCharacter[i] = v));
  row(t.opponent).forEach((v, i) => (rec.theirCharacter[i] = v));
  rec.attackLimit = Math.max(rec.tuning[Tune.ATTACK_LIMIT_TOO]!, rec.tuning[Tune.ATTACK_LIMIT]!);
  /* Tekken Force's pacing: the first stage's entry, or the later stages'. */
  if (t.state.mode === Mode.TEKKEN_FORCE) rec.pacing = t.data.computer.forcePacing[level & 3]![2 < stage ? 3 : stage]!;
}

/** A moveset's character answers: the one for playing against it, and its own. */
function answersOf(data: FightData, moveset: number): { against: ComputerRecord['againstAnswer']; own: ComputerRecord['ownAnswer'] } {
  const entry = data.computer.answers.find((a) => a.moveset === (moveset & 0xffff));
  return entry === undefined ? { against: 'none', own: 'none' } : { against: entry.against, own: entry.own };
}

/** Each fighter's computer record (-1 none) and the fighter it plays against: the pair's, or Tekken Force's two enemies against the player. */
const RECORDS: { readonly own: readonly number[]; readonly against: readonly number[] } = { own: [0, 1, -1], against: [1, 0, -1] };
const FORCE_RECORDS: typeof RECORDS = { own: [-1, 0, 1], against: [-1, 0, 0] };

/** The tuning the attract's demo halves (and the crouch, quartered): it plays a gentler computer. */
const ATTRACT_HALVED = [Tune.WAIT_EXTRAS, 4, 5, 6];

/** A record's state cleared for a round, its tuning chosen, its calm set going. */
function resetRecord(t: Turn, level = -1, stage = -1, mode = -1): void {
  const rec = t.rec;
  rec.lastFrame = -1;
  rec.guarding = 0;
  rec.guardLeft = -1;
  rec.guardHold = 0;
  rec.downedHold = -1;
  rec.holdFrames = -1;
  rec.walkLeft = -1;
  rec.walkKind = 0;
  rec.reversalWindow = -1;
  rec.inGuard = 0;
  rec.travelPlan = -1;
  rec.guardPlan = -1;
  rec.lastMoveFrame = -1;
  rec.moveFrames = 0;
  rec.farFrames = 0;
  rec.openerWait = -1;
  rec.answerHold = -1;
  rec.retune = -1;
  rec.attackCountdown = -1;
  rec.guardStops = 0;
  rec.takenCount = 0;
  rec.candidateCount = 0;
  rec.specialsWanted = 0;
  rec.specialCount = 0;
  rec.specialsDropped = 0;
  rec.followUpsWanted = 0;
  rec.followUpCount = 0;
  rec.stringSkip = 0;
  rec.stringWanted = 0;
  rec.stringCount = 0;
  rec.attacks = 0;
  rec.throwFollowUps = 0;
  rec.throwFollowUpFrame = -1;
  rec.escapeWait = 0;
  rec.theirAttacks = -1;
  rec.hurtIndex = 0;
  rec.move = null;
  rec.throwMove = null;
  rec.throwFollowUp = null;
  rec.script = null;
  rec.lastHealth = t.self.health;
  rec.hurtBy.fill(null);
  rec.urge = 0;
  rec.urgeNext = 0;
  rec.press = 0;
  rec.pressNext = 0;
  rec.crouch = 0;
  rec.retreat = 0;
  tune(t, level, stage, mode);
  rec.againstAnswer = answersOf(t.data, t.opponent.character).against;
  rec.ownAnswer = answersOf(t.data, t.self.character).own;
  if (t.state.attract !== 0) {
    for (const i of ATTRACT_HALVED) rec.tuning[i] = div(rec.tuning[i]!, 2);
    rec.tuning[Tune.CROUCH] = div(rec.tuning[Tune.CROUCH]!, 4);
  }
  rec.wait = rec.tuning[Tune.WAIT_EXTRAS]! & 0xffff;
  rec.calm = (((mixedRand(t) * 0x1e) >> 15) + 0x1e) & 0xffff;
  for (const candidate of t.state.computer.candidates) candidate.taken = -1;
}

/**
 * Each round: a record for each fighter (each the other's opponent), its pads cleared and the
 * record reset; in Tekken Force a record for each enemy, both against the player. Tekken Force's
 * waits and holds none.
 */
export function resetComputers(state: FightState, data: FightData): void {
  state.computer.halfRate = state.attract !== 0 || state.mode === Mode.TEKKEN_FORCE ? 1 : 0;
  state.computer.forceWait.fill(-1);
  state.computer.forceHold.fill(-1);
  const force = state.mode === Mode.TEKKEN_FORCE;
  const own = force ? FORCE_RECORDS.own : RECORDS.own;
  const against = force ? FORCE_RECORDS.against : RECORDS.against;
  for (let i = 0; i < 3; i += 1) {
    const self = state.fighters[i]!;
    const index = own[i]!;
    self.computerRecord = index < 0 ? 0xff : index;
    if (index < 0) continue;
    const opponent = state.fighters[against[i]!]!;
    const rec = state.computer.records[index]!;
    rec.steps = index;
    rec.index = index;
    rec.opponent = against[i]!;
    rec.lastPad = 0;
    rec.pad = 0;
    state.computer.lastSelf = self.slot;
    state.computer.lastOpponent = opponent.slot;
    resetRecord({ state, data, self, opponent, rec, court: null });
  }
}

/**
 * A computer record reset at a difficulty and stage (practice's): its state cleared, its tuning
 * chosen by them, played as the pair the computer last played (whose health and characters it
 * reads).
 */
export function resetComputerRecord(state: FightState, data: FightData, rec: ComputerRecord, level: number, stage: number, mode: number): void {
  const self = state.fighters[state.computer.lastSelf]!;
  const opponent = state.fighters[state.computer.lastOpponent]!;
  resetRecord({ state, data, self, opponent, rec, court: null }, level, stage, mode);
}
