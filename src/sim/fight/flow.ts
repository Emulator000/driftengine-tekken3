/**
 * The round's flow and the replay's state, each frame before the fight's own.
 *
 * The flow: the opening (until the fighters may move), fighting with the timer running, the
 * knockout (its result scored, the losers' input taken over), the knockout's replay, the closing
 * (the winner's pose, the losers falling, the finishing shot) and the round's end, when the game
 * starts the next round or ends the match. In Arcade's last stage, the first round a lone human
 * wins against Ogre ends with him changing into True Ogre.
 *
 * The replay: while a round runs, recording advances the ring; a replay starts by holding the live
 * roots aside and framing the replay camera, plays the ring half a frame at a time (the recorded
 * sounds with it) until its end or a human's start button, then ends and puts the live frame back.
 *
 * In Tekken Ball the knockout replays the ball's last thirty frames, again and again at full speed
 * and the last time at half, the finishing shot on the loser, then the closing.
 *
 * The pause: a human's start button while fighting pauses the fight (the music down), and the
 * frame freezes until it is pressed again.
 */
import { clearPool } from '../effects/pool.ts';
import { clearDust, clearSparks, rewindEvents, stopEvents } from '../effects/sparks.ts';
import { startFinish, startReplayCamera } from './camera.ts';
import { restHands } from './hands.ts';
import { callReplay, printCall } from './hud.ts';
import { clearInput } from './input.ts';
import { endPose, endSoundScript, winPose } from './move.ts';
import { replayEffect, replayEffectLine, replayLine } from './move-sounds.ts';
import { moveAt, moveById } from './moves.ts';
import { poseFighter } from './pose.ts';
import { ReplayState } from './replay.ts';
import { InputSource, Mode, type FightData, type FightState, type Fighter } from './state.ts';
import { fadeMusic, keyOff, keyOffVoices, musicAfterWin } from './voices.ts';

/** The flow's steps. */
export const Flow = { OPENING: 0, FIGHTING: 1, KNOCKED_OUT: 2, REPLAY_ASKED: 3, REPLAYING: 4, CLOSING_START: 5, CLOSING: 6, FORCE_LOAD: 7, STAGE_CLEAR: 8, OVER: 9, TRUE_OGRE: 10, PRACTICE_RESET: 0xb } as const;
/** The round's status while closing: both shown, one side's winner shown, or a side's finishing shot. */
const Status = { BOTH: 2, FIRST_WINS: 3, SECOND_WINS: 4, POSES: 5, FIRST_FINISH: 6, SECOND_FINISH: 7 } as const;
/** The round's result bits. */
const Result = { TIME_UP: 0x01, KO: 0x02, DOUBLE_KO: 0x04, PERFECT: 0x08, GREAT: 0x10, DRAW: 0x20 } as const;
const START = 0x800;
const ARCADE = 0;
const TIME_ATTACK = 3;
const ATTRACT = 6;
/** Frames the opening lasts in the first round and after it. */
const OPENING_FIRST = 0x97;
const OPENING_LATER = 0x5b;
/** Frames the knockout waits before its replay (a time out's shorter), and the closing's longest. */
const AFTER_KO = 0xf0;
const AFTER_TIME_UP = 0x5a;
const CLOSING = 300;
/** The ring's frames, its half-frames, and the wrap the game's arithmetic adds below zero. */
const RING = 300;
const HALVES = 600;
const WRAP = 0x4b00;
/** The longest a replay reaches back, and the most it starts before the end with enough recorded. */
const LONGEST = 0x12a;
const LEAD = 0x96;
/** Tekken Ball's replay: the last thirty frames. */
const BALL_REPLAY = 0x1e;
/** Tekken Ball: the knockout's frame its first replay starts on, and the finishing shot's length. */
const BALL_FIRST_REPLAY = 0x10;
const BALL_FINISH = 0xf0;
/** The share of health a perfect leaves, and below which a win is a great. */
const WHOLE = 0x1000;
const GREAT = 0xcd;
/** The pose a loser takes: fallen, or standing beaten by time. */
const FALLEN = 0xd65;
const BEATEN = 0xd6c;
/** The finishing shot's ground fade. */
const FINISH_FADE = 10000;
/** The arcade's last stage, Ogre's. */
const LAST_STAGE = 9;
const BOSCONOVITCH_SET = 0x12;
/** Tekken Force's stances, which a computer at the round's end holds still in; the frames the stage clear shows. */
const FORCE_STANCES = { first: 0x24, count: 4 } as const;
const STAGE_CLEAR_FRAMES = 300;

