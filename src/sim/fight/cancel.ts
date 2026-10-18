/**
 * Choosing the next move: a move's cancel list walked against this frame's input and both fighters'
 * state, each entry's conditions, and what is done with the match: the cancel taken now, buffered
 * into the follow-up, or the follow-up when the move ends; a reaction to the opponent's move
 * (reversals, parries, throw escapes); a hit reaction.
 *
 * A cancel list is entries in a row ended by one whose command is `END`, which names the move that
 * follows when nothing cancels. `CALL` jumps into a shared list, `RETURN` comes back from it.
 */
import type { Cancel } from '../data/moveset.ts';
import { Reaction, reactionField } from '../data/reactions.ts';
import { s16, s8 } from '../math/integers.ts';
import { targetOf } from './body.ts';
import { commandMatches } from './input.ts';
import { face, knockOut, transitionType } from './move.ts';
import { hitOf, moveAt, moveById, motionOf } from './moves.ts';
import { Mode, type FightData, type FightState, type Fighter, type MoveRef } from './state.ts';

const END = 0xc000;
const CALL = 0xc00c;
const RETURN = 0xc00d;
/** The extra tests from this one on answer the opponent's move (reactions), not input. */
const REACTION_TESTS = 0x45;
/** Moves whose follower marks a fall, by their follower's id. */
const FALLS = [3, 0x28];

/** Where a cancel walk is: a list in a moveset slot, or the shared lists, and the entry. */
interface Cursor {
  readonly shared: boolean;
  readonly set: number;
  readonly index: number;
}

const entryAt = (data: FightData, at: Cursor): Cancel => (at.shared ? data.cancels.shared[at.index]! : data.sets[at.set]!.moveset.cancels[at.index]!);
const nextEntry = (at: Cursor): Cursor => ({ ...at, index: at.index + 1 });
const listOf = (data: FightData, ref: MoveRef): Cursor => ({ shared: false, set: ref.set, index: moveAt(data, ref).cancels });

/**
 * The entry's condition: a moveset id the fighter is (1 to 0x17) or is not (0x18 to 0x2e), one the
 * opponent is (0x2f to 0x45), a roster id the fighter is (0x46 to 0x5c) or is not (0x5d on).
 */
function conditionHolds(entry: Cancel, f: Fighter, opponent: Fighter): boolean {
  const c = entry.condition;
  if (c === 0) return true;
  if (c >= 0x5d) return c - 0x5d !== f.roster;
  if (c >= 0x46) return c - 0x46 === f.roster;
  if (c >= 0x2f) return c - 0x2f === opponent.character;
  if (c >= 0x18) return c - 0x18 !== f.character;
  return c - 1 === f.character;
}

/** The first entry of a cancel list matching this frame, or the list's end. `frame` is the current move's frame. */
export function findCancel(state: FightState, data: FightData, list: Cursor, frame: number, f: Fighter, opponent: Fighter): Cursor {
  const direction = f.input.direction;
  const pressed = f.input.pressed;
  state.attackClasses[f.slot] = 0;
  let at = list;
  let saved = at;
  for (;;) {
    while (entryAt(data, at).command !== END) {
      const command = entryAt(data, at).command;
      if (command === RETURN) {
        at = nextEntry(saved);
        continue;
      }
      if (command === CALL) {
        saved = at;
        at = { shared: true, set: at.set, index: entryAt(data, at).target };
      }
      const entry = entryAt(data, at);
      if (
        commandMatches(data, f, entry.command, direction, pressed) &&
        entry.from <= frame &&
        frame <= entry.to &&
        conditionHolds(entry, f, opponent) &&
        entry.test < REACTION_TESTS &&
        (entry.test === 0 || cancelTest(state, data, entry, f, opponent))
      ) {
        break;
      }
      at = nextEntry(at);
    }
    /* Type 0x2c, matched, ends the walk at the list's end. */
    if (entryAt(data, at).type === 0x2c && entryAt(data, at).command !== END) {
      while (entryAt(data, at).command !== END) at = nextEntry(at);
    }
    const entry = entryAt(data, at);
    const keepWalking =
      (entry.type === 0x1c && entry.command !== END && f.hold !== 0) || (state.mode === Mode.TEKKEN_FORCE && entry.type === 0x21 && entry.command !== END && f.throwing === 0 && opponent.throwing !== 0);
    if (!keepWalking) return at;
    at = nextEntry(at);
  }
}

