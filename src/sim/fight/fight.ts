/**
 * A fight as the game runs it, a field at a time: the field's start (the sounds asked for last
 * field reach the voices, the counters and the frame's seed step, the pads are read), the game's
 * steps around the rounds (the picture held twice between them, then each round's start), and the
 * fight's frame: its phases in the original's order, live, during a replay, or paused.
 *
 * `Fight.quick` sets a match up as the menus leave a versus match (two rounds to win, the shortest
 * time, the pause on, the handicaps at their middle) and starts it; when the match is won, the
 * same match starts over.
 */
import { elementalMove, stepPool } from '../effects/pool.ts';
import { drawSparks, replayEvents, stepDust, stepSparks } from '../effects/sparks.ts';
import { layArena, stepScenery } from './arena.ts';
import { ballFrame, ballShoves, stepBackdrop } from './ball.ts';
import { blankFightState } from './blank.ts';
import { easePulls, followThrower, keepInBounds, markTargets, measureHandTravel, measurePairs, measureTravel, pushApart, rememberRoot, setPushRadii, targetOf, updateThrowCarry } from './body.ts';
import { passWallPush, wallSplats } from './walls.ts';
import { startReplayCamera, stepCamera, stepReplayCamera, stepShake } from './camera.ts';
import { chooseMoves, chooseReactions } from './cancel.ts';
import { computerInput } from './computer.ts';
import { checkPause, replayIfAsked, replayWholeFrame, skipReplayIfAsked, stepReplay, stepRound } from './flow.ts';
import { assignRoles, countThrows, firstAndSecond, forceRoles, rememberFrames, rememberRoundFrames } from './frame.ts';
import { forceStageFrame } from './force-stage.ts';
import { applyHits, clearHits, clearOutcome, detectHit, placeSpheres, rememberSweep } from './hits.ts';
import { clearHudView, stepHud } from './hud.ts';
import { punchPairs, readInput, updateSide } from './input.ts';
import { startQuickMatch, type MatchSetup } from './match.ts';
import { stepMoves } from './move.ts';
import { moveEvents } from './move-events.ts';
import { moveSounds } from './move-sounds.ts';
import { moveBody } from './movement.ts';
import { pauseMenu } from './pause-menu.ts';
import { poseFighters } from './pose.ts';
import { startRoundOfGame } from './start.ts';
import { Mode, type FightData, type FightState, type Fighter } from './state.ts';
import { rotateLong } from '../math/matrix.ts';
import { hitVibration } from './vibration.ts';

/** A quick match: the stage and entrants, the computer's difficulty and the arcade stage it is tuned by, and whether the remake's walls stand (none by default). */
export interface QuickMatch extends MatchSetup {
  readonly difficulty?: number;
  readonly arcadeStage?: number;
  readonly walls?: number;
}

/** The game's steps around the fight: the picture held, shown again, a round starting, fighting. */
const Step = { HOLD: 5, SHOW: 6, ROUND_START: 7, FIGHTING: 8 } as const;
type Step = (typeof Step)[keyof typeof Step];
const VERSUS = 1;
/** The fight's picture: its centre on the screen and the distance to it. */
const SCREEN = { x: 192 << 16, y: 240 << 16, distance: 500 };
/** The VABs the fighters' banks open in, none loaded at the start. */
const NO_BANK = 0xff;
const FIGHTER_VABS = [2, 3];
/** The quick match's options: rounds to win less one, the time setting, versus handicaps. */
const QUICK = { rounds: 1, roundTime: 2, handicap: 3 } as const;
/** Frames the game waits into a round before a new challenger may join. */
const JOIN_WAIT = 8;
const VOICES = 0x18;
const PAD_UP_DOWN = 0x5000;
const PAD_LEFT_RIGHT = 0xa000;
/** The round's flow while Tekken Force's boss is loaded. */
const FORCE_LOAD = 7;

