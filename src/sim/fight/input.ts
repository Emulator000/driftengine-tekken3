/**
 * Input as the fight reads it: each player's pad (or the computer's choice, or a replay's recorded
 * pad) turned into a direction relative to the opponent and the four attack buttons, kept for 60
 * frames; the side of the opponent each fighter stands on; and the punch buttons pressed apart or
 * together, which a throw's escape watches.
 *
 * A pad word has 0x1000 up, 0x2000 right, 0x4000 down, 0x8000 left, 0x0800 start, 0x80 square,
 * 0x10 triangle, 0x40 cross, 0x20 circle, 0x01 L2 and 0x04 L1.
 */
import { s16 } from '../math/integers.ts';
import { InputSource, Mode, type FightData, type FightState, type Fighter } from './state.ts';

const HISTORY = 60;
/** How many frames a sidestep tap lasts, and how long it counts as held. */
const SIDESTEP_FRAMES = 0x23;
const SIDESTEP_HELD_AFTER = 0x21;
const UP = 0x1000;
const DOWN = 0x4000;

/** A computer player's answer for this frame: the pad held and pressed. */
export type ComputerInput = (state: FightState, fighter: Fighter, data: FightData) => [number, number];

/** Forgets a player's input, as at the start of a round. */
export function clearInput(state: FightState, f: Fighter): void {
  const input = f.input;
  input.history.fill(5);
  input.pressedHistory.fill(0);
  input.direction = 5;
  input.buffer.count = -1;
  input.buffer.read = -1;
  input.cursor = 0;
  input.held = 0;
  input.pressed = 0;
  input.pressCounts.fill(0);
  input.replayHeld = 0;
  state.input.replayPrevious[f.slot] = 0;
  state.input.lastPunchBits[f.slot] = 0;
}

/** Which side of the opponent a fighter stands on, by the screen, unless a move holds it. */
export function updateSide(f: Fighter, opponent: Fighter): void {
  f.side = f.sideHeld === 0 ? (opponent.screenX <= f.screenX ? 1 : 0) : f.heldSide;
}

/** This frame's input for a player, from where its source says. */
export function readInput(state: FightState, f: Fighter, data: FightData, computer: ComputerInput): void {
  const source = state.input.sources[f.slot];
  if (source === InputSource.PAD) padInput(state, f, data, computer);
  else if (source === InputSource.NONE) clearInput(state, f);
  else if (source === InputSource.REPLAY) replayInput(state, f, data);
}

/** The pad, or the computer's choice. L2 and L1 tap up and down for a few frames: the sidestep shortcut. */
function padInput(state: FightState, f: Fighter, data: FightData, computer: ComputerInput): void {
  let held = 0;
  let pressed = 0;
  let side = 0;
  if (f.computer !== 0) {
    /* The computer answers relative to its facing, so its side is always 0. */
    if (f.health !== 0) [held, pressed] = computer(state, f, data);
  } else {
    if (state.mode === Mode.TEKKEN_FORCE) throw new Error("Tekken Force's input is not remade");
    const pad = f.slot;
    updateSide(f, state.fighters[(f.movesetSlot + 1) & 1]!);
    const rawHeld = state.input.pads.held[pad]!;
    const rawPressed = state.input.pads.pressed[pad]!;
    held = rawHeld;
    pressed = rawPressed;
    side = f.side;
    const sidestep = state.input.sidesteps[pad]!;
    let tapHeld = 0;
    let tapPressed = 0;
    if ((rawPressed & 1) !== 0) {
      tapPressed = UP;
      sidestep.down = 0;
      sidestep.left = SIDESTEP_FRAMES;
    } else if ((rawPressed & 4) !== 0) {
      tapPressed = DOWN;
      sidestep.down = 1;
      sidestep.left = SIDESTEP_FRAMES;
    }
    const left = sidestep.left;
    if (left > 0) {
      sidestep.left = left - 1;
      if (left - 1 > SIDESTEP_HELD_AFTER) tapHeld = sidestep.down === 0 ? UP : DOWN;
      /* While the shoulder button stays held and no button with it, the pad's own up and down are dropped. */
      const shoulderHeld = (sidestep.down === 0 && (rawHeld & 1) !== 0) || (sidestep.down === 1 && (rawHeld & 4) !== 0);
      if (shoulderHeld && (held & 0xf0) === 0) {
        held &= 0x0fff;
        pressed &= 0x0fff;
      }
    }
    held |= tapHeld;
    pressed |= tapPressed;
  }
  if (state.mode === Mode.PRACTICE) throw new Error("practice mode's input is not remade");
  recordInput(f, data, side, held, pressed);
}