/** The extra tests (the stances') an open cancel needs no test for when practice looks; a cancel by the punch at frame 0 practice does not count. */
const STANCE_TESTS = { first: 0x3a, count: 3 } as const;
const PUNCH = { command: 0x10, type: 2 } as const;

/**
 * Whether any of a move's cancels is open at a frame, whatever the input (practice's HIT ANALYSIS):
 * an entry within its frames whose condition and extra test hold (a stance's test needing none
 * the first time); at the list's end, while the fighter's root still lags, the follower's own
 * cancels at its first frame, its stances' tests too.
 */
export function cancelOpen(state: FightState, data: FightData, f: Fighter, opponent: Fighter): boolean {
  if (f.move === null) return false;
  const open = (entry: Cancel, frame: number, testStances: boolean): boolean =>
    entry.from <= frame &&
    frame <= entry.to &&
    conditionHolds(entry, f, opponent) &&
    entry.test < REACTION_TESTS &&
    !(entry.command === PUNCH.command && entry.test === 0 && entry.type === PUNCH.type) &&
    (entry.test === 0 || (!testStances && ((entry.test - STANCE_TESTS.first) & 0xff) < STANCE_TESTS.count) || cancelTest(state, data, entry, f, opponent));
  /** The list's walk: the first open entry, or its end's entry (null when one was open). */
  const walk = (list: Cursor, frame: number, testStances: boolean): Cancel | null => {
    let at = list;
    let saved = at;
    for (;;) {
      let entry = entryAt(data, at);
      if (entry.command === END) return entry;
      if (entry.command === RETURN) {
        at = nextEntry(saved);
        continue;
      }
      if (entry.command === CALL) {
        saved = at;
        at = { shared: true, set: at.set, index: entry.target };
        entry = entryAt(data, at);
        if (entry.command === END) return entry;
      }
      if (open(entry, frame, testStances)) return null;
      at = nextEntry(at);
    }
  };
  const frame = f.frame;
  const end = walk(listOf(data, f.move), frame, false);
  if (end === null) return true;
  if (!(end.from - 5 <= frame && frame <= end.to && 0 < f.rootLag)) return false;
  const follower = moveById(data, f, end.target);
  return follower !== null && walk(listOf(data, follower), 1, true) === null;
}

/** The opponent's attack as the guard tests read it, worked out on first use in a frame. */
function attackClass(state: FightState, f: Fighter, opponent: Fighter): number {
  if (state.attackClasses[f.slot] === 0) classifyAttack(state, f, opponent);
  return state.attackClasses[f.slot]!;
}

/**
 * What the opponent's attack is to this fighter, facing it: by its level (the stance's bits 0x20,
 * 0x40, 0x80 and 0x200) and the side it faces from; or a turned fighter's two classes. -1 when
 * nothing applies.
 */
function classifyAttack(state: FightState, f: Fighter, opponent: Fighter): void {
  let kind = -1;
  if (f.struck !== 0 && opponent.inAir === 0 && opponent.counterWindow === 0) {
    const side = f.theirQuadrant;
    const bySide = (front: number, left: number, back: number, right: number): number => (side === 0 ? front : side === 1 ? left : side === 3 ? back : side === 2 ? right : -1);
    if (f.facingOffSize < 0x2aaa) {
      const level = opponent.stance >>> 0;
      if ((level & 0x80) === 0) {
        if ((level & 0x40) !== 0) kind = bySide(2, 4, 5, 3);
        else if ((level & 0x20) !== 0) kind = bySide(6, 8, 9, 7);
      } else if ((level & 0x200) === 0) kind = bySide(10, 0xc, 0xd, 0xb);
      else kind = bySide(0xe, 0x10, 0x11, 0xf);
    } else if (f.facingOffSize > 0x5555 && (opponent.stance & 2) !== 0) {
      if (side === 0) kind = 0x12;
      else if (side === 2) kind = 0x13;
    }
  }
  state.attackClasses[f.slot] = kind;
}