/** The start and select bits the humans' pads pressed this frame, for skipping. */
export function humanButtons(state: FightState): number {
  const fresh = state.input.fresh;
  if (state.mode === Mode.TEKKEN_FORCE) return fresh[state.force.pad]!;
  switch (state.humans) {
    case 1:
      return fresh[0]!;
    case 2:
      return fresh[1]!;
    case 3:
      return fresh[0]! | fresh[1]!;
    default:
      return 0;
  }
}

/* ---- The pause. ---- */

/**
 * A human's start button while fighting asks for the pause; the frame freezes while it holds. In
 * practice only its human's start pauses, and as practice starts its menu opens by itself.
 */
export function checkPause(state: FightState): void {
  const pause = state.pause;
  let one = state.joined[0] !== 0 && (state.input.fresh[0]! & START) !== 0;
  let two = state.joined[1] !== 0 && (state.input.fresh[1]! & START) !== 0;
  if (state.mode === Mode.PRACTICE) {
    const human = state.match.streakSide;
    const starting = state.practice.starting !== 0;
    one = state.replaying === 0 && human === 0 && (starting || (state.input.fresh[0]! & START) !== 0);
    two = state.replaying === 0 && human === 1 && (starting || (state.input.fresh[1]! & START) !== 0);
  }
  if (state.match.canPause === 0 || state.round.flow !== Flow.FIGHTING) pause.requested = 0;
  else if (pause.requested === 0) {
    if (one) pause.requested = state.round.flow;
    if (two) pause.requested = 2;
  }
  if (state.pauseMenu.choice === 1) {
    pause.requested = 0;
    state.pauseMenu.choice = 0;
  }
  if (pause.released !== 0) {
    pause.requested = 0;
    pause.released = 0;
  }
  if (pause.requested !== pause.last) {
    if (pause.requested === 0) state.pauseMenu.choice = 0;
    else state.pauseMenu.cursor = 0xff;
    fadeMusic(state, pause.requested === 0 ? 0x7f : 0x1e, 0x14);
  }
  pause.last = pause.requested;
  pause.frozen = pause.requested;
  if (state.round.frames === 0) pause.frozen = 0;
}

/* ---- The replay. ---- */

const wrap = (value: number, bound: number): number => (value < 0 ? value + WRAP : value) % bound;

/**
 * The knockout's replay starts `back` frames before the end (or from where the knockout's blow
 * began), at most 298, with the stage and each fighter's roster code, character and sound kept.
 */
export function startReplay(state: FightState, data: FightData, back: number): void {
  const replay = state.replay;
  if (replay.recorded < back) back = replay.recorded - 2;
  for (let i = 0; i < 2; i += 1) {
    const f = state.fighters[i]!;
    const cast = replay.cast[i]!;
    cast.rosterCode = f.rosterCode & 0xff;
    cast.character = f.character & 0xff;
    cast.sound = f.sound & 0xff;
  }
  replay.stage = state.stage;
  if (back === 0 && replay.knockoutStart < 0) {
    replay.state = ReplayState.ENDED;
    let target = replay.recordFrame * 2 - 0x140;
    if (target < 0) target = replay.recordFrame * 2 + 0x49c0;
    replay.knockoutStart = target % HALVES;
    stopEvents(state);
    return;
  }
  if (LONGEST < back) back = LONGEST;
  if (back !== 0) replay.knockoutStart = wrap(replay.recordFrame - back, RING) * 2;
  let at = replay.recordFrame - (replay.knockoutStart >> 1);
  if (at < 0) at += WRAP;
  if (at % RING < LEAD && LEAD + 2 < replay.recorded) replay.knockoutStart = (replay.recordFrame - LEAD) * 2;
  if (state.mode === Mode.TEKKEN_BALL) replay.knockoutStart = (replay.recordFrame - BALL_REPLAY) * 2;
  if (replay.knockoutStart < 0) replay.knockoutStart += WRAP;
  replay.state = ReplayState.BEGIN;
  state.noBlendFrames = 0x14;
  replay.playFrame = replay.knockoutStart % HALVES;
  let first = replay.recordFrame - (replay.playFrame >> 1);
  if (first < 0) first += WRAP;
  replay.knockoutStart = replay.playFrame;
  clearDust(state, data);
  clearSparks(state);
  rewindEvents(state, first % RING);
  stopEvents(state);
}