/** A replay's recorded pad, its presses those not held last frame. */
function replayInput(state: FightState, f: Fighter, data: FightData): void {
  const held = f.input.replayHeld;
  recordInput(f, data, 0, held, held & (held ^ state.input.replayPrevious[f.slot]!));
  state.input.replayPrevious[f.slot] = held;
}

/** The attack buttons of a pad word as 0x10 left punch, 0x20 right punch, 0x40 left kick, 0x80 right kick. */
function buttonBits(pad: number): number {
  let bits = (pad >> 3) & 0x10;
  if ((pad & 0x10) !== 0) bits |= 0x20;
  if ((pad & 0x40) !== 0) bits |= 0x40;
  if ((pad & 0x20) !== 0) bits |= 0x80;
  return bits;
}

/** The pad bits counted in `pressCounts`, in order. */
const COUNTED = [0x80, 0x10, 0x40, 0x20] as const;

/**
 * One frame of input into the history: the direction relative to the opponent and the buttons; the
 * presses counted over the 60 frames; and the follow-up buffer, where presses within three frames
 * of each other make one entry.
 */
export function recordInput(f: Fighter, data: FightData, side: number, held: number, pressed: number): void {
  const input = f.input;
  const cursor = input.cursor < HISTORY - 1 ? input.cursor + 1 : 0;
  input.cursor = cursor;
  let direction = 5;
  if (side < 2) {
    const found = data.input.directions[side]!.indexOf(held & 0xf000);
    if (found >= 0) direction = found + 1;
  }
  const heldBits = buttonBits(held);
  input.held = heldBits >> 4;
  const pressedBits = buttonBits(pressed);
  COUNTED.forEach((bit, i) => {
    if ((pressed & bit) !== 0) input.pressCounts[i]! += 1;
  });
  input.history[cursor] = pressedBits | direction;
  input.pressed = pressedBits >> 4;
  input.direction = 1 << (direction + 4);
  const leaving = input.pressedHistory[cursor]!;
  COUNTED.forEach((bit, i) => {
    if ((leaving & bit) !== 0) input.pressCounts[i]! -= 1;
  });
  input.pressedHistory[cursor] = pressed;

  const buffer = input.buffer;
  if (buffer.count >>> 0 > 9) return;
  if (buffer.timer > 0) buffer.timer -= 1;
  if (pressedBits === 0) return;
  if (buffer.timer > 0) {
    const entry = buffer.entries[buffer.count]!;
    if ((heldBits & ~pressedBits) === (entry & 0xf0)) {
      buffer.entries[buffer.count] = (heldBits + direction) & 0xff;
      buffer.timer = 3;
      return;
    }
  }
  if (buffer.count > 8) return;
  buffer.count += 1;
  buffer.entries[buffer.count] = (heldBits + direction) & 0xff;
  buffer.timer = 3;
}

/** The follow-up buffer opened, closed, read on. */
export function openBuffer(f: Fighter): void {
  const buffer = f.input.buffer;
  if (buffer.count < 0) {
    buffer.count = 0;
    buffer.read = 0;
    buffer.timer = 0;
  }
}
export function closeBuffer(f: Fighter): void {
  const buffer = f.input.buffer;
  if (buffer.count >= 0) {
    buffer.count = -1;
    buffer.read = -1;
    buffer.timer = -1;
  }
}
export function advanceBuffer(f: Fighter): void {
  const buffer = f.input.buffer;
  if (buffer.read < buffer.count) buffer.read += 1;
}

/**
 * The punch buttons pressed together or apart since last frame. While a cancel watches for a pair,
 * a pair already seen stays set.
 */
export function punchPairs(state: FightState, f: Fighter): void {
  if (state.round.framesSeen === state.round.frames) return;
  const bits = f.input.history[f.input.cursor]!;
  const pairs = f.punchPairs;
  if (f.watchingPunchPairs !== 1 || (pairs.left | pairs.right | pairs.both) === 0) {
    const fresh = bits & (bits ^ state.input.lastPunchBits[f.slot]!);
    const left = fresh & 0x10;
    const right = fresh & 0x20;
    if ((bits & 0x30) === 0x30 && (left !== 0 || right !== 0)) pairs.both = 1;
    else if (left !== 0) pairs.left = 1;
    else if (right !== 0) pairs.right = 1;
    else {
      pairs.both = 0;
      pairs.left = 0;
      pairs.right = 0;
    }
  }
  state.input.lastPunchBits[f.slot] = bits;
}

/* ---- Matching commands against the history. ---- */

const previous = (i: number): number => (i > 0 ? i - 1 : HISTORY - 1);
const directionAt = (f: Fighter, i: number): number => f.input.history[i]! & 0xf;

/**
 * Whether a button spec (the high byte of a sequence step, or the low bits of a command) is met:
 * 0x10 alone is "any or none", 0x10 with buttons is "any of these pressed", plain buttons are "these
 * held with at least one newly pressed", and no buttons at all is "nothing pressed".
 */