/**
 * The side of the opponent a fighter stands on as its player sees the fight: the other one where
 * that player sees it from the other side, so the moves the side picks between, one into the
 * screen and one out of it, go by that player's screen.
 */
const sideSeen = (state: FightState, f: Fighter): number => (f.side !== 0 ? 1 : 0) ^ ((state.match.depthTurned >> f.slot) & 1);

/** An entry's extra test, 1 to 0x44, with its parameter. */
export function cancelTest(state: FightState, data: FightData, entry: Cancel, f: Fighter, opponent: Fighter): boolean {
  const test = entry.test;
  const value = entry.param;
  const theirFlags = opponent.stance >>> 0;
  const near = (): boolean => f.targetDistance >>> 0 <= value;
  if (test >= 2 && test <= 0x13) {
    const kind = attackClass(state, f, opponent);
    return f.nearDistance >>> 0 <= value && test === kind;
  }
  if (test >= 0x14 && test <= 0x17) {
    const kind = attackClass(state, f, opponent);
    if (value < f.nearDistance >>> 0) return false;
    const base = test - 0x12;
    return kind === base || kind === base + 4;
  }
  switch (test) {
    case 1:
      return f.struck !== 0;
    case 0x18:
      return near();
    case 0x19:
      return !(f.targetDistance >>> 0 < value);
    case 0x1a:
      return f.struck !== 0 && (f.level & opponent.guard) === 0;
    case 0x1b:
      return opponent.guarded !== 0;
    case 0x1c:
      return f.whiffed !== 0;
    case 0x1d:
      return opponent.next.type !== 0x21;
    case 0x1e:
      return opponent.attackDamage !== 0;
    case 0x1f:
      return opponent.attackDamage !== 0 && (opponent.stance & 7) === 2;
    case 0x20:
      return opponent.attackDamage !== 0 && (opponent.stance & 7) === 1;
    case 0x21:
      return opponent.attackDamage === 0;
    case 0x22:
      return (theirFlags & 0x407) === 2;
    case 0x23:
      return (theirFlags & 0x407) === 1;
    case 0x24:
      return f.facingOffSize >= 0x4001;
    case 0x25:
      return (((f.facingOff & 0xffff) - 0x4e38) >>> 0) < 0x31c8;
    case 0x26:
      return (f.facingOff & 0xffff) > 0x7fff && (f.facingOff & 0xffff) <= 0xb1c6;
    case 0x27:
      return f.facingQuadrant === 0;
    case 0x28:
      return f.facingQuadrant === 1;
    case 0x29:
      return f.facingQuadrant === 3;
    case 0x2a:
      return f.facingQuadrant === 2;
    case 0x2b:
      return f.theirQuadrant === 0;
    case 0x2c:
      return f.theirQuadrant === 1;
    case 0x2d:
      return f.theirQuadrant === 3;
    case 0x2e:
      return f.theirQuadrant === 2;
    case 0x2f:
      return false;
    case 0x30:
      return s16(opponent.level) === 0x412 && opponent.frame <= moveAt(data, opponent.move!).activeWindow.last && f.targetDistance >>> 0 < 0x700;
    case 0x31:
      return f.mash === 0 && f.stunFrames === 0;
    case 0x32:
      return f.mash !== 0 || f.stunFrames !== 0;
    case 0x33:
      return f.pushed !== 0;
    case 0x34:
      return f.pushed !== 0 && opponent.inAir === 0 && (theirFlags & 4) === 0;
    case 0x35:
      return (theirFlags & 4) !== 0;
    case 0x36:
      return (theirFlags & 4) === 0;
    case 0x37:
      return (theirFlags & 4) !== 0 && s8(moveAt(data, opponent.move!).stepWindow.first) === 0 && near();
    case 0x38:
      return (theirFlags & 4) !== 0 && f.facingOffSize >= 0x4000;
    case 0x39:
      return opponent.counterHit !== 0 && opponent.inAir === 0;
    case 0x3a:
    case 0x3b:
    case 0x3c: {
      f.watchingPunchPairs = 1;
      const pairs = [f.punchPairs.left, f.punchPairs.right, f.punchPairs.both];
      return pairs[test - 0x3a] !== 0;
    }
    case 0x3d:
      return f.health === 0;
    case 0x3e:
      return sideSeen(state, f) === 0;
    case 0x3f:
      return sideSeen(state, f) !== 0;
    case 0x40:
      return sideSeen(state, f) === 0 && f.facingOffSize >= 0x4001;
    case 0x41:
      return sideSeen(state, f) !== 0 && f.facingOffSize >= 0x4001;
    case 0x42:
      return f.launched === 0 && f.health !== 0;
    case 0x43:
      return f.recovery !== 0;
    case 0x44:
      return f.recovery === 0;
    default:
      return false;
  }
}