/** The sounds asked for since the last field reach the voices: each voice keyed as its last command says, a key-on that cannot play leaving it be. */
export function flushSound(state: FightState, data: Pick<FightData, 'banks'>): void {
  const sound = state.sound;
  for (const command of sound.commands) {
    if (command.key === 'off') {
      if (command.voice < VOICES) sound.voices[command.voice]!.keyed = 0;
      continue;
    }
    if (command.key !== 'on' || command.voice >= VOICES) continue;
    const bank =
      command.bank < 2 ? data.banks.effects[command.bank] : command.bank === 2 && sound.theater !== 0 ? data.banks.theater : sound.vabs[command.bank] === NO_BANK ? undefined : data.banks.fighters[sound.vabs[command.bank]!];
    if (bank === undefined || command.program >= bank.firstTones.length) continue;
    const tone = bank.tones[bank.firstTones[command.program]! * 16 + ((command.tone << 24) >> 24)];
    if (tone === undefined || tone.vag === 0) continue;
    Object.assign(sound.voices[command.voice]!, { keyed: 1, keyedAt: (state.frameCount + 1) >>> 0, bank: command.bank, program: command.program, tone: command.tone, note: command.note });
  }
  sound.commands.length = 0;
  sound.musicSeen = 0;
  state.vibrations.length = 0;
}

/** The pads read: each one's raw bits, mapped to the game's (opposite directions cancel), held and newly pressed. */
function readPads(state: FightState, raw: readonly [number, number]): void {
  const input = state.input;
  for (let pad = 0; pad < 2; pad += 1) {
    let mapped = raw[pad]!;
    if ((mapped & PAD_UP_DOWN) === PAD_UP_DOWN) mapped &= 0xafff;
    if ((mapped & PAD_LEFT_RIGHT) === PAD_LEFT_RIGHT) mapped &= 0x5fff;
    input.pads.pressed[pad] = (mapped ^ input.pads.held[pad]!) & mapped;
    input.pads.held[pad] = mapped;
    input.fresh[pad] = (input.rawPads[pad]! ^ raw[pad]!) & raw[pad]!;
    input.rawPads[pad] = raw[pad]!;
  }
}

export class Fight {
  readonly state: FightState;
  readonly data: FightData;
  private readonly setup: QuickMatch;
  private step: Step = Step.HOLD;
  /** Whether the picture is held (from the match's set-up, on the hold step until the show step): its buffers do not flip. */
  private held = 1;
  private wait = 0;

  private constructor(state: FightState, data: FightData, setup: QuickMatch) {
    this.state = state;
    this.data = data;
    this.setup = setup;
  }

  /** A versus match set up as the menus leave it, its humans those the computer does not play, and started. */
  static quick(data: FightData, setup: QuickMatch): Fight {
    const state = blankFightState();
    const [a, b, c] = state.fighters;
    a.movesetSlot = 0;
    b.movesetSlot = 1;
    c.movesetSlot = 1;
    a.slot = 0;
    b.slot = 1;
    c.slot = 2;
    state.screen.offsetX = SCREEN.x;
    state.screen.offsetY = SCREEN.y;
    state.screen.distance = SCREEN.distance;
    for (const vab of FIGHTER_VABS) state.sound.vabs[vab] = NO_BANK;
    state.mode = VERSUS;
    state.options.rounds = QUICK.rounds;
    state.options.roundTime = QUICK.roundTime;
    state.options.handicaps.fill(QUICK.handicap);
    state.options.walls = setup.walls ?? 0;
    state.match.canPause = 1;
    state.computer.difficulty = setup.difficulty ?? 0;
    state.computer.arcadeStage = setup.arcadeStage ?? 0;
    const home = data.roster.codes.find((code) => code.stage === setup.stage);
    if (home !== undefined) state.stageSong = home.song;
    state.joined[0] = setup.entrants[0].computer ? 0 : 1;
    state.joined[1] = setup.entrants[1].computer ? 0 : 1;
    const humans = (state.joined[0] !== 0 ? 1 : 0) | (state.joined[1] !== 0 ? 2 : 0);
    state.match.humanCount = (humans & 1) + (humans >> 1);
    state.match.humanSides = humans;
    state.humans = humans;
    state.match.humanSide = humans === 2 ? 1 : 0;
    state.match.computerSide = humans === 1 ? 1 : 0;
    startQuickMatch(state, data, setup);
    return new Fight(state, data, setup);
  }

