/**
 * Practice's input recorder: one ring of 50 entries both sides write into, each a pad's buttons
 * and direction held over a count of frames (and whether the side recording stood on the right, so
 * its directions mirror when played), a side's newest entry kept; and its player, walking the ring
 * from the start into a fighter's replayed pad. COMBO TRAINING loads a character's combos into it.
 */
import type { PracticeTables } from '../data/scenes.ts';
import { moveAt } from '../fight/moves.ts';
import { InputSource, type FightData, type FightState } from '../fight/state.ts';
import type { PracticeState } from './state.ts';

const ENTRIES = 50;
const LONGEST = 0x3fff;
const MIRRORED = 0x80000000;
const IDLE = 0x1e;
/** A pad's buttons and directions as an entry keeps them. */
const KEPT = 0xf0f0;
/** The next move's type that ends a move at once. */
const ENDS_AT_ONCE = 4;

export const buttonsOf = (entry: number): number => entry & 0xf;
export const directionOf = (entry: number): number => (entry >> 8) & 0xf;
export const countOf = (entry: number): number => (entry >>> 16) & 0x7fff;
const mirroredOf = (entry: number): number => entry & MIRRORED;
const withCount = (entry: number, count: number): number => ((entry & ~0x7fff0000) | ((count & 0x7fff) << 16)) >>> 0;
const entry = (buttons: number, direction: number, count: number, mirrored: boolean): number => ((buttons & 0xff) | ((direction & 0xff) << 8) | ((count & 0x7fff) << 16) | (mirrored ? MIRRORED : 0)) >>> 0;

/** Every entry emptied (its mirroring kept), the side's newest at the start, its idle count full. */
export function clearEntries(p: PracticeState, side: number): void {
  const r = p.recorder;
  for (let i = 0; i < ENTRIES; i += 1) r.entries[i] = mirroredOf(r.entries[i]!) >>> 0;
  r.last[side] = 0;
  r.idle[side] = IDLE;
}

/** Whether a side's recording starts over: a button or direction pressed after it has stood idle a while (its move ended, nothing coming). */
export function idleRestart(p: PracticeState, state: FightState, data: FightData, side: number): boolean {
  const r = p.recorder;
  const f = state.fighters[side]!;
  const active = (state.input.pads.held[side]! & KEPT) !== 0;
  if (f.move !== null && f.moveId === moveAt(data, f.move).next) r.idle[side] = r.idle[side]! - 1;
  if (!active && (f.next.move === null || f.next.type === ENDS_AT_ONCE || f.moveId === f.next.id)) r.idle[side] = r.idle[side]! - 1;
  if (r.idle[side]! < 0) r.idle[side] = 0;
  if (!active) return false;
  const was = r.idle[side];
  r.idle[side] = IDLE;
  return was === 0;
}

/** A frame of a side's held pad recorded: its newest entry counted on, or a new one. */
export function record(p: PracticeState, state: FightState, side: number): void {
  const r = p.recorder;
  const bits = state.practice.heldPad[side]! & KEPT;
  const last = r.last[side]!;
  const newest = r.entries[last]!;
  if (((buttonsOf(newest) << 4) | (directionOf(newest) << 12)) === bits) {
    r.entries[last] = withCount(newest, Math.min(countOf(newest) + 1, LONGEST));
    return;
  }
  const i = last + 1 < ENTRIES ? last + 1 : 0;
  r.entries[i] = entry((bits >> 4) & 0xf, bits >> 12, 1, state.fighters[side]!.side !== 0);
  r.last[side] = i;
}

/** A recording ended: its newest entry a frame long, the player back at the start. */
export function closeRecording(p: PracticeState, side: number): void {
  const r = p.recorder;
  r.entries[r.last[side]!] = withCount(r.entries[r.last[side]!]!, 1);
  resetPlayback(p, side);
}

/** The player back at the ring's start. */
export function resetPlayback(p: PracticeState, side: number): void {
  const r = p.recorder;
  r.playIndex = 0;
  r.cursor = r.last[side]! < 0 ? (r.cursor & MIRRORED) >>> 0 : r.entries[0]!;
}

/** How many combos a moveset has. */
export function comboCount(tables: PracticeTables, character: number): number {
  return tables.combos[character]?.length ?? 0;
}

/** A combo of the side's character loaded into the ring; its inputs' count (0 none). */
export function loadCombo(p: PracticeState, state: FightState, tables: PracticeTables, side: number, k: number): number {
  const combos = tables.combos[state.fighters[side]!.character];
  if (combos === undefined || combos.length === 0) return 0;
  const inputs = combos[k];
  if (inputs === undefined || inputs.length === 0) {
    clearEntries(p, side);
    return 0;
  }
  const r = p.recorder;
  r.last[side] = inputs.length - 1;
  inputs.forEach((word, i) => (r.entries[i] = word >>> 0));
  return inputs.length;
}

/** A frame played into a side's fighter's replayed pad; false once the recording has run out (the player back at the start). */
export function play(p: PracticeState, state: FightState, side: number): boolean {
  const r = p.recorder;
  const f = state.fighters[side]!;
  for (;;) {
    const count = countOf(r.cursor);
    if (1 <= count) {
      r.cursor = withCount(r.cursor, count - 1);
      let direction = directionOf(r.cursor);
      if (mirroredOf(r.cursor) !== 0) {
        if ((direction & 8) !== 0) direction = (direction & ~8) | 2;
        else if ((direction & 2) !== 0) direction = (direction & ~2) | 8;
      }
      f.input.replayHeld = (buttonsOf(r.cursor) << 4) | (direction << 12);
      state.input.sources[f.slot] = InputSource.REPLAY;
      return true;
    }
    r.playIndex += 1;
    if (r.last[side]! < r.playIndex || ENTRIES - 1 < r.playIndex) break;
    r.cursor = r.entries[r.playIndex]!;
  }
  r.cursor = r.last[side]! < 0 ? (r.cursor & MIRRORED) >>> 0 : r.entries[0]!;
  r.playIndex = 0;
  return false;
}