/** Whether the opponent's move lists `value` among its four hit codes (0 always). */
function hitListHas(data: FightData, opponent: Fighter, value: number): boolean {
  if ((value & 0xffff) === 0) return true;
  const hit = hitOf(data, opponent.move!);
  const codes = hit === null ? [0, 0, 0, 0] : hit.codes;
  return codes.some((c) => c === (value & 0xffff));
}

/** Whether a motion's id is in kind `kind`'s list. */
function motionIsKind(data: FightData, id: number, kind: number): boolean {
  return (data.cancels.motionKinds[s16(kind)] ?? []).includes(id);
}

/** The first reaction entry (extra test 0x45 and up) of a cancel list matching this frame, or the list's end. */
function findReaction(data: FightData, list: Cursor, frame: number, f: Fighter, opponent: Fighter): Cursor {
  const direction = f.input.direction;
  const pressed = f.input.pressed;
  let at = list;
  let saved = at;
  while (entryAt(data, at).command !== END) {
    const command = entryAt(data, at).command;
    if (command === RETURN) {
      at = nextEntry(saved);
      continue;
    }
    if (command === CALL) {
      saved = at;
      at = { shared: true, set: at.set, index: entryAt(data, at).target };
    }
    const entry = entryAt(data, at);
    if (entry.from <= frame && frame <= entry.to && commandMatches(data, f, entry.command, direction, pressed) && conditionHolds(entry, f, opponent) && entry.test >= REACTION_TESTS && reactionTest(data, entry, f, opponent)) {
      return at;
    }
    at = nextEntry(at);
  }
  return at;
}

/** A reaction entry's test, on the opponent's move and both fighters' facing. */
function reactionTest(data: FightData, entry: Cancel, f: Fighter, opponent: Fighter): boolean {
  const value = s16(entry.param);
  const facingEachOther = (): boolean => !(f.facingOffSize > 0x2aa9) && opponent.facingOffSize < 0x2aaa;
  const guardable = (): boolean => ((moveAt(data, opponent.move!).hitFlags >>> 8) & 8) === 0 && !(f.facingOffSize > 0x2aa9) && !(opponent.facingOffSize > 0x2aa9);
  const kind = s16(opponent.level);
  switch (entry.test) {
    case 0x45:
      return f.hitReacting !== 0 && facingEachOther();
    case 0x46:
      return guardable() && kind === 0x412 && hitListHas(data, opponent, value);
    case 0x47:
      return guardable() && kind === 0x217 && hitListHas(data, opponent, value);
    case 0x48:
      return guardable() && kind === 0x10f && hitListHas(data, opponent, value);
    case 0x49:
      return guardable() && (kind === 0x412 || kind === 0x217) && hitListHas(data, opponent, value);
    case 0x4a:
      return entry.param === s16(opponent.moveId) && facingEachOther();
    case 0x4b:
      return f.facingOffSize < 0x2aaa && opponent.facingOffSize < 0x2aaa && motionIsKind(data, motionOf(data, opponent.move!).id, value);
    default:
      return false;
  }
}