/** The replay the flow asked for starts. */
export function replayIfAsked(state: FightState, data: FightData): void {
  if (state.round.replayRequest !== 0) {
    startReplay(state, data, 0);
    clearSparks(state);
    clearDust(state, data);
  }
  state.round.replayRequest = 0;
}

/** On a replay's whole frames, the sound recorded then. */
function replaySounds(state: FightState, data: FightData): void {
  const replay = state.replay;
  if ((replay.playFrame & 1) !== 0) return;
  if (replay.index !== 0) throw new Error('only the first replay is remade');
  const { code, kind, side } = replay.sounds[replay.playFrame >> 1]!;
  if (kind === 1) replayEffect(state, data, (code << 16) >> 16);
  else if (kind === 2) replayLine(state, data, side, state.fighters[side]!.sound, code);
  else if (kind === 3) replayEffectLine(state, data, side, (code << 16) >> 16);
}

/** The next frame's sound slot cleared for recording. */
function clearSoundSlot(state: FightState): void {
  const replay = state.replay;
  if (0 < replay.soundShift) replay.soundShift -= 1;
  let at = replay.recordFrame + replay.soundShift;
  if (at < 0) at += WRAP;
  replay.sounds[at % RING]!.kind = 0;
}

/** Every fighter's blend cleared. */
function clearBlends(state: FightState): void {
  const count = state.mode === Mode.TEKKEN_FORCE ? 3 : 2;
  for (let i = 0; i < count; i += 1) {
    const blend = state.fighters[i]!.blend;
    blend.length = 0;
    blend.position = 0;
    blend.weight = 0;
    blend.rootDelta.fill(0);
  }
}

/**
 * A frame of the replay's state: recording advances the ring; starting swaps the recorded roots
 * in and frames the replay camera; playing steps half a frame at a time to the end, which a
 * human's start button cuts short, showing REPLAY at the top right on every other 16 frames.
 * Nonzero while the replay plays.
 */
export function stepReplay(state: FightState, data: FightData): number {
  const replay = state.replay;
  const ball = state.match.ball;
  let last = replay.recordFrame * 2 - 2;
  if (state.mode === Mode.TEKKEN_BALL) {
    if (ball.replaysShown === 3 && ball.replaysWanted > 3) last = replay.recordFrame * 2 - 0x20;
    if (last < 0) last += HALVES;
  }
  if (last < 0) last = 0x256;
  switch (replay.state) {
    case ReplayState.PLAYING:
      callReplay(state);
      replay.playFrame = wrap(replay.playFrame + (state.mode === Mode.TEKKEN_BALL && ball.replaysShown < ball.replaysWanted ? 2 : 1), HALVES);
      if (replay.playFrame === last || replay.skip !== 0) replay.state = ReplayState.ENDING;
      replaySounds(state, data);
      return replay.state;
    case ReplayState.BEGIN: {
      replay.state = ReplayState.STARTING;
      if (replay.index !== 0) throw new Error('only the first replay is remade');
      const half = replay.playFrame >> 1;
      for (let i = 0; i < 2; i += 1) {
        const root = state.fighters[i]!.skeleton.base.translation;
        const held = replay.held[i]!;
        const recorded = replay.fighters[i]!.frames[half]!;
        for (let k = 0; k < 3; k += 1) {
          held.root[k] = root[k]!;
          root[k] = recorded.root[k]!;
        }
      }
      startReplayCamera(state, data);
      for (const f of [state.fighters[0], state.fighters[1]]) restHands(state, data, f);
      return replay.state;
    }
    case ReplayState.STARTING:
      replay.state = ReplayState.PLAYING;
      replay.skip = 0;
      return 1;
    case ReplayState.ENDING:
      replay.state = ReplayState.ENDED;
      state.noBlendFrames = 0x14;
      clearBlends(state);
      return 0;
    case ReplayState.ENDED:
    case ReplayState.OFF:
      return 0;
    case ReplayState.PLAYING_LAST:
      replay.playFrame = wrap(replay.playFrame + 2, HALVES);
      if (replay.playFrame === last) replay.overlayPlaying = 0;
      replaySounds(state, data);
      return replay.state;
    case ReplayState.RECORDING:
      if (replay.recorded < 0x70000000) replay.recorded += 1;
      replay.recordFrame = wrap(replay.recordFrame + 1, RING);
      clearSoundSlot(state);
      return 0;
    default:
      return replay.state;
  }
}