  /** One field: its start, then the game's step around the fight. */
  field(raw: readonly [number, number]): void {
    const state = this.state;
    flushSound(state, this.data);
    clearHudView(state);
    state.pauseMenu.drawn = 0;
    state.vsyncSeen = (state.vsyncSeen + 1) >>> 0;
    state.frameSeed = Math.imul(state.frameSeed + 1, 0x10dcd) >>> 0;
    state.nothingDrawn = 0;
    state.posed = 0;
    readPads(state, raw);
    state.frameCount = (state.frameCount + 1) >>> 0;
    if (this.held === 0) state.drawBuffer ^= 1;
    this.gameStep();
  }

  private gameStep(): void {
    switch (this.step) {
      case Step.HOLD:
        this.held = 1;
        this.step = Step.SHOW;
        return;
      case Step.SHOW:
        this.held = 0;
        this.step = Step.ROUND_START;
        return;
      case Step.ROUND_START:
        startRoundOfGame(this.state, this.data);
        this.wait = JOIN_WAIT;
        this.step = Step.FIGHTING;
        return;
      case Step.FIGHTING:
        this.fighting();
        return;
    }
  }

  /** A frame of the fight, then the match's next step at the round's end. */
  private fighting(): void {
    const state = this.state;
    if (this.wait !== 0) this.wait -= 1;
    state.nothingDrawn = 0;
    const flow = fightFrame(state, this.data);
    state.nothingDrawn = 0;
    if (flow === 7) throw new Error("Tekken Force's step 7 is not a quick match's");
    if (flow < 9) return;
    if (flow === 10) throw new Error("Ogre's change into True Ogre is Arcade's, not a quick match's");
    if (flow === 0xb) throw new Error("practice's way out is not a quick match's");
    if (state.mode === Mode.PRACTICE) throw new Error('practice is never a quick match');
    if (state.match.winner === 0) {
      this.step = Step.HOLD;
      return;
    }
    startQuickMatch(state, this.data, this.setup);
    this.step = Step.HOLD;
  }
}

/** The fight's frame: the roles, the pause, then live, a replay's, or paused. Returns the round's flow step. */
export function fightFrame(state: FightState, data: FightData): number {
  const [a, b] = state.fighters;
  if (state.mode === Mode.TEKKEN_FORCE) return forceFrame(state, data);
  assignRoles(state);
  if (state.nothingDrawn === 0) checkPause(state);
  state.liveFrame = 1;
  const replayCamera = (s: FightState): void => startReplayCamera(s, data);
  const ball = state.mode === Mode.TEKKEN_BALL;
  if (state.pause.paused === 0 && state.pause.frozen === 0) {
    replayIfAsked(state, data);
    state.replaying = stepReplay(state, data);
    stepRound(state, data);
    if (state.replaying === 0) live(state, data);
    else {
      state.liveFrame = replayWholeFrame(state);
      skipReplayIfAsked(state);
      if (ball) stepCamera(state, data);
      else stepReplayCamera(state, data);
      stepShake(state, data);
      layArena(state, data);
      poseFighters(state, data, replayCamera);
      scenery(state, data);
      elementalMove(state, data, a, state.liveFrame);
      elementalMove(state, data, b, state.liveFrame);
      stepPool(state, data, state.liveFrame);
      hitVibration(state, data);
      replayEvents(state, data, state.liveFrame);
      if (ball) ballFrame(state, data);
    }
  } else if (state.replaying === 0) {
    stepHud(state, data);
    layArena(state, data);
    poseFighters(state, data, replayCamera);
    scenery(state, data);
    stepPool(state, data, 0);
    if (ball) ballFrame(state, data);
    if (state.match.challenger === 0 && state.mode !== Mode.PRACTICE) pauseMenu(state, data, state.pause.frozen);
    stepDust(state, data, 0);
    drawSparks(state, 0);
    readInput(state, a, data, computerInput);
    readInput(state, b, data, computerInput);
    punchPairs(state, a);
  } else {
    layArena(state, data);
    poseFighters(state, data, replayCamera);
    scenery(state, data);
    stepPool(state, data, 0);
    replayEvents(state, data, 0);
  }
  return (state.round.flow << 16) >> 16;
}