/** A cancel's target becomes the next move, with its transition and its two flags. */
function take(data: FightData, f: Fighter, entry: Cancel): void {
  f.next.id = s16(entry.target);
  f.next.move = moveById(data, f, f.next.id);
  f.next.type = transitionType(data, f, entry.type & 0x3f);
  f.next.turnAround = entry.type >> 7;
  f.next.noBlend = (entry.type >> 6) & 1;
}

/**
 * The next move from input. A cancel matching now is taken. Otherwise, inside the end entry's window
 * (or up to five frames before it with a button pressed), the follow-up's own cancels are tried as if
 * it had started, so an input made late in one move starts the move after; and once the move has run
 * out the follow-up itself is taken.
 */
export function chooseCancel(state: FightState, data: FightData, f: Fighter, opponent: Fighter): void {
  f.loopCount = 0xffff;
  if (f.next.move !== null) return;
  if (f.hold > 0x19) return;
  const playing = moveAt(data, f.move!);
  const endAt = findCancel(state, data, listOf(data, f.move!), f.frame, f, opponent);
  const end = entryAt(data, endAt);
  if (end.command !== END) {
    take(data, f, end);
    f.loopCount = (end.to - f.frame) & 0xffff;
    f.next.startFrame = f.rootLag < 0 ? end.to : end.start;
    if (f.next.startFrame === 0xff) f.next.startFrame = playing.length;
    f.transition = 2;
    return;
  }
  const frame = f.frame;
  const start = end.from;
  let early: boolean;
  if (frame < start - 5) early = false;
  else if (frame >= start) early = false;
  else early = f.rootLag > 0 && (f.input.history[f.input.cursor]! & 0xf0) !== 0;
  const inWindow = frame >= start && frame <= end.to && f.rootLag > 0;
  /* Tekken Ball's shove opens its move's follow-up from its own frame on. */
  const forced = state.mode === Mode.TEKKEN_BALL ? state.ball.shoves[f.movesetSlot]!.cancelFrame : 0;
  if (early || inWindow || (forced !== 0 && frame >= forced && f.rootLag >= 1)) {
    const followUp = moveById(data, f, s16(end.target))!;
    const heading = f.heading;
    f.heading = s16(heading + playing.facingOffset);
    face(data, f, opponent);
    const bufferedAt = findCancel(state, data, listOf(data, followUp), 1, f, opponent);
    f.heading = heading;
    face(data, f, opponent);
    const buffered = entryAt(data, bufferedAt);
    if (buffered.command !== END) {
      f.next.id = s16(buffered.target);
      f.next.move = moveById(data, f, f.next.id);
      f.next.startFrame = end.from;
      f.next.noBlend = (end.type >> 6) & 1;
      f.loopCount = (buffered.to - f.frame) & 0xffff;
      f.next.type = transitionType(data, f, buffered.type & 0x3f);
      f.turnByMove = 1;
      f.transition = 3;
      f.next.turnAround = buffered.type >> 7;
      return;
    }
  }
  const after = f.frame + f.rootLag;
  if (playing.length < after || after < 1) {
    f.next.startFrame = f.frame;
    take(data, f, end);
    f.turnByMove = 1;
    f.transition = 4;
  }
}

