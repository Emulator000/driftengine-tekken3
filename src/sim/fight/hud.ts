/**
 * The HUD's state and the announcer. As the round's flow goes the announcer calls the round and
 * "FIGHT!" as it opens, the result after a knockout and the winner after the round's end, and a
 * won match fades the music. The health bars follow each fighter's health: the bar grows back
 * three pixels a frame at a round's start, and the damage just taken drains a sixteenth a frame.
 *
 * Its step also decides what the HUD shows this field, as the original draws it there: the calls
 * as its printer prints them (font, colour, place and text), whether the back (the names, the
 * round marks, the lines under the names, the timer and the bars) is drawn, the timer's value,
 * which round marks are lit and the win streak. The presentation draws them.
 */
import { div, s16 } from '../math/integers.ts';
import { lineAfterVoice } from '../effects/pool.ts';
import { Mode, type FightData, type FightState } from './state.ts';
import { effect, musicAfterWin, voiceLine } from './voices.ts';

/** The round's flow steps the announcer speaks at. */
const Flow = { OPENING: 0, KNOCKED_OUT: 2, WINNER_SHOWN: 6, ROUND_OVER: 9 } as const;
/** The round's result bits. */
const Result = { TIME_UP: 1, DOUBLE_KO: 4, PERFECT: 8, GREAT: 0x10 } as const;
/** Both pads human. */
const BOTH_HUMAN = 3;
/** The code a roster code past the table reads as. */
const LAST_CODE = 0x5c;
const PAST_CODE = 0x58;
/** The printer's fonts: the tiny one, the small one and the calls' big one. */
const Font = { TINY: 0, SMALL: 1, BIG: 2 } as const;
/** A bar's full length in pixels. */
const BAR = 0x98;
/** The roster code with no line of its own, and the sound character whose win line differs. */
const SILENT_CODE = 0x22;
const OTHER_WIN_LINE = 0x15;

/** The announcer's effects: "ROUND", "FINAL ROUND", "FIGHT!", a draw, a human's loss, and a winner. */
const Announcer = { ROUND: 0x103b, FINAL_ROUND: 0x103a, FIGHT: 0x103c, DRAW: 0x1014, YOU_LOSE: 0x1012, WINNER: 0x1011 } as const;
/** The result lines' effects: time up, perfect, double knockout, great and knockout. */
const ResultLine = { TIME_UP: 0x13, PERFECT: 0x19, DOUBLE_KO: 0x15, GREAT: 0x18, KO: 0x1a } as const;

/** A fighter's own win line, unless its roster code has none (then 1). */
function fighterLine(state: FightState, data: FightData, side: number): number {
  const f = state.fighters[side]!;
  if (f.rosterCode === SILENT_CODE) return 1;
  voiceLine(state, data, f.movesetSlot, f.sound === OTHER_WIN_LINE ? 0xc64b : 0xc640, 0);
  return 0;
}

/** The announcer's round number as the round opens (the mode's own in practice), then "FIGHT!". */
function voiceRound(state: FightState, data: FightData): void {
  const round = state.round.number;
  const frames = state.round.frames;
  const at = (first: number, later: number): boolean => frames === (round === 1 ? first : later);
  switch (state.mode) {
    case Mode.TEAM_BATTLE:
    case Mode.SURVIVAL:
      break;
    case Mode.PRACTICE:
      if (at(0x3d, 1)) fighterLine(state, data, state.joined[0] === 0 ? 1 : 0);
      break;
    case Mode.TEKKEN_FORCE:
      throw new Error("Tekken Force's round call is not remade");
    default:
      if (at(0x3d, 1)) effect(state, data, round < state.round.last ? Announcer.ROUND : Announcer.FINAL_ROUND);
      if (at(100, 0x28) && round < state.round.last) effect(state, data, data.sound.roundCalls[round + 1]!);
  }
  if (at(0x96, 0x5a)) effect(state, data, Announcer.FIGHT);
}

/** The announcer's line for the result, on the step's first frame. */
function voiceResult(state: FightState, data: FightData): void {
  if (state.round.flowFrames !== 1) return;
  const result = state.round.result;
  const lines = data.sound.effects;
  let line = lines[ResultLine.TIME_UP]!;
  if ((result & Result.TIME_UP) === 0) {
    line = lines[ResultLine.PERFECT]!;
    if ((result & Result.PERFECT) === 0) {
      line = lines[ResultLine.DOUBLE_KO]!;
      if ((result & Result.DOUBLE_KO) === 0) line = (result & Result.GREAT) !== 0 ? lines[ResultLine.GREAT]! : lines[ResultLine.KO]!;
    }
  }
  voiceLine(state, data, 0, line, 0);
}