function buttonsMatch(spec: number, pressed: number, held: number): boolean {
  if ((spec & 0x1f) === 0x10) return true;
  if ((spec & 0x10) !== 0) return (pressed & spec & 0xf) !== 0;
  const buttons = spec & 0xf;
  if (buttons === 0) return pressed === 0;
  return (pressed & buttons) !== 0 && (held & buttons) === buttons;
}

/** The commands with a meaning beyond a direction and buttons: the two dashes, and the two ranges of input sequences. */
export const Command = { DASH_FORWARD: 0xc001, DASH_BACK: 0xc002, SEQUENCES_A: 0xc00e, SEQUENCES_B: 0xc7ff } as const;

/**
 * Whether a cancel's command matches this frame. Below 0xc000 a command is a direction mask (bits 5
 * to 13, one per numpad direction) over a button spec; the two dashes and the input sequences have
 * their own commands.
 */
export function commandMatches(data: FightData, f: Fighter, command: number, direction: number, pressed: number): boolean {
  if (command < 0xc000) {
    if ((command & direction) === 0 && (command & 0x3fe0) !== 0) return false;
    if ((command & 0x1f) === 0x10) return true;
    if ((command & 0x10) !== 0) return (command & 0xf & pressed) !== 0;
    const buttons = command & 0xf;
    if (buttons === 0 && pressed === 0) return true;
    if ((buttons & pressed) === 0) return false;
    return buttons === (f.input.held & buttons);
  }
  if (command === Command.DASH_FORWARD) return doubleTap(f, 6);
  if (command === Command.DASH_BACK) return doubleTap(f, 4);
  if (command >= Command.SEQUENCES_A && command < Command.SEQUENCES_A + 0x3f) return sequenceMatches(f, data.input.sequencesA[command - Command.SEQUENCES_A]!);
  if (command >= Command.SEQUENCES_B && command < Command.SEQUENCES_B + 0x29) return sequenceMatches(f, data.input.sequencesB[command - Command.SEQUENCES_B]!);
  return false;
}

/** A dash: the direction now, neutral before it, and the same direction before that, all within 19 frames. */
function doubleTap(f: Fighter, direction: number): boolean {
  let i = f.input.cursor;
  if (directionAt(f, i) !== direction) return false;
  i = previous(i);
  if (directionAt(f, i) !== 5) return false;
  let left = 0x13;
  for (;;) {
    i = previous(i);
    const d = directionAt(f, i);
    if (d === 5) {
      left -= 1;
      if (left > 0) continue;
      return false;
    }
    if (d !== direction) return false;
    break;
  }
  if (left <= 0) return false;
  do {
    i = previous(i);
    if (directionAt(f, i) !== direction) break;
    left -= 1;
  } while (left > 0);
  return left > 0;
}

/**
 * An input sequence, `[window, step..., 0]`, each step a direction in the low nibble and a button
 * spec in the high byte. The last step is this frame; the earlier ones are found walking back
 * through the history within `window` frames, where a frame with an unmatched press fails it.
 * Positions are the sequence's halfwords, the window at 0.
 */
function sequenceMatches(f: Fighter, words: readonly number[]): boolean {
  const word = (i: number): number => words[i]!;
  const signed = (i: number): number => s16(words[i]!);
  let cursor = f.input.cursor;
  let window = signed(0);
  let step = 1;
  if (signed(1) !== 0) {
    step += 1;
    while (signed(step) !== 0) step += 1;
  }
  step -= 1;
  let want = word(step);
  if ((want & 0xf) === want) {
    cursor = cursor < HISTORY - 1 ? cursor + 1 : 0;
  } else {
    if ((f.input.history[cursor]! & 0xf) !== (want & 0xf)) return false;
    if (!buttonsMatch(want >> 8, f.input.pressed, f.input.held)) return false;
    step -= 1;
    if (step === 0) return true;
    want = word(step);
  }
  if (window <= 0) return false;
  do {
    cursor = cursor > 0 ? cursor - 1 : HISTORY - 1;
    const entry = f.input.history[cursor]!;
    let found = false;
    if ((want & 0xf) === (entry & 0xf)) {
      const spec = want >> 8;
      if ((spec & 0x1f) === 0x10) found = true;
      else if ((spec & 0x10) !== 0) found = (spec & (entry >> 4)) !== 0;
      else found = (spec & 0xf) === entry >> 4;
    }
    if (found) {
      step -= 1;
      if (step === 0) return true;
      want = word(step);
    } else if (entry >> 4 !== 0) {
      return false;
    }
    window -= 1;
  } while (window > 0);
  return false;
}