/** Whether this replay step lands on a whole frame (the pose is drawn then). */
export const replayWholeFrame = (state: FightState): number => (state.replay.playFrame ^ 1) & 1;

/* ---- The round's end. ---- */

/** The round is over: a fighter at no health, or the time out; in Tekken Force the player down, or the boss once his fight is on. */
function roundOver(state: FightState): boolean {
  const [a, b] = state.fighters;
  if (state.mode === Mode.TEKKEN_FORCE) {
    if (a.health < 1 || (state.force.bossPhase !== 0 && b.health < 1)) return true;
  } else if (a.health === 0 || b.health === 0) return true;
  return state.timer < 1;
}

/** Each fighter's health as a share of 0x1000, rounded up (all of it with no full health to share). */
function healthShares(state: FightState): void {
  for (const f of [state.fighters[0], state.fighters[1]]) {
    const unit = f.maxHealth >> 12;
    f.healthShare = unit === 0 ? 0xffff : Math.trunc((f.health + unit - 1) / unit) & 0xffff;
  }
}

/** The round's result from the health left: time up, a knockout or a double one, a perfect, a great, a draw. */
function roundResult(state: FightState): void {
  const [a, b] = state.fighters;
  const timeUp = state.timer < 1 ? Result.TIME_UP : 0;
  const round = state.round;
  round.result = timeUp;
  if (a.healthShare === b.healthShare) {
    round.result = timeUp | Result.DRAW;
    if (a.healthShare === 0) round.result = timeUp | Result.DRAW | Result.DOUBLE_KO | Result.KO;
    return;
  }
  const [loser, winner] = b.healthShare < a.healthShare ? [b, a] : [a, b];
  if (((loser.healthShare << 16) >> 16) === 0) {
    round.result = timeUp | Result.KO;
    if (winner.healthShare === WHOLE) round.result = timeUp | Result.KO | Result.PERFECT;
    else if (winner.healthShare < GREAT) round.result = timeUp | Result.KO | Result.GREAT;
  }
}

/** The tie-break when the pads decide: the first pad alone, or with both the streak's side. */
function padTieBreak(state: FightState): number {
  if (state.humans === 1) return 1;
  if (state.humans === 3) return state.match.streakSide;
  return 0;
}

/** The match is over: its winner (1, 2, or 3 a draw) and which sides won and lost. */
function matchOver(state: FightState): void {
  const [a, b] = state.fighters;
  const match = state.match;
  let winner: number;
  let loser: number;
  match.winner = 0;
  if (b.wins < a.wins) {
    winner = 0;
    loser = 1;
    match.winner = 1;
  } else if (a.wins < b.wins) {
    winner = 1;
    loser = 0;
    match.winner = 2;
  } else {
    winner = padTieBreak(state);
    loser = (winner + 1) & 1;
    match.winner = 3;
  }
  match.winnerSide = winner;
  match.loserSide = loser;
}

/** The round's winner (outcome 1, the loser -1, a draw both -1) and rounds won; the match's end if it came. */
function scoreRound(state: FightState): void {
  const [a, b] = state.fighters;
  const needed = state.match.roundsToWin;
  const win = (w: Fighter, l: Fighter): void => {
    w.outcome = 1;
    l.outcome = -1;
    w.wins = (w.wins + 1) << 16 >> 16;
  };
  if (state.mode === Mode.TEKKEN_FORCE) {
    if (b.healthShare < a.healthShare && (state.round.result & Result.TIME_UP) === 0) win(a, b);
    else win(b, a);
  } else if (b.healthShare < a.healthShare) win(a, b);
  else if (a.healthShare < b.healthShare) win(b, a);
  else {
    state.round.last = (state.round.last - 1) & 0xffff;
    let first = a;
    let second = b;
    if (a.wins <= b.wins && (!(b.wins <= a.wins) || padTieBreak(state) !== 0)) {
      first = b;
      second = a;
    }
    first.wins = (first.wins + 1) << 16 >> 16;
    second.wins = (second.wins + 1) << 16 >> 16;
    first.outcome = -1;
    second.outcome = -1;
    if (state.match.drawRule === 0) {
      if (needed <= first.wins) first.outcome = 1;
      if (needed <= second.wins) second.wins = (second.wins - 1) << 16 >> 16;
    } else if (needed <= first.wins && second.wins < needed) first.outcome = 1;
  }
  if (state.round.last <= state.round.number || needed <= a.wins || needed <= b.wins) matchOver(state);
}

