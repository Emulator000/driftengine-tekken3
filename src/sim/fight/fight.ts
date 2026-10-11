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
import { blankFightState } from './blank.ts';
import { easePulls, followThrower, keepInBounds, markTargets, measureHandTravel, measurePairs, measureTravel, pushApart, rememberRoot, setPushRadii, targetOf, updateThrowCarry } from './body.ts';
import { startReplayCamera, stepCamera, stepReplayCamera, stepShake } from './camera.ts';
import { chooseMoves, chooseReactions } from './cancel.ts';
import { computerInput } from './computer.ts';
import { checkPause, replayIfAsked, replayWholeFrame, skipReplayIfAsked, stepReplay, stepRound } from './flow.ts';
import { assignRoles, countThrows, firstAndSecond, rememberFrames, rememberRoundFrames } from './frame.ts';
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
import { Mode, type FightData, type FightState } from './state.ts';
import { hitVibration } from './vibration.ts';

/** A quick match: the stage and entrants, and the computer's difficulty and the arcade stage it is tuned by. */
export interface QuickMatch extends MatchSetup {
  readonly difficulty?: number;
  readonly arcadeStage?: number;
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
    if (flow === 7) throw new Error("the pause menu's quit is not remade");
    if (flow < 9) return;
    if (flow === 10) throw new Error('the continue screen is not remade');
    if (flow === 0xb) throw new Error("a match's eleventh flow step is not remade");
    if (state.mode === Mode.PRACTICE) throw new Error("practice's end is not remade");
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
  if (state.mode === Mode.TEKKEN_FORCE) throw new Error("Tekken Force's frame is not remade");
  assignRoles(state);
  if (state.nothingDrawn === 0) checkPause(state);
  state.liveFrame = 1;
  const replayCamera = (s: FightState): void => startReplayCamera(s, data);
  if (state.pause.paused === 0 && state.pause.frozen === 0) {
    replayIfAsked(state, data);
    state.replaying = stepReplay(state, data);
    stepRound(state, data);
    if (state.replaying === 0) live(state, data);
    else {
      state.liveFrame = replayWholeFrame(state);
      skipReplayIfAsked(state);
      stepReplayCamera(state, data);
      stepShake(state, data);
      layArena(state, data);
      poseFighters(state, data, replayCamera);
      stepScenery(state, data);
      elementalMove(state, data, a, state.liveFrame);
      elementalMove(state, data, b, state.liveFrame);
      stepPool(state, data, state.liveFrame);
      hitVibration(state, data);
      replayEvents(state, data, state.liveFrame);
    }
  } else if (state.replaying === 0) {
    stepHud(state, data);
    layArena(state, data);
    poseFighters(state, data, replayCamera);
    stepScenery(state, data);
    stepPool(state, data, 0);
    if (state.match.challenger === 0 && state.mode !== Mode.PRACTICE) pauseMenu(state, data, state.pause.frozen);
    stepDust(state, data, 0);
    drawSparks(state, 0);
    readInput(state, a, data, computerInput);
    readInput(state, b, data, computerInput);
    punchPairs(state, a);
  } else {
    layArena(state, data);
    poseFighters(state, data, replayCamera);
    stepScenery(state, data);
    stepPool(state, data, 0);
    replayEvents(state, data, 0);
  }
  return (state.round.flow << 16) >> 16;
}

/** The live frame, in the original's order. */
function live(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
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
  measurePairs(state, data, 2);
  moveBody(state, data, a, targetOf(state, a));
  moveBody(state, data, b, targetOf(state, b));
  rememberRoot(state, a);
  rememberRoot(state, b);
  poseFighters(state, data, (s) => startReplayCamera(s, data));
  keepInBounds(state, data, a, targetOf(state, a));
  keepInBounds(state, data, b, targetOf(state, b));
  updateThrowCarry(state);
  followThrower(state);
  easePulls(state);
  stepScenery(state, data);
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
  markTargets(state, 2);
  if (state.status < 3) pushApart(state, data, a, b);
  clearHits(a);
  clearHits(b);
  detectHit(state, data, first, second);
  detectHit(state, data, second, first);
  measureHandTravel(a);
  measureHandTravel(b);
  chooseReactions(state, data);
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
  rememberRoundFrames(state);
}