/** A reaction to the opponent's move, when this fighter can react. A reversal's damage is half the attack's plus 25. */
function chooseReaction(data: FightData, f: Fighter, opponent: Fighter): void {
  if (opponent.roster === 0x11) return;
  f.reversalDamage = 0;
  if (s8(f.hitReacting) === 0) return;
  const at = findReaction(data, listOf(data, f.move!), f.frame, f, opponent);
  const entry = entryAt(data, at);
  if (entry.command === END) return;
  f.next.id = s16(entry.target);
  f.next.move = moveById(data, f, f.next.id);
  f.next.startFrame = entry.start;
  f.beingHit = 0;
  f.hitReacting = 0;
  f.guarded = 0;
  f.hitClean = 0;
  f.untouchable = 0;
  f.loopCount = (entry.to - f.frame) & 0xffff;
  opponent.struck = 0;
  opponent.hitSlots.fill(0);
  opponent.hitLanded = 0;
  f.next.type = transitionType(data, f, entry.type & 0x3f);
  f.next.turnAround = 0;
  f.next.noBlend = 0;
  /* The hits taken this frame are spent by the reaction. */
  f.hitRecords[0]!.used = 0;
  f.hitRecords[1]!.used = 0;
  const damage = opponent.attackDamage;
  f.reversalDamage = (((damage - (damage >> 31)) >> 1) + 0x19) & 0xffff;
}

/** Both fighters' reactions, the order alternating by frame. */
export function chooseReactions(state: FightState, data: FightData): void {
  const order = (state.frameCount & 1) === 0 ? [1, 0] : [0, 1];
  for (const i of order) chooseReaction(data, state.fighters[i]!, targetOf(state, state.fighters[i]!));
  if (state.mode === Mode.TEKKEN_FORCE) chooseReaction(data, state.fighters[2], targetOf(state, state.fighters[2]));
}

/**
 * The reaction to being hit, a move id from the hit's reaction, by the quadrant the hit came from,
 * each in two forms chosen by the stance's bit 0x2; a launch when the fighter is already airborne or
 * its move says so.
 */
export function hitReaction(data: FightData, f: Fighter, opponent: Fighter): void {
  const alternate = (f.stance & 2) !== 0;
  const pick = (type: number, field: number): void => {
    f.next.type = transitionType(data, f, type);
    f.next.id = reactionField(data.reactions, f.reaction, alternate ? field : field + 1);
  };
  if (f.guarded !== 0) pick(0x23, Reaction.GUARDED);
  else if (f.inAir !== 0 || (moveAt(data, f.move!).flags & 0x400) !== 0) {
    f.next.type = transitionType(data, f, 0x24);
    launchKind(data, f, opponent);
  } else if ((f.stance & 0x200) !== 0) {
    f.next.type = transitionType(data, f, 0x25);
    f.next.id = reactionField(data.reactions, f.reaction, Reaction.LOW_STATE);
  } else if ((f.stance & 4) !== 0) {
    f.next.type = transitionType(data, f, 0x25);
    f.next.id = reactionField(data.reactions, f.reaction, Reaction.CROUCHING);
  } else if (f.counterHit !== 0) pick(0x26, Reaction.COUNTER);
  else {
    const from = f.facingQuadrant;
    if (from === 0) pick(0x2a, Reaction.FRONT);
    else if (from === 1) pick(0x27, Reaction.SIDE);
    else if (from === 2) pick(0x2b, Reaction.BACK);
    else if (from === 3) pick(0x28, Reaction.OTHER_SIDE);
  }
  f.next.turnAround = 0;
  f.next.noBlend = 0;
  f.next.startFrame = f.frame;
  f.next.move = moveById(data, f, f.next.id);
}

/**
 * Which launch a hit becomes: by the move playing, the opponent's launcher, how high the fighter
 * already is, and the quadrant it was hit from.
 */