/** Survival's fight lengths (frames) past which its winner gets less back. */
const SURVIVAL_LENGTHS = [299, 599, 899, 0x4af, 0x5db, 0x707, 0x833] as const;

/**
 * The health each fighter carries into the next round, as the mode keeps it: in Team Battle the
 * winner gets some back by the eighths of its health left, in Survival the human winner by how long
 * the fight took (none to a fighter with none left), never past full.
 */
function carryHealth(state: FightState, data: FightData): void {
  const mode = state.mode;
  [state.fighters[0], state.fighters[1]].forEach((f, side) => {
    if (mode !== Mode.TEAM_BATTLE && mode !== Mode.SURVIVAL) {
      f.carriedHealth = f.health;
      return;
    }
    let health = f.health >>> 0;
    const recovers = side === state.match.winnerSide && (mode === Mode.TEAM_BATTLE || side === state.match.humanSide);
    if (recovers && health !== 0) {
      const max = f.maxHealth >>> 0;
      const recovery = data.roster.recovery;
      const back =
        mode === Mode.TEAM_BATTLE
          ? recovery.team[Math.min(7, Math.trunc((health * 8) / max))]!
          : recovery.survival[SURVIVAL_LENGTHS.filter((length) => length < state.match.fightFrames).length]!;
      health = ((max | 0) >> 8) * back + health;
      if (max < health) health = max;
    }
    f.carriedHealth = health;
  });
}

/** At time out, the losers' closing marks them (a draw, neither). */
function markTimeOut(state: FightState): void {
  if ((state.round.result & Result.TIME_UP) === 0) return;
  const [a, b] = state.fighters;
  if (a.outcome === b.outcome) {
    a.closing = 0;
    b.closing = 0;
    return;
  }
  if (a.outcome < 0) a.closing = a.outcome;
  if (b.outcome < 0) b.closing = b.outcome;
}

/** What the computer's last move leaves it holding: the guard its move's stance asks for, or nothing. */
function settleStance(state: FightState, data: FightData, f: Fighter): void {
  if (f.character !== BOSCONOVITCH_SET) {
    if (state.mode === Mode.TEKKEN_FORCE && ((f.moveId - FORCE_STANCES.first) & 0xffff) < FORCE_STANCES.count) {
      f.input.replayHeld = 0x8000;
      return;
    }
    let move = f.next.move;
    if (move === null) move = moveById(data, f, moveAt(data, f.move!).next);
    if (move === null) throw new Error("a computer's last move goes on to no move");
    if ((moveAt(data, move).flags & 0x204) !== 0) {
      f.input.replayHeld = 0x1000;
      return;
    }
  }
  f.input.replayHeld = 0;
}

/** After the knockout a loser, or a computer, stops taking input; a human winner keeps the pad. */
function afterKnockout(state: FightState, data: FightData, f: Fighter): void {
  if (f.health === 0 || f.outcome < 0) {
    state.input.sources[f.slot] = InputSource.REPLAY;
    f.input.replayHeld = 0;
  } else if ((state.round.result & Result.TIME_UP) === 0 && f.computer === 0) state.input.sources[f.slot] = InputSource.PAD;
  else {
    state.input.sources[f.slot] = InputSource.REPLAY;
    settleStance(state, data, f);
  }
}

/** The blend stopped for a winner's pose. */
function stopBlend(state: FightState, f: Fighter): void {
  f.blend.kind = 0;
  state.noBlendFrames = 0x14;
}

