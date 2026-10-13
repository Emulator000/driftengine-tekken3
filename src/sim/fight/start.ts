/**
 * A round's start: its number and the timer, the flow and the pause cleared, the replay recording
 * from the start of its ring, the effects and sparks cleared, the computer players' records reset,
 * each fighter back on its side of the arena at full health in the round's opening move, the bars
 * empty to fill as the round opens, and the stage's song.
 */
import { measurePairs } from './body.ts';
import { clearDust, clearSparks, startEvents } from '../effects/sparks.ts';
import { resetPool } from '../effects/pool.ts';
import { clench } from './hands.ts';
import { clearHits } from './hits.ts';
import { clearInput } from './input.ts';
import { clearShoves, startBallRound } from './ball.ts';
import { drawMokujin } from './match.ts';
import { endSoundScript, startRound } from './move.ts';
import { ReplayState } from './replay.ts';
import { resetComputers } from './computer.ts';
import { InputSource, Mode, type FightData, type FightState, type Fighter } from './state.ts';
import { keyOffVoices, playSong } from './voices.ts';

const MOKUJIN = 0xf;
const OGRE_AND_TRUE_OGRE = 0xe;
/** Where a fighter starts a round: a metre to its side, facing the other. */
const START_X = 1000;
const START_SCREEN_X = 100;
/** The joints' heights a round starts with: the hips' and the chest's. */
const HIPS_HEIGHT = -0x41b;
const CHEST_HEIGHT = -0x591;
/** A distance a fighter starts measuring from. */
const FAR = 1000;
/** Each slot's push weight. */
const PUSH_WEIGHT = 100;
/** Frames the blend is held off after a round's start. */
const NO_BLEND = 0x14;
const HAND_SPEED = 10;
/** The replay's start before anything to replay. */
const NO_KNOCKOUT = -2;

/**
 * A fighter at the round's start on its side of the arena, facing the other (or, not `fresh`,
 * where it stands and as it faces), its state cleared and its health full.
 */
export function resetFighter(state: FightState, data: FightData, f: Fighter, opponent: Fighter, fresh = true): void {
  const side = (f.slot << 24) >> 24;
  f.opponent = opponent.slot;
  const x = fresh ? (side === 0 ? -START_X : START_X) : f.position[0]!;
  const z = fresh ? 0 : f.position[2]!;
  const facing = fresh ? (side === 0 ? 0x4000 : -0x4000) : f.facing;
  f.targetDz = FAR;
  f.targetDx = FAR;
  f.targetDistance = FAR;
  f.measuredRoot[0] = f.position[0]!;
  f.measuredRoot[1] = f.position[2]!;
  startRound(state, data, f, opponent);
  f.facing = facing;
  f.position[0] = x;
  f.position[1] = 0;
  f.position[2] = z;
  f.tilt.x = 0;
  f.tilt.z = 0;
  f.heading = facing;
  f.facingOffSize = facing & 0xffff;
  f.screenX = side === 0 ? -START_SCREEN_X : START_SCREEN_X;
  const joints = f.skeleton.joints;
  joints[2]!.world.translation[1] = CHEST_HEIGHT;
  joints[1]!.world.translation[1] = HIPS_HEIGHT;
  const root = f.skeleton.base.translation;
  root[0] = x;
  root[2] = z;
  for (const joint of [joints[2]!, joints[1]!]) {
    joint.world.translation[0] = x;
    joint.world.translation[2] = z;
  }
  f.push.fill(0);
  const kept = f.carriedHealth;
  f.health = state.match.healthBackForPoses !== 0 && kept !== 0 && kept <= f.maxHealth ? kept : f.maxHealth;
  f.loops = -1;
  f.healthShare = 0;
  f.frozen = 0;
  f.inArc = 0;
  f.stunned = 0;
  f.arc.fill(0);
  f.outcome = 0;
  f.closing = 0;
  f.untouchable = 0;
  f.pushFrames = 0;
  f.stepFrames = 0;
  f.turnFrames = 0;
  f.turnStep = 0;
  f.mash = 0;
  f.stunFrames = 0;
  f.repeats = 0;
  f.repeatWindow = 0;
  f.recovery = 0;
  f.hold = 0;
  f.ownDamage = 0;
  f.pressure = 0;
  f.eventAmount = 0;
  f.dash.state = 0;
  f.bufferOpen = 0;
  f.beingHit = 0;
  f.holds.fill(0);
  f.damageKind = 0;
  f.watchingPunchPairs = 0;
  f.hitFreeze = 0;
  f.blendOutBlocked = 0;
  f.throwPlain = 0;
  f.airborne = 0;
  f.counterHit = 0;
  f.fromBehind = 0;
  f.guarded = 0;
  f.hitClean = 0;
  f.knockedOut = 0;
  f.inAir = 0;
  f.rootCorrection = 0;
  f.slideTo = 0;
  f.turnByMove = 0;
  f.pushImmune = 0;
  f.throwing = 0;
  f.lookFixed = 0;
  f.sideHeld = 0;
  f.present = 1;
  f.blend.length = 0;
  f.blend.position = 0;
  f.blend.weight = 0;
  f.blend.rootDelta.fill(0);
  clearHits(f);
  f.bestHit = 0;
  endSoundScript(f);
  sizeHitSpheres(data, f);
  clench(data, f, HAND_SPEED);
  for (let i = 0; i < 3; i += 1) f.lastRoot[i] = root[i]!;
}