/** The stage's scenery stepped, in Tekken Ball the beach's backdrop, in Tekken Force the backdrop's scroll (the eye across the view) on a drawn frame. */
function scenery(state: FightState, data: FightData): void {
  if (state.mode === Mode.TEKKEN_FORCE) {
    if (state.nothingDrawn !== 0) return;
    const eye = state.camera.drawn.eye;
    const v = [0, 0, 0];
    rotateLong(state.view.rotation, eye[0]!, eye[1]!, eye[2]!, v);
    state.force.scroll = v[0]!;
  } else if (state.mode !== Mode.TEKKEN_BALL) stepScenery(state, data);
  else if (state.nothingDrawn === 0) stepBackdrop(state);
}

/**
 * Tekken Force's frame: the player, its target and the other enemy chosen, the pause, then live or
 * paused, the stage's frame after either (its boss asked for on the live frame's flow).
 */
function forceFrame(state: FightState, data: FightData): number {
  const [a, b, c] = state.fighters;
  const roles = forceRoles(state, data);
  if (state.nothingDrawn === 0) checkPause(state);
  state.liveFrame = 1;
  if (state.pause.paused === 0 && state.pause.frozen === 0) {
    replayIfAsked(state, data);
    state.replaying = stepReplay(state, data);
    stepRound(state, data);
    if (state.replaying === 0) liveForce(state, data, roles);
  } else if (state.replaying === 0) {
    stepHud(state, data);
    layArena(state, data);
    poseFighters(state, data, (s) => startReplayCamera(s, data));
    scenery(state, data);
    stepPool(state, data, 0);
    forceStageFrame(state, data);
    if (state.match.challenger === 0) pauseMenu(state, data, state.pause.frozen);
    stepDust(state, data, 0);
    drawSparks(state, 0);
    state.input.lastRecorded.fill(0);
    for (const f of [a, b, c]) readInput(state, f, data, computerInput);
    punchPairs(state, a);
  }
  return (state.round.flow << 16) >> 16;
}

/** Tekken Force's live frame, in the original's order: the three fighters, the two enemies hitting each other too, the stage's frame last. */
function liveForce(state: FightState, data: FightData, [p, t, o]: readonly [Fighter, Fighter, Fighter]): void {
  const fighters = state.fighters;
  const [a, b, c] = fighters;
  stepHud(state, data);
  stepCamera(state, data);
  updateSide(p, t);
  updateSide(t, p);
  updateSide(o, p);
  stepShake(state, data);
  layArena(state, data);
  for (const f of fighters) rememberSweep(state, f);
  stepMoves(state, data);
  countThrows(state);
  measurePairs(state, data, 3);
  for (const f of fighters) moveBody(state, data, f, targetOf(state, f));
  for (const f of fighters) rememberRoot(state, f);
  poseFighters(state, data, (s) => startReplayCamera(s, data));
  for (const f of fighters) keepInBounds(state, data, f, targetOf(state, f));
  updateThrowCarry(state);
  followThrower(state);
  easePulls(state);
  scenery(state, data);
  elementalMove(state, data, a, 1);
  elementalMove(state, data, b, 1);
  stepPool(state, data, state.liveFrame);
  hitVibration(state, data);
  for (const f of fighters) measureTravel(f);
  for (const f of fighters) placeSpheres(state, data, f);
  for (const f of fighters) setPushRadii(data, f);
  markTargets(state, 3);
  if (state.status < 3) {
    pushApart(state, data, a, b);
    pushApart(state, data, a, c);
    pushApart(state, data, b, c);
  }
  for (const f of fighters) clearHits(f);
  detectHit(state, data, p, t);
  detectHit(state, data, t, p);
  detectHit(state, data, p, o);
  detectHit(state, data, o, p);
  detectHit(state, data, t, o);
  detectHit(state, data, o, t);
  for (const f of fighters) measureHandTravel(f);
  chooseReactions(state, data);
  for (const f of fighters) moveEvents(state, data, f);
  for (const f of fighters) clearOutcome(f);
  for (const f of fighters) applyHits(state, data, f);
  for (const f of fighters) if (f.present !== 0) moveSounds(state, data, f, targetOf(state, f));
  if ((state.status - 6) >>> 0 >= 2) {
    stepSparks(state);
    stepDust(state, data, 1);
  }
  state.input.lastRecorded.fill(0);
  for (const f of fighters) readInput(state, f, data, computerInput);
  for (const f of fighters) punchPairs(state, f);
  rememberFrames(state);
  chooseMoves(state, data);
  rememberRoundFrames(state);
  if (forceStageFrame(state, data) !== 0) state.round.flow = FORCE_LOAD;
}