/** The round's winner takes a win pose, by the frame's parity unless a button picks. */
function winnerPoses(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const parity = state.frameCount & 1;
  let winner: Fighter;
  let loser: Fighter;
  if (a.outcome < 1) {
    if (b.outcome < 1) return;
    b.closing = parity + 1;
    stopBlend(state, b);
    [winner, loser] = [b, a];
  } else {
    a.closing = parity + 1;
    stopBlend(state, a);
    [winner, loser] = [a, b];
  }
  winPose(state, data, winner, loser, parity);
}

/** Only one fighter is posed and heard. */
function soloFighter(state: FightState, slot: number): void {
  for (const f of state.fighters) f.present = 0;
  state.fighters[slot]!.present = 1;
}

/** The round's closing camera by who won, and who is shown. */
function closingCamera(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const both = (): void => {
    b.present = 1;
    a.present = 1;
  };
  if (state.mode === ATTRACT) {
    both();
    return;
  }
  const needed = state.match.roundsToWin;
  const showA = (): void => {
    state.status = Status.FIRST_WINS;
    soloFighter(state, a.slot);
  };
  const showB = (): void => {
    state.status = Status.SECOND_WINS;
    if (0 < b.closing) soloFighter(state, b.slot);
    else {
      state.status = Status.BOTH;
      both();
    }
  };
  const finish = (f: Fighter, status: number): void => {
    state.groundFade = FINISH_FADE;
    startFinish(state, data, f, f.health);
    state.status = status;
    soloFighter(state, f.slot);
  };
  if ((a.wins < needed && b.wins < needed) || state.match.goesOn === 1) {
    if (a.closing < 1) showB();
    else showA();
    return;
  }
  if (a.computer === 0 && 0 < a.closing) {
    showA();
    return;
  }
  if (b.computer === 0 && 0 < b.closing) {
    if (a.closing < 1) showB();
    else showA();
    return;
  }
  if (0 < a.closing) {
    finish(b, Status.SECOND_FINISH);
    return;
  }
  if (b.closing < 1) {
    state.status = Status.BOTH;
    both();
    return;
  }
  finish(a, Status.FIRST_FINISH);
}

/** The losers fall, or stand beaten by time. */
function loserPoses(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  if (a.outcome < 0) endPose(state, data, a, b, a.health === 0 ? FALLEN : BEATEN);
  if (b.outcome < 0) endPose(state, data, b, a, b.health === 0 ? FALLEN : BEATEN);
}

/**
 * In the arcade or time attack, at the last stage, once a lone human who has not lost there has
 * won a round and the computer has not won the match, Ogre changes into True Ogre (once a run).
 */
function ogreChanges(state: FightState): boolean {
  const match = state.match;
  if (!((state.mode === ARCADE || state.mode === TIME_ATTACK) && (match.stage & 0xff) === LAST_STAGE && match.humanCount === 1 && match.ogreChanged === 0 && match.humanLost === 0)) return false;
  const wins = (slot: number): number => state.fighters[slot]!.wins;
  if (wins(match.computerSide) < match.roundsToWin && 0 < wins(match.humanSide)) {
    match.ogreChanged = 1;
    return true;
  }
  return false;
}

/** The round over: the game starts the next round or ends the match, or Ogre changes. */
function endRound(state: FightState): void {
  state.round.flow = Flow.OVER;
  if (ogreChanges(state)) state.round.flow = Flow.TRUE_OGRE;
}

/** The replay has finished. */
const replayDone = (state: FightState): boolean => state.replay.state === ReplayState.ENDED;

/** Every player's input cleared, and read from `source` from now on. */
export function resetInputs(state: FightState, source: number): void {
  for (let i = 0; i < 3; i += 1) {
    clearInput(state, state.fighters[i]!);
    state.input.sources[i] = source;
  }
}

/** The knockout's moment: the shares, the result and the score, the health carried, the closing's wait. */
function knockedOut(state: FightState, data: FightData): void {
  const round = state.round;
  healthShares(state);
  roundResult(state);
  scoreRound(state);
  carryHealth(state, data);
  if (state.match.winner !== 0 && state.mode === ARCADE && ((state.match.humanSides >> (state.match.loserSide & 0x1f)) & 1) !== 0) state.match.humanLost = 1;
  markTimeOut(state);
  state.round.posesDone[0] = 0;
  state.round.posesDone[1] = 0;
  if ((round.result & Result.TIME_UP) === 0) round.left = AFTER_KO;
  else {
    round.left = AFTER_TIME_UP;
    for (let i = 0; i < 3; i += 1) state.input.sources[i] = InputSource.NONE;
  }
  round.flow = Flow.KNOCKED_OUT;
  round.done = 0;
}