/** Tekken Force's final stage, where the player and Dr. B start this far either side of the middle. */
const FORCE_FINAL_STAGE = 4;
const FORCE_APART = 1000;

/** A fighter's hit spheres sized for its roster. */
export function sizeHitSpheres(data: FightData, f: Fighter): void {
  const radii = data.roster.hitRadii[data.roster.rowOf(f.roster)]!;
  f.hitSpheres.forEach((sphere, i) => {
    sphere.radius = radii[i]!;
    sphere.radiusSquared = Math.imul(radii[i]!, radii[i]!);
  });
}

/** Every player's input cleared, and read from `source` from now on. */
function resetInputs(state: FightState, source: number): void {
  for (let i = 0; i < 3; i += 1) {
    clearInput(state, state.fighters[i]!);
    state.input.sources[i] = source;
  }
}

/**
 * A round starts (in the attract's intro the replay does not record). A Tekken Force stage's: the
 * timer set only on the first stage (later ones go on with what is left), all three fighters at
 * the middle facing on (on the final stage the player and Dr. B apart), the enemies out of play,
 * its three gauges cleared.
 */
export function startRoundOfMatch(state: FightState, data: FightData): void {
  const [a, b, c] = state.fighters;
  const force = state.mode === Mode.TEKKEN_FORCE;
  const round = state.round;
  round.frames = 0;
  round.framesSeen = 0;
  round.number += 1;
  if (!force || state.match.stage === 0) state.timer = (state.options.roundTime + 2) * 600;
  state.freezeHealth = 0;
  state.status = 0;
  state.pause.paused = 0;
  state.pause.requested = 0;
  state.pause.last = 0;
  state.pause.frozen = 0;
  resetInputs(state, InputSource.NONE);
  round.result = 0;
  state.camera.attractStarted = 0;
  state.knockoutReplay = 0;
  state.replaySkipped = 0;
  state.replaying = 0;
  state.throwsUnderway = 0;
  round.flow = 0;
  round.posesDone.fill(0);
  round.flowFrames = 0;
  state.sound.mokujinHits.fill(0);
  if (a.roster === MOKUJIN || b.roster === MOKUJIN) drawMokujin(state, data);
  state.sparks.next = 0;
  resetPool(state);
  for (const f of force ? [a, b, c] : [a, b]) state.tracks[f.slot] = (f.roster - OGRE_AND_TRUE_OGRE) >>> 0 < 2 ? 1 : 0;
  const replay = state.replay;
  replay.state = ReplayState.RECORDING;
  replay.recordFrame = 0;
  replay.playFrame = 0;
  replay.knockoutStart = NO_KNOCKOUT;
  replay.soundShift = 0;
  replay.index = 0;
  replay.skip = 0;
  replay.recorded = 0;
  if (state.attractIntro !== 0) replay.state = 0;
  a.blend.kind = 0;
  b.blend.kind = 0;
  if (force) c.blend.kind = 0;
  state.noBlendFrames = NO_BLEND;
  keyOffVoices(state, round.number !== 1);
  state.pushWeights.fill(PUSH_WEIGHT);
  clearSparks(state);
  startEvents(state);
  clearDust(state, data);
  state.hitFlash.fill(0);
  clearInput(state, a);
  clearInput(state, b);
  if (force) {
    clearInput(state, c);
    const apart = FORCE_FINAL_STAGE <= state.match.stage ? FORCE_APART : 0;
    for (const f of [a, b, c]) {
      f.position[0] = f === a ? -apart : apart;
      f.position[2] = 0;
      f.facing = 0x4000;
    }
    resetFighter(state, data, a, b, false);
    resetFighter(state, data, b, a, false);
    resetFighter(state, data, c, a, false);
    for (const f of [b, c]) {
      f.present = 0;
      f.pushImmune = 1;
    }
  } else {
    resetFighter(state, data, a, b);
    resetFighter(state, data, b, a);
  }
  if (state.mode === Mode.TEKKEN_BALL) {
    resetFighter(state, data, c, a);
    c.counterWindow = 1;
  }
  measurePairs(state, data, force ? 3 : 2);
  state.camera.replay.active = 0;
  resetComputers(state, data);
  if (force) for (const bar of state.hud.forceBars) Object.assign(bar, { seen: 0, target: 0, shown: 0, trail: 0 });
  else {
    for (const bar of state.hud.bars) {
      bar.seen = 0;
      bar.target = 0;
      bar.shown = 0;
      bar.damage = 0;
    }
  }
  state.hud.marksShown[0] = a.wins & 0xff;
  state.hud.marksShown[1] = b.wins & 0xff;
  state.flash.left = 0;
  state.flash.pull.fill(0);
  round.replayRequest = 0;
  if (state.mode === Mode.TEKKEN_BALL) {
    clearShoves(state);
    startBallRound(state, data);
  }
  playSong(state, state.stageSong, false);
}

/** The game's own steps around a round's start: the overhead shot off, and after it the HUD shown (not in practice) and the match's flags cleared. */
export function startRoundOfGame(state: FightState, data: FightData): void {
  state.overhead = 0;
  startRoundOfMatch(state, data);
  state.hud.shown = state.mode !== Mode.PRACTICE ? 1 : 0;
  state.match.humanLost = 0;
  state.match.challenger = 0;
}
