/**
 * The replay's records of each fighter: while a round runs (recording) every frame of each fighter
 * is kept in a ring of 300; a replay plays them back into the fighter, the root and position of odd
 * half-frames averaged between two records. Starting a replay holds the live frame aside, and
 * ending it puts that back.
 */
import type { FightState, Fighter, ReplayFrame } from './state.ts';

/**
 * The replay's states: recording during a round; a replay beginning (the roots swapped in), starting
 * (the live frame held aside), playing, ending and ended; an overlay's replay played at full speed;
 * and none.
 */
export const ReplayState = { PLAYING: 1, BEGIN: 2, STARTING: 3, ENDING: 4, ENDED: 5, PLAYING_LAST: 6, RECORDING: 7, OFF: 8 } as const;
export const REPLAY_FRAMES = 300;

/** The fighter's records: the first fighter's, or the second's for any other. */
const recordsOf = (state: FightState, f: Fighter): ReplayFrame[] => state.replay.fighters[f === state.fighters[0] ? 0 : 1]!.frames;
const heldOf = (state: FightState, f: Fighter): ReplayFrame => state.replay.held[f === state.fighters[0] ? 0 : 1]!;

function checkIndex(state: FightState): void {
  if (state.replay.index !== 0) throw new Error('only the first replay is remade');
}

const playing = (state: FightState, f: Fighter): ReplayFrame => recordsOf(state, f)[state.replay.playFrame >> 1]!;
const recording = (state: FightState, f: Fighter): ReplayFrame => recordsOf(state, f)[state.replay.recordFrame]!;

function save(record: ReplayFrame, f: Fighter): void {
  record.move = f.move;
  record.blendFrom = f.blend.from;
  record.blendTo = f.blend.to;
  record.blendFromFrame = f.blend.fromFrame;
  record.blendToFrame = f.blend.toFrame;
  record.frame = f.frame & 0xff;
  record.blendLength = f.blend.length & 0xff;
  record.blendKind = f.blend.kind & 0xf;
  record.blending = f.blend.started & 0xf;
}

function restore(record: ReplayFrame, f: Fighter): void {
  f.rootMove = record.move;
  f.move = record.move;
  f.blend.from = record.blendFrom;
  f.blend.to = record.blendTo;
  f.blend.fromFrame = record.blendFromFrame;
  f.blend.toFrame = record.blendToFrame;
  f.frame = record.frame;
  f.blend.length = record.blendLength;
  f.blend.kind = record.blendKind;
  f.blend.started = record.blending;
}

/** Before posing: a replay puts the recorded move back (and as it starts, holds the live one aside). */
export function replayMove(state: FightState, f: Fighter): void {
  const replay = state.replay.state;
  if (replay === ReplayState.STARTING) {
    checkIndex(state);
    save(heldOf(state, f), f);
    restore(playing(state, f), f);
  } else if (replay === ReplayState.PLAYING || replay === ReplayState.PLAYING_LAST) {
    checkIndex(state);
    restore(playing(state, f), f);
  } else if (replay === ReplayState.ENDING) restore(heldOf(state, f), f);
}

/** While recording, the move after the blend is chosen. */
export function recordMove(state: FightState, f: Fighter): void {
  if (state.replay.state === ReplayState.RECORDING) save(recording(state, f), f);
}

/**
 * A hand's model step as drawn: while recording, kept; as a replay starts, the live one held aside
 * and the recorded one drawn; while it plays, the recorded one; as it ends, the one held aside.
 */
export function replayHandStep(state: FightState, f: Fighter, hand: number, step: number): number {
  const replay = state.replay.state;
  if (replay === ReplayState.STARTING) heldOf(state, f).hands[hand] = step & 0xff;
  if (replay === ReplayState.STARTING || replay === ReplayState.PLAYING || replay === ReplayState.PLAYING_LAST) return playing(state, f).hands[hand]!;
  if (replay === ReplayState.ENDING) return heldOf(state, f).hands[hand]!;
  if (replay === ReplayState.RECORDING) recording(state, f).hands[hand] = step & 0xff;
  return step;
}

/** The root's angles, recorded or played back. */
export function replayAngles(state: FightState, f: Fighter, angles: number[]): void {
  const replay = state.replay.state;
  const copy = (from: readonly number[], to: number[]): void => {
    for (let i = 0; i < 3; i += 1) to[i] = from[i]!;
  };
  if (replay === ReplayState.STARTING) {
    copy(angles, heldOf(state, f).angles);
    copy(playing(state, f).angles, angles);
  } else if (replay === ReplayState.PLAYING || replay === ReplayState.PLAYING_LAST) copy(playing(state, f).angles, angles);
  else if (replay === ReplayState.ENDING) copy(heldOf(state, f).angles, angles);
  else if (replay === ReplayState.RECORDING) copy(angles, recording(state, f).angles);
}

/**
 * The root and position, recorded or played back; an odd half-frame takes the root halfway to the
 * next record. The last replay's second frame starts the replay's camera, from the second fighter.
 */
export function replayRoot(state: FightState, f: Fighter, startReplayCamera: (state: FightState) => void): void {
  const replay = state.replay.state;
  const root = f.skeleton.base.translation;
  if (replay === ReplayState.STARTING || replay === ReplayState.PLAYING || replay === ReplayState.PLAYING_LAST) {
    checkIndex(state);
    if (replay === ReplayState.STARTING) heldOf(state, f).position.splice(0, 3, ...f.position);
    const half = state.replay.playFrame >> 1;
    let next = half + 1;
    if (next < 0) next = half + 0x4b01;
    const records = recordsOf(state, f);
    const now = records[half]!;
    const then = records[next % REPLAY_FRAMES]!;
    const odd = state.replay.playFrame & 1;
    for (let i = 0; i < 3; i += 1) root[i] = odd === 0 ? now.root[i]! : ((now.root[i]! + then.root[i]!) / 2) | 0;
    if (replay === ReplayState.PLAYING_LAST && state.replay.playFrame === 2 && f.movesetSlot === 1) startReplayCamera(state);
    f.position.splice(0, 3, ...now.position);
  } else if (replay === ReplayState.ENDING) {
    const held = heldOf(state, f);
    root.splice(0, 3, ...held.root);
    f.position.splice(0, 3, ...held.position);
  } else if (replay === ReplayState.RECORDING) {
    const record = recording(state, f);
    record.root.splice(0, 3, ...root);
    record.position.splice(0, 3, ...f.position);
  }
}