/** The live frame, in the original's order. */
function live(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  const ball = state.mode === Mode.TEKKEN_BALL;
  const [first, second] = firstAndSecond(state);
  stepHud(state, data);
  stepCamera(state, data);
  updateSide(first, second);
  updateSide(second, first);
  stepShake(state, data);
  layArena(state, data);
  rememberSweep(state, a);
  rememberSweep(state, b);
  stepMoves(state, data);
  countThrows(state);
  if (ball) {
    ballShoves(state, a);
    ballShoves(state, b);
  }
  measurePairs(state, data, 2);
  moveBody(state, data, a, targetOf(state, a));
  moveBody(state, data, b, targetOf(state, b));
  rememberRoot(state, a);
  rememberRoot(state, b);
  if (ball) rememberRoot(state, state.fighters[2]!);
  poseFighters(state, data, (s) => startReplayCamera(s, data));
  keepInBounds(state, data, a, targetOf(state, a));
  keepInBounds(state, data, b, targetOf(state, b));
  updateThrowCarry(state);
  followThrower(state);
  easePulls(state);
  scenery(state, data);
  elementalMove(state, data, a, 1);
  elementalMove(state, data, b, 1);
  stepPool(state, data, state.liveFrame);
  hitVibration(state, data);
  measureTravel(a);
  measureTravel(b);
  placeSpheres(state, data, a);
  placeSpheres(state, data, b);
  setPushRadii(data, a);
  setPushRadii(data, b);
  markTargets(state, ball ? 3 : 2);
  if (state.status < 3) {
    pushApart(state, data, a, b);
    passWallPush(state, a, b);
  }
  clearHits(a);
  clearHits(b);
  detectHit(state, data, first, second);
  detectHit(state, data, second, first);
  measureHandTravel(a);
  measureHandTravel(b);
  chooseReactions(state, data);
  if (ball) ballFrame(state, data);
  moveEvents(state, data, a);
  moveEvents(state, data, b);
  clearOutcome(a);
  clearOutcome(b);
  applyHits(state, data, a);
  applyHits(state, data, b);
  if (a.present !== 0) moveSounds(state, data, a, targetOf(state, a));
  if (b.present !== 0) moveSounds(state, data, b, targetOf(state, b));
  if ((state.status - 6) >>> 0 >= 2) {
    stepSparks(state);
    stepDust(state, data, 1);
  }
  readInput(state, a, data, computerInput);
  readInput(state, b, data, computerInput);
  punchPairs(state, a);
  punchPairs(state, b);
  rememberFrames(state);
  chooseMoves(state, data);
  wallSplats(state, data);
  rememberRoundFrames(state);
}