/** The announcer and the winner's own line for the round's winner; the music fading after a won match. */
function voiceWinner(state: FightState, data: FightData): void {
  if (state.round.flowFrames !== 1) return;
  const [a, b] = state.fighters;
  let matchWon = state.match.winner !== 0;
  if (a.outcome === b.outcome) effect(state, data, Announcer.DRAW);
  else {
    const winner = b.outcome < a.outcome ? 0 : 1;
    let done = false;
    if (state.humans === BOTH_HUMAN || state.mode === Mode.TEAM_BATTLE) {
      if (fighterLine(state, data, winner) === 0) {
        lineAfterVoice(state);
        done = true;
      }
    } else if (((state.humans >> winner) & 1) === 0) {
      effect(state, data, Announcer.YOU_LOSE);
      if (state.match.goesOn === 0) matchWon = false;
      done = true;
    }
    if (!done) effect(state, data, Announcer.WINNER);
  }
  if (matchWon) musicAfterWin(state, 0);
}

/** A call as the printer prints it: its font, colour number, place (in the screen's units) and text. */
export interface HudPrint {
  readonly font: number;
  readonly colour: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const print = (state: FightState, font: number, colour: number, x: number, y: number, text: string): void => void state.hud.prints.push({ font, colour, x, y, text });

/** A call the game's fight scene prints over the fight (the continue's count, game over, a challenger's arrival), as the HUD's are. */
export const printCall = print;

/** A fighter's name, as its roster code's record spells it. */
function nameOf(state: FightState, data: FightData, side: number): string {
  const code = state.fighters[side]!.rosterCode;
  return data.roster.codes[LAST_CODE < code ? PAST_CODE : code]?.name ?? '';
}

/** "REPLAY" at the top right while a replay plays, lit sixteen frames in every thirty-two. */
export function callReplay(state: FightState): void {
  if ((state.frameCount & 0x10) !== 0) print(state, Font.SMALL, 7, 0xf4, 0x1e, 'REPLAY');
}

/** Nothing shown yet this field (each field's start: the calls the game makes before the fight's frame go with the HUD's). */
export function clearHudView(state: FightState): void {
  const hud = state.hud;
  hud.prints.length = 0;
  hud.back = 0;
  hud.timerShown = 0;
  for (const marks of hud.marksLit) marks.length = 0;
}

/** "ROUND 1" (or the mode's own title) as a round opens, then "READY?". */
function callRound(state: FightState): void {
  const round = state.round.number;
  const frames = state.round.frames;
  const first = round === 1;
  switch (state.mode) {
    case Mode.TEAM_BATTLE:
      print(state, Font.BIG, 8, 0x3f, 0x70, 'TEAM BATTLE');
      break;
    case Mode.SURVIVAL:
      print(state, Font.BIG, 8, 0x13, 0x70, 'SURVIVAL BATTLE');
      break;
    case Mode.PRACTICE:
      print(state, Font.BIG, 8, 0x29, 0x70, 'PRACTICE MODE');
      break;
    case Mode.TEKKEN_FORCE:
      throw new Error("Tekken Force's stage call is not remade");
    default:
      if (state.round.last <= round) print(state, Font.BIG, 8, 0x3f, 0x70, 'FINAL ROUND');
      else if (first ? 0x3d <= frames : 0 < frames) print(state, Font.BIG, 8, 0x6b, 0x70, `ROUND ${(round & 0xf).toString(16).toUpperCase()}`);
  }
  if (first ? frames < 0x6a : frames < 0x2e) return;
  print(state, Font.BIG, 9, 0x76, 0xe4, 'READY?');
}

/** "K.O.", "DOUBLE K.O.", "PERFECT!" or "TIME UP" after a round ends. */
function callResult(state: FightState): void {
  if (state.mode === Mode.TEKKEN_BALL) throw new Error("Tekken Ball's result call is not remade");
  if (state.round.replayRequest !== 0) return;
  const result = state.round.result;
  if ((result & Result.TIME_UP) !== 0) print(state, Font.BIG, 3, 0x6b, 0xe4, 'TIME UP');
  else if ((result & Result.PERFECT) !== 0) print(state, Font.BIG, 2, 0x60, 0xe4, 'PERFECT!');
  else if ((result & Result.DOUBLE_KO) !== 0) print(state, Font.BIG, 1, 0x3f, 0xe4, 'DOUBLE K.O.');
  else print(state, Font.BIG, 1, 0x8c, 0xe4, 'K.O.');
}

/** "DRAW", "YOU WIN!" or "YOU LOSE" for a human, or "<NAME> WINS!" between two (and over an Arcade match's end, WINNER and LOSER). */
function callWinner(state: FightState, data: FightData): void {
  const [a, b] = state.fighters;
  if (a.outcome === b.outcome) {
    print(state, Font.BIG, 6, 0x8c, 0x170, 'DRAW');
    return;
  }
  const loserIsA = a.outcome <= b.outcome;
  const winner = loserIsA ? 1 : 0;
  if (state.humans === BOTH_HUMAN || state.mode === Mode.TEAM_BATTLE) {
    const name = nameOf(state, data, winner);
    print(state, Font.BIG, 4, s16(0xb8 - (name.length * 0xb + 0x42)), 0x170, `${name} WINS!`);
    if (state.match.winner === 0 || state.mode !== Mode.ARCADE) return;
    print(state, Font.SMALL, 9, winner * 0xc4 + 0x2f, 0x68, 'WINNER');
    print(state, Font.SMALL, 9, (loserIsA ? 0 : 1) * 0xc3 + 0x36, 0x68, 'LOSER');
    return;
  }
  if (((state.humans >> winner) & 1) === 0) print(state, Font.BIG, 5, 0x60, 0x170, 'YOU LOSE');
  else print(state, Font.BIG, 4, 0x60, 0x170, 'YOU WIN!');
}

/** The win streak, "WIN:1" or "WINS:12", at the bottom under its side: where it starts by its digits (one win, up to 9, 99, 999) and side. */
const STREAK = { y: 0x1b0, x: [[12, 291], [12, 278], [12, 265], [12, 252]] } as const;

function showStreak(state: FightState): void {
  const wins = state.hud.streak;
  if (wins === 0) return;
  const digits = wins < 2 ? 0 : wins < 10 ? 1 : wins < 100 ? 2 : 3;
  print(state, Font.SMALL, 8, STREAK.x[digits]![state.hud.streakSide !== 0 ? 1 : 0]!, STREAK.y, `${wins < 2 ? 'WIN' : 'WINS'}:${wins}`);
}

/** What a mode shows under a side's name: nothing, who should press start, GAME OVER, the stage and the run's time, the mode's name. */
const Under = { NOTHING: 0, COIN: 1, GAME_OVER: 2, STAGE_TIME: 3, TIME_ATTACK: 5 } as const;
/** Where the lines under the names start across (who should press start is centred on its own place), and their line. */
const UNDER = { x: [19, 208], coinX: [92, 284], y: 0x18 } as const;
/** The match's winner when it is a draw. */
const DRAWN = 3;
/** The most frames the run's time shows (99'59"99). */
const MOST_FRAMES = 359999;

/**
 * What the mode shows under `side`'s name. Arcade, with one human: the stage and the run's time
 * under the human (who should press start once the human has left), under the computer who
 * should press start, nothing while a challenger is coming and GAME OVER once the human lost or
 * is asked to continue; with two, GAME OVER blinking under the loser once the match is decided.
 * Time attack: the stage and time under the human, the mode's name under the other. The demo:
 * who should press start under both.
 */
function underName(state: FightState, side: number): number {
  const match = state.match;
  switch (state.mode) {
    case Mode.ARCADE:
      if (match.humanCount === 1) {
        if (side === match.humanSide) return state.joined[side] !== 0 ? Under.STAGE_TIME : Under.COIN;
        if (match.continuing === 0 && match.humanLost === 0) return match.challenger === 0 ? Under.COIN : Under.NOTHING;
        return Under.GAME_OVER;
      }
      if (match.humanCount === 2 && match.winner !== 0 && match.winner !== DRAWN && match.loserSide === side && (state.vsyncSeen & 0x18) !== 0) return Under.GAME_OVER;
      return Under.NOTHING;
    case Mode.TIME_ATTACK:
      if (side === match.humanSide) return state.joined[side] !== 0 ? Under.STAGE_TIME : Under.COIN;
      return Under.TIME_ATTACK;
    case Mode.DEMO:
      return Under.COIN;
    case Mode.VERSUS:
    case Mode.PRACTICE:
      return Under.NOTHING;
    default:
      throw new Error(`mode ${state.mode}'s line under a name is not remade`);
  }
}

/** Who should press start, blinking, alternating every 64 frames with the credits (both pads are in, here). */
function showCoinLine(state: FightState, data: FightData, side: number): void {
  const vsync = state.vsyncSeen;
  if ((vsync & 0x30) === 0) return;
  const line = (vsync & 0x40) === 0 ? data.lines.coin[side === 0 ? 1 : 2]! : data.lines.credit[0]!;
  print(state, Font.TINY, 5, UNDER.coinX[side]! - line.half, UNDER.y, line.text);
}

/** "STAGE n" (past the ninth, blinking with "FINAL") and the run's time as minutes, seconds and hundredths. */
function showStageTime(state: FightState, x: number): void {
  const y = UNDER.y;
  const stage = state.match.stage + 1;
  const frames = Math.min((state.match.fightFrames + state.match.totalTime) >>> 0, MOST_FRAMES);
  const two = (n: number): string => String(n).padStart(2, '0');
  print(state, Font.TINY, 7, x, y, stage < 10 || (state.vsyncSeen & 0x20) !== 0 ? `STAGE${String(stage).padStart(2, ' ')}` : ' FINAL');
  print(state, Font.TINY, 5, x + 0x5c, y - 2, "'");
  print(state, Font.TINY, 5, x + 0x75, y - 2, '"');
  const seconds = Math.trunc(frames / 60);
  print(state, Font.TINY, 5, x + 0x4b, y, two(Math.trunc(seconds / 60)));
  print(state, Font.TINY, 5, x + 99, y, two(seconds % 60));
  print(state, Font.TINY, 5, x + 0x7d, y, two(Math.trunc(((frames % 60) * 100) / 60)));
}

function showUnderNames(state: FightState, data: FightData): void {
  for (let side = 0; side < 2; side += 1) {
    const x = UNDER.x[side]!;
    switch (underName(state, side)) {
      case Under.COIN:
        showCoinLine(state, data, side);
        break;
      case Under.GAME_OVER:
        print(state, Font.TINY, 2, x + 0x20, UNDER.y, 'GAME OVER');
        break;
      case Under.STAGE_TIME:
        showStageTime(state, x);
        break;
      case Under.TIME_ATTACK:
        print(state, Font.TINY, 6, x, UNDER.y, '  TIME ATTACK');
        break;
    }
  }
}

/** The back's timer value, round marks (the latest won blinking until the next round) and the lines under the names. */
function showBack(state: FightState, data: FightData): void {
  const hud = state.hud;
  hud.back = 1;
  if (state.mode === Mode.DEMO) print(state, Font.SMALL, 2, 0x7e, 0x104, 'GAME OVER');
  /* Team Battle draws its own marks, not remade, and none of these. */
  if (state.mode !== Mode.TEAM_BATTLE) {
    for (const marks of hud.marksLit) marks.length = 0;
    for (let side = 0; side < 2; side += 1) {
      const wins = state.fighters[side]!.wins;
      for (let i = 0; i < state.match.roundsToWin; i += 1) {
        const blinking = i === wins - 1 && hud.marksShown[side] !== wins && (state.vsyncSeen & 0x10) !== 0;
        hud.marksLit[side]!.push(i < wins && !blinking ? 1 : 0);
      }
    }
  }
  showUnderNames(state, data);
  hud.timerShown = state.timerStopped === 0 ? div(state.timer + 0x3b, 0x3c) : -1;
}

/** Each side's bar toward its fighter's health. */
function stepBars(state: FightState): void {
  for (let side = 0; side < 2; side += 1) {
    const f = state.fighters[side]!;
    const bar = state.hud.bars[side]!;
    let target = bar.target;
    const was = bar.shown;
    const trail = bar.damage;
    if (bar.seen !== f.health) {
      bar.seen = f.health;
      const unit = div(f.maxHealth, BAR);
      target = div(f.health - 1 + unit, unit);
    }
    if (BAR < target) target = BAR;
    let damage = was < trail ? trail - ((trail - was + 0xf) >> 4) : was;
    const shown = target <= was || target < was + 3 ? target : was + 3;
    if (damage < shown) damage = shown;
    bar.target = s16(target);
    bar.shown = s16(shown);
    bar.damage = s16(damage);
  }
}

/** The calls and the announcer as the round's flow calls for them, then the back: its timer and marks, and the bars. */
export function stepHud(state: FightState, data: FightData): void {
  if (state.nothingDrawn !== 0) return;
  if (state.attract === 0 && state.match.challenger === 0) {
    switch (state.round.flow) {
      case Flow.OPENING:
        if (state.round.frames !== 0) {
          callRound(state);
          voiceRound(state, data);
        }
        break;
      case Flow.KNOCKED_OUT:
        if (state.mode !== Mode.TEKKEN_FORCE || (state.round.result & Result.TIME_UP) !== 0) {
          callResult(state);
          if (state.pause.requested === 0) voiceResult(state, data);
        }
        break;
      case Flow.WINNER_SHOWN:
      case Flow.ROUND_OVER:
        if (state.mode === Mode.TEKKEN_FORCE || state.mode === Mode.PRACTICE) break;
        callWinner(state, data);
        if (state.match.winner === 0 && state.replaySkipped !== 0 && state.pause.requested === 0) break;
        voiceWinner(state, data);
        break;
    }
  }
  if (state.hud.shown === 0) return;
  if (state.match.showsStreak !== 0) showStreak(state);
  if (state.mode === Mode.TEKKEN_FORCE) throw new Error("Tekken Force's HUD is not remade");
  showBack(state, data);
  stepBars(state);
}