/** The closing starts once the replay is over, or the round ends at once if it was skipped. */
function afterReplay(state: FightState, data: FightData): boolean {
  const [a, b] = state.fighters;
  state.noBlendFrames = 2;
  clearSparks(state);
  clearDust(state, data);
  endSoundScript(a);
  endSoundScript(b);
  if (state.match.winner !== 0 || ((humanButtons(state) & START) === 0 && state.replaySkipped === 0)) {
    winnerPoses(state, data);
    if ((state.round.result & Result.TIME_UP) === 0) {
      poseFighter(state, data, a, (s) => startReplayCamera(s, data));
      poseFighter(state, data, b, (s) => startReplayCamera(s, data));
    }
    closingCamera(state, data);
    if ((state.status - Status.FIRST_FINISH) >>> 0 < 2) loserPoses(state, data);
    clearBlends(state);
    keyOffVoices(state, false);
    state.round.flow = Flow.CLOSING_START;
    return true;
  }
  keyOffVoices(state, false);
  endRound(state);
  return false;
}

/** The closing: the winner's pose, or the finishing shot, until done, timed out or skipped. */
function closing(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const round = state.round;
  state.noBlendFrames = 2;
  const frames = round.flowFrames;
  if (state.status === Status.BOTH) {
    if (frames === 0x4b) round.done = 1;
  } else if ((state.status - Status.FIRST_FINISH) >>> 0 < 2) {
    if (frames === (state.mode === Mode.TEKKEN_BALL ? BALL_FINISH : 0x3c)) round.done = 1;
  } else if (state.status === Status.POSES) {
    const finished = (f: Fighter): boolean => f.closing < 1 || moveAt(data, f.move!).length - 1 <= f.frame;
    if (finished(a)) round.posesDone[0] = 1;
    if (finished(b)) round.posesDone[1] = 1;
    if (round.posesDone[0] !== 0 && round.posesDone[1] !== 0) round.done = 1;
  }
  round.left -= 1;
  if (round.left < 0) round.left = 0;
  if ((humanButtons(state) & START) !== 0) keyOffVoices(state, false);
  if (round.done !== 0 || round.left < 1 || (state.match.winner === 0 && state.replaySkipped !== 0 && 1 < round.flowFrames) || (humanButtons(state) & START) !== 0) endRound(state);
}

/**
 * Tekken Ball's knockout: sixteen frames on, the first replay and the finishing shot on the loser
 * (the next round served from its side), the HUD hidden; each replay over, the next until as many
 * as wanted are shown (the knockout's count held meanwhile), then the HUD back.
 */
function ballReplays(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const round = state.round;
  const ball = state.match.ball;
  if (round.flowFrames === BALL_FIRST_REPLAY) {
    ball.replaysShown = 1;
    state.hud.shown = 0;
    round.replayRequest = 1;
    const first = a.outcome < 0;
    const loser = first ? a : b;
    startFinish(state, data, loser, loser.health);
    state.status = first ? Status.FIRST_FINISH : Status.SECOND_FINISH;
    ball.server = first ? 0 : 1;
  } else if (0 < ball.replaysShown) {
    if (!replayDone(state)) {
      round.flowFrames -= 1;
      return;
    }
    clearSparks(state);
    clearDust(state, data);
    endSoundScript(a);
    endSoundScript(b);
    if (ball.replaysShown < ball.replaysWanted) {
      round.replayRequest = 1;
      clearPool(state);
      round.flowFrames -= 1;
      ball.replaysShown += 1;
      state.status = a.outcome < 0 ? Status.FIRST_WINS : Status.SECOND_WINS;
    } else state.hud.shown = 1;
  }
}

/** Tekken Ball's closing, with no replay asked: a loser beaten by a computer left the least health above none, the poses and the closing's camera. */
function ballClosing(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  state.status = Status.BOTH;
  if (a.outcome < 0 && b.computer !== 0) a.health = 1;
  if (b.outcome < 0 && a.computer !== 0) b.health = 1;
  winnerPoses(state, data);
  closingCamera(state, data);
  if ((state.status - Status.FIRST_FINISH) >>> 0 < 2) loserPoses(state, data);
  clearBlends(state);
  state.match.ball.replaysShown += 1;
}