function launchKind(data: FightData, f: Fighter, opponent: Fighter): void {
  const playingId = s16(f.moveId);
  let fresh = playingId !== 0xd62;
  if (playingId === 0xd63 && f.frame > 0x12) fresh = false;
  if (playingId === 0xd64 && f.frame > 0x12) fresh = false;
  let kind: number;
  if (!fresh) {
    kind = 2;
    if (playingId !== 0xd62) {
      const rise = f.skeleton.base.translation[1]!;
      if (rise < 0) {
        if (-s16(rise) > 0x3ff) kind = 0;
      } else if (s16(rise) > 0x3ff) kind = 0;
    }
  } else {
    let launcher = 0;
    if (opponent.character === 9) launcher = s16(opponent.moveId) === 0x241 ? 1 : 0;
    if (opponent.character === 0x10 && s16(opponent.moveId) === 0x14a) {
      launcher = 1;
      if (opponent.next.move !== null && (((opponent.next.id & 0xffff) - 0x848) >>> 0) < 2) launcher = 2;
    }
    if (launcher === 1 || (launcher !== 2 && f.hitTravel[1]! > 0x6d)) kind = 1;
    else if (playingId !== 0xd58 && f.facingQuadrant === 1) kind = 4;
    else if (playingId !== 0xd58 && f.facingQuadrant === 3) kind = 3;
    else kind = 0;
  }
  f.launchKind = kind;
  const launch = data.reactions.launches[kind]!;
  f.launchHeight = launch.height;
  f.next.id = launch.move;
}

/**
 * One fighter's next move: the distance to its opponent (and less 40 mm for each large body), a hit
 * reaction if it was hit, the cancel from input, and the knockout fall at zero health.
 */
function chooseMove(state: FightState, data: FightData, f: Fighter): void {
  const opponent = targetOf(state, f);
  face(data, f, opponent);
  let a = f.slot;
  let b = opponent.slot;
  if (a > 1) a = 1 << (a - 1);
  if (b > 1) b = 1 << (b - 1);
  const distance = state.pairs[a + b]!.distance | 0;
  f.targetDistance = distance >>> 0;
  let large = f.roster === 0xb || f.roster === 0x14 ? 1 : 0;
  if (opponent.roster === 0xb || opponent.roster === 0x14) large += 1;
  f.nearDistance = (distance - large * 5 * 8) | 0;
  if (f.hitReacting !== 0) {
    const guard = opponent.damageKind;
    if (guard === 0 || (guard === 2 && f.inAir === 0 && (f.stance & 4) === 0)) {
      hitReaction(data, f, opponent);
      f.transition = 1;
      if (f.throwHold > 0) f.damageKind = 1;
    }
  }
  /* Tekken Ball's point: the fighter whose half the ball fell on is blasted off its feet from where it fell. */
  if (state.mode === Mode.TEKKEN_BALL && state.ball.pointAgainst === f.slot + 1) {
    f.inAir = 1;
    f.guarded = 0;
    f.hitClean = 1;
    face(data, f, state.fighters[2]!);
    hitReaction(data, f, opponent);
    f.damageKind = 1;
  }
  if (f.next.move === null) chooseCancel(state, data, f, opponent);
  const falling = (ref: MoveRef | null): boolean => ref !== null && FALLS.includes(s16(moveAt(data, ref).next));
  if (f.health === 0 && f.hitClean !== 0) {
    /* The move chosen next, if any: none was when the knockout gave no reaction and no cancel opened. */
    const ref = f.next.move;
    const move = ref === null ? null : moveAt(data, ref);
    if (state.knockoutRule === 0) {
      if (falling(ref)) {
        f.inAir = 1;
        f.guarded = 0;
        f.hitClean = 1;
        f.guard = 0;
        hitReaction(data, f, opponent);
        f.damageKind = 1;
      }
    } else if (falling(ref) || (move !== null && (move.flags & 4) === 0 && move.stepWindow.first === 0)) {
      knockOut(state, data, f, opponent);
      f.damageKind = 1;
    }
  }
  if (f.next.type === 0x21) {
    f.partnerSlot = opponent.slot;
    opponent.partnerSlot = f.slot;
    opponent.throwing = 1;
    f.throwing = 1;
  }
}

/** Both fighters' next moves, the order alternating by frame; in Tekken Force the third's after them, until the boss is on. */
export function chooseMoves(state: FightState, data: FightData): void {
  const order = (state.frameCount & 1) === 0 ? [1, 0] : [0, 1];
  for (const i of order) chooseMove(state, data, state.fighters[i]!);
  if (state.mode === Mode.TEKKEN_FORCE && state.force.bossPhase === 0) chooseMove(state, data, state.fighters[2]);
}