/** A frame of the round's flow. */
export function stepRound(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const round = state.round;
  if (1 < round.flow) round.flowFrames += 1;
  let flow = round.flow;
  if (flow === Flow.OPENING) {
    round.frames += 1;
    if (round.frames < (round.number === 1 ? OPENING_FIRST : OPENING_LATER)) return;
    if (state.mode !== Mode.PRACTICE) resetInputs(state, InputSource.PAD);
    round.flow = Flow.FIGHTING;
    return;
  }
  if (flow === Flow.FIGHTING) {
    round.frames += 1;
    if (state.mode === Mode.TEKKEN_FORCE) state.match.humanLost = 1;
    const over = roundOver(state);
    state.freezeHealth = over ? 1 : 0;
    if (!over) {
      if (state.timerStopped === 0) state.timer -= 1;
      state.match.fightFrames += 1;
      return;
    }
    knockedOut(state, data);
    return;
  }
  if (flow === Flow.KNOCKED_OUT) {
    afterKnockout(state, data, a);
    afterKnockout(state, data, b);
    if (state.mode === Mode.TEKKEN_FORCE) afterKnockout(state, data, state.fighters[2]);
    if (state.mode === Mode.TEKKEN_BALL) ballReplays(state, data);
    if ((round.result & 0x1f) !== 0 && round.flowFrames === 0x5a) round.done = 1;
    if (round.done === 0) return;
    for (let i = 0; i < 3; i += 1) state.input.sources[i] = InputSource.NONE;
    endSoundScript(a);
    endSoundScript(b);
    keyOff(state, 0);
    /* Tekken Force: the player beaten ends the run; the stage cleared fades the music and shows its clear. */
    if (state.mode === Mode.TEKKEN_FORCE) {
      if (a.outcome !== 1) {
        round.flow = Flow.OVER;
        return;
      }
      musicAfterWin(state, 0);
      round.flow = Flow.STAGE_CLEAR;
      round.flowFrames = 0;
      return;
    }
    round.flow = Flow.REPLAY_ASKED;
    flow = Flow.REPLAY_ASKED;
  }
  if (flow === Flow.STAGE_CLEAR) {
    printCall(state, 2, 8, 0x29, 0x70, 'STAGE CLEAR!!');
    if (STAGE_CLEAR_FRAMES <= round.flowFrames || ((humanButtons(state) & START) !== 0 && state.force.skippable !== 0)) round.flow = Flow.OVER;
    state.input.sources[a.slot] = InputSource.REPLAY;
    settleStance(state, data, a);
    return;
  }
  if (flow === Flow.REPLAY_ASKED && state.mode === Mode.TEKKEN_BALL) {
    ballClosing(state, data);
    flow = Flow.CLOSING_START;
  } else if (flow === Flow.REPLAY_ASKED) {
    round.flow = Flow.REPLAYING;
    round.replayRequest = 1;
    return;
  }
  if (flow === Flow.REPLAYING) {
    if (!replayDone(state)) return;
    if (!afterReplay(state, data)) return;
    flow = Flow.CLOSING_START;
  }
  if (flow === Flow.CLOSING_START) {
    round.left = CLOSING;
    round.posesDone[0] = 0;
    round.posesDone[1] = 0;
    round.flowFrames = 0;
    round.done = 0;
    round.flow = Flow.CLOSING;
    if (state.match.healthBackForPoses !== 0) {
      a.health = a.carriedHealth;
      b.health = b.carriedHealth;
    }
    flow = Flow.CLOSING;
  }
  if (flow === Flow.CLOSING) {
    closing(state, data);
    return;
  }
  if (flow === Flow.FORCE_LOAD) {
    round.flow = Flow.FIGHTING;
    return;
  }
  if (flow === Flow.OVER && ogreChanges(state)) round.flow = Flow.TRUE_OGRE;
}

/** A human's start button cuts the replay short (not in practice). */
export function skipReplayIfAsked(state: FightState): void {
  if (state.mode !== Mode.PRACTICE && (humanButtons(state) & START) !== 0) {
    state.replay.skip = 1;
    state.replaySkipped = 1;
  }
}
