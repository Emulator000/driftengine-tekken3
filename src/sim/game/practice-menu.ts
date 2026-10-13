/**
 * Practice's menus over the paused fight: MODE SELECT (1P FREESTYLE, VS CPU, COMBO TRAINING,
 * PLAYER SELECT, RESET), then the chosen mode's own: up and down pick a line (wrapping), left
 * and right change its value, a button or start does what the line does. Each in a dark blue box
 * with a grey edge, the picked line in its own colour.
 */
import { commandListsFor } from '../fight/pause-menu.ts';
import { voiceLine } from '../fight/voices.ts';
import { draw, tile } from './draw.ts';
import { Dummy, MANUAL_REPLAY, Partner, PracticeMode, type PracticeData } from './practice.ts';
import { clearEntries, comboCount, loadCombo, resetPlayback } from './practice-recorder.ts';
import { print } from './printer.ts';
import type { GameState } from './state.ts';

/** The items lines can be, by id. */
const Item = {
  CANCEL: 0,
  ATTACK_DATA: 1,
  COUNTER_ATTACKS: 2,
  HIT_ANALYSIS: 3,
  COMBO_REPLAY: 4,
  COMMAND_LIST: 7,
  CPU_DIFFICULTY: 9,
  CPU_LEVEL: 0xa,
  TRAINING_DUMMY: 0xd,
  RETURN: 0xe,
  COMBO_PLAYER: 0xf,
  COMBO_TYPE: 0x10,
} as const;

const UP = 0x1000;
const DOWN = 0x4000;
const LEFT = 0x8000;
const RIGHT = 0x2000;
const LEFT_RIGHT = 0xa000;
/** Start, select or a button: what a line's choice takes. */
const CONFIRM = 0x9f0;
const Sound = { MOVE: 0x546c, CHOOSE: 0x4ceb } as const;
const MENU_WAIT = 3;
/** The flows practice's way out asks for: the character select, the mode menu. */
const Flow = { PLAYER_SELECT: 9, RESET: 0xb } as const;
/** The menu's places: MODE SELECT's left, a mode's left, the lines' tops, the column values end at, the big font's line. */
const MODE_SELECT = { x: 0x10, titleY: 0x38, lines: [0x6e, 0x84, 0x9a, 0xb0, 0xc6] } as const;
const MENU = { x: 0x48, titleY: 0x38, end: 0x19 } as const;
const LINES: readonly (readonly number[])[] = [
  [0x6e, 0x84, 0xa2, 0xce, 0xe4, 0xfa, 0x110, 0x148],
  [0x6e, 0x84, 0xa2, 0xb8, 0xce, 0xe4, 0xfa, 0x148],
  [0x6e, 0x84, 0xa2, 0xb8, 0xce, 0xe4, 0xfa, 0x148],
];
const DUMMY_VALUE_Y = 0xb8;
const COMBO_NAME_X = 0xcf;
const NONE_X = 0x105;
/** The line colours: the picked one, the rest. */
const PICKED = 10;
const OTHER = 0xb;
const ADVANCE = 9;
/** The boxes: MODE SELECT's and a mode's, their grey edge and dark blue inside. */
const BOX = { modeSelect: { x: 7, y: 0x26, w: 0xae, h: 0xc4 }, mode: { x: 0x3f, y: 0x26, w: 0xf2, h: 0x140 }, edge: 0xe0e0e0, inside: 0x301000 } as const;
/** The last code with a name of its own, and the one past it reads. */
const LAST_CODE = 0x5c;
const PAST_CODE = 0x58;

const sound = (game: GameState, data: PracticeData, code: number): void => voiceLine(game.world, data.match, 0, code, 0);

/** A value stepped by the pad's repeating up and down, wrapping within 0 to `most`. */
function stepped(game: GameState, data: PracticeData, value: number, most: number): number {
  const repeats = game.practice.pad.repeats;
  let v = value;
  if ((repeats & DOWN) !== 0) v += 1;
  else if ((repeats & UP) !== 0) v -= 1;
  if (v !== value) sound(game, data, Sound.MOVE);
  return v < 0 ? most : most < v ? 0 : v;
}

/** The cursor: MODE SELECT's mode (each mode's own set up as it is picked), or the mode's line. */
function menuCursor(game: GameState, data: PracticeData): void {
  const p = game.practice;
  if (p.modeSelect === 0) {
    p.cursor[p.mode] = stepped(game, data, p.cursor[p.mode]!, 7);
    return;
  }
  const was = p.mode;
  p.mode = stepped(game, data, p.mode, 4);
  if (p.mode === was) return;
  const reset = (): void => {
    Object.assign(p, { session: 0, commandList: 0, comboType: 0 });
    resetPlayback(p, p.humanSide);
    clearEntries(p, p.humanSide);
  };
  if (p.mode === PracticeMode.FREESTYLE) {
    p.attackData = 1;
    p.player = p.humanSide;
    reset();
    p.look = 1;
  } else if (p.mode === PracticeMode.VS_CPU) {
    p.counterAttacks = 0;
    p.comboReplay = 0;
    p.player = p.humanSide;
    reset();
    p.look = 1;
  } else if (p.mode === PracticeMode.COMBO) {
    Object.assign(p, { player: p.humanSide, counterAttacks: 0, comboReplay: 0, inputShown: 1, session: 0, commandList: 0, dummy: Dummy.STAND, comboType: 0 });
    resetPlayback(p, p.player);
    clearEntries(p, p.player);
    p.look = 2;
  }
}

/** MODE SELECT's choice: a mode's menu, the character select, or the mode menu. */
function modeSelectAction(game: GameState, data: PracticeData): void {
  const p = game.practice;
  if ((p.pad.fresh & CONFIRM) === 0) return;
  if (p.mode <= PracticeMode.COMBO) {
    p.modeSelect = 0;
    p.cursor.fill(0);
    p.cancelLabel = 0;
    p.menuWait = MENU_WAIT;
    if (p.mode === PracticeMode.COMBO) {
      Object.assign(p, { player: p.humanSide, comboType: 0, session: 1, inputShown: 1, look: 1 });
      clearEntries(p, p.player);
      resetPlayback(p, p.player);
      loadCombo(p, game.world, data.scenes.practice, p.player, 0);
    }
    sound(game, data, Sound.CHOOSE);
  } else if (p.mode === PracticeMode.PLAYER_SELECT) {
    game.world.round.flow = Flow.PLAYER_SELECT;
    sound(game, data, Sound.CHOOSE);
  } else game.world.round.flow = Flow.RESET;
}

/** A value stepped by right and left (both may count in one frame), wrapping within 0 to `most`. */
function across(game: GameState, data: PracticeData, value: number, most: number): number {
  const fresh = game.practice.pad.fresh;
  let v = value;
  if ((fresh & RIGHT) !== 0) {
    v += 1;
    sound(game, data, Sound.MOVE);
  }
  if ((fresh & LEFT) !== 0) {
    v -= 1;
    sound(game, data, Sound.MOVE);
  }
  return v < 0 ? most : most < v ? 0 : v;
}

/** A mode's line's choice or change, by its item. */
function modeAction(game: GameState, data: PracticeData): void {
  const p = game.practice;
  const world = game.world;
  const tables = data.scenes.practice;
  const confirm = (p.pad.fresh & CONFIRM) !== 0;
  const sideways = (p.pad.fresh & LEFT_RIGHT) !== 0;
  const item = tables.items[p.mode]![p.cursor[p.mode]!]!;
  let jump = false;
  const toggle = (key: 'attackData' | 'counterAttacks' | 'hitAnalysis'): void => {
    if (confirm) jump = true;
    else if (sideways) {
      p[key] ^= 1;
      p.cancelLabel = 0;
      sound(game, data, Sound.MOVE);
    }
  };
  switch (item) {
    case Item.CANCEL:
      if (confirm) {
        world.pause.released = 1;
        p.keyOffOnPause = 1;
      }
      break;
    case Item.ATTACK_DATA:
      toggle('attackData');
      break;
    case Item.COUNTER_ATTACKS:
      toggle('counterAttacks');
      break;
    case Item.HIT_ANALYSIS:
      toggle('hitAnalysis');
      break;
    case Item.COMBO_REPLAY:
      if (confirm) jump = true;
      else if (sideways) {
        p.comboReplay = across(game, data, p.comboReplay, p.mode === PracticeMode.COMBO ? 3 : MANUAL_REPLAY);
        p.cancelLabel = 0;
      }
      break;
    case Item.COMMAND_LIST:
      if (confirm) {
        p.commandList ^= 1;
        p.menuWait = MENU_WAIT;
        if (p.commandList !== 0) world.pauseMenu.wait = MENU_WAIT;
        else {
          p.cancelLabel = 0;
          p.cursor.fill(0);
        }
      }
      if (p.commandList !== 0) commandListsFor(world, data.match, p.partnerKind === Partner.CONTROLLER ? (1 << p.humanSide) | (1 << p.partnerSide) : 1 << p.humanSide);
      break;
    case Item.CPU_DIFFICULTY:
      if (confirm) jump = true;
      else if (sideways) {
        p.cpuDifficulty = across(game, data, p.cpuDifficulty, 2);
        p.cancelLabel = 0;
      }
      break;
    case Item.CPU_LEVEL:
      if (confirm) jump = true;
      else if (sideways) {
        p.cpuLevel = across(game, data, p.cpuLevel, 9);
        p.cancelLabel = 0;
      }
      break;
    case Item.TRAINING_DUMMY:
      if (confirm) jump = true;
      else if (sideways) {
        p.dummy = across(game, data, p.dummy, 8);
        p.cancelLabel = 0;
      }
      break;
    case Item.RETURN:
      if (confirm) {
        p.modeSelect = 1;
        p.menuWait = MENU_WAIT;
        if (p.mode === PracticeMode.COMBO) {
          clearEntries(p, p.player);
          resetPlayback(p, p.player);
        }
      }
      break;
    case Item.COMBO_PLAYER:
      if (confirm) jump = true;
      else if (sideways) {
        p.player = (p.player + 1) & 1;
        p.comboType = 0;
        clearEntries(p, p.player);
        resetPlayback(p, p.player);
        loadCombo(p, world, tables, p.player, p.comboType);
        p.cancelLabel = 0;
        sound(game, data, Sound.MOVE);
      }
      break;
    case Item.COMBO_TYPE:
      if (confirm) jump = true;
      else {
        let changed = false;
        if ((p.pad.fresh & RIGHT) !== 0) {
          p.comboType += 1;
          changed = true;
        }
        if ((p.pad.fresh & LEFT) !== 0) {
          p.comboType -= 1;
          changed = true;
        }
        const n = comboCount(tables, world.fighters[p.player]!.character);
        if (p.comboType < 0) {
          if (n !== 0) p.comboType = n - 1;
        } else if (n - 1 < p.comboType) p.comboType = 0;
        if (changed) {
          clearEntries(p, p.player);
          resetPlayback(p, p.player);
          loadCombo(p, world, tables, p.player, p.comboType);
          p.cancelLabel = 0;
          sound(game, data, Sound.MOVE);
        }
      }
      break;
  }
  if (jump) p.cursor[p.mode] = 0;
}

/** A line with arrows where its `u` and `d` are, in a printer colour. */
export function arrowLine(game: GameState, text: string, x: number, y: number, colour: number): void {
  [...text].forEach((ch, i) => {
    if (ch === 'u' || ch === 'd') draw(game, { kind: 'arrow', x: x + i * ADVANCE, y, down: ch === 'd', colour, layer: 7 });
  });
  print(game, 0, colour, x, y, text.replace(/[ud]/g, ' '));
}

/** A value ending at the menu's value column. */
function value(game: GameState, text: string, y: number, colour: number): void {
  print(game, 0, colour, (MENU.end - text.length) * ADVANCE + MENU.x, y, text);
}

/** The menu's box, edge under inside. */
function menuBox(game: GameState): void {
  const box = game.practice.modeSelect !== 0 ? BOX.modeSelect : BOX.mode;
  tile(game, box.x + 1, box.y + 2, box.w - 2, box.h - 4, BOX.inside, 0);
  tile(game, box.x, box.y, box.w, box.h, BOX.edge, 0);
}

/** The menu's lines, the picked one in its colour. */
function menuText(game: GameState, data: PracticeData): void {
  const p = game.practice;
  const tables = data.scenes.practice;
  const values = tables.values;
  const lines = tables.lines;
  const picked = p.modeSelect !== 0 ? p.mode : p.cursor[p.mode]!;
  const colour = (line: number): number => (line === picked ? PICKED : OTHER);
  if (p.modeSelect !== 0) {
    print(game, 1, PICKED, MODE_SELECT.x, MODE_SELECT.titleY, lines.modeSelect);
    lines.modes.forEach((text, i) => print(game, 0, colour(i), MODE_SELECT.x, MODE_SELECT.lines[i]!, text));
    return;
  }
  const y = LINES[p.mode]!;
  const label = (line: number, text: string): void => void print(game, 0, colour(line), MENU.x, y[line]!, text);
  const onOff = (line: number, text: string, on: number): void => {
    label(line, text);
    value(game, values.onOff[on]!, y[line]!, colour(line));
  };
  print(game, 1, PICKED, MENU.x, MENU.titleY, p.mode === PracticeMode.VS_CPU ? lines.vsCpu : lines.modes[p.mode]!);
  label(0, values.okCancel[p.cancelLabel]!);
  label(1, lines.commandList);
  if (p.mode === PracticeMode.FREESTYLE) {
    label(2, lines.trainingDummy);
    if (p.dummy === Dummy.ROLL_BACK || p.dummy === Dummy.ROLL_FORWARD) {
      const text = tables.arrows[p.dummy === Dummy.ROLL_BACK ? 0 : 1]!;
      arrowLine(game, text, (MENU.end - text.length) * ADVANCE + MENU.x, DUMMY_VALUE_Y, colour(2));
    } else value(game, values.dummies[p.dummy]!, DUMMY_VALUE_Y, colour(2));
    onOff(3, lines.counterAttacks, p.counterAttacks);
    onOff(4, lines.attackData, p.attackData);
    onOff(5, lines.hitAnalysis, p.hitAnalysis);
    label(6, lines.comboReplay);
    value(game, values.replays[p.comboReplay]!, y[6]!, colour(6));
  } else {
    if (p.mode === PracticeMode.VS_CPU) {
      label(2, lines.cpuDifficulty);
      value(game, values.difficulties[p.cpuDifficulty]!, y[2]!, colour(2));
      label(3, lines.cpuLevel);
      value(game, values.stages[p.cpuLevel]!, y[3]!, colour(3));
    } else {
      label(2, lines.comboPlayer.replace('%d', String(p.player + 1)));
      const code = game.world.fighters[p.player]!.rosterCode;
      print(game, 0, colour(2), COMBO_NAME_X, y[2]!, data.match.roster.codes[LAST_CODE < code ? PAST_CODE : code]?.name ?? '');
      label(3, lines.comboType);
      if (comboCount(tables, game.world.fighters[p.player]!.character) === 0) print(game, 0, colour(3), NONE_X, y[3]!, lines.none);
      else value(game, values.numbers[p.comboType] ?? '', y[3]!, colour(3));
    }
    onOff(4, lines.attackData, p.attackData);
    onOff(5, lines.hitAnalysis, p.hitAnalysis);
    label(6, lines.comboReplay);
    value(game, values.replays[p.comboReplay]!, y[6]!, colour(6));
  }
  label(7, lines.returnToModeSelect);
}

/** Practice's menu a paused frame: its box and lines (not over the command lists), its cursor, its line's action. */
export function practiceMenu(game: GameState, data: PracticeData): void {
  const p = game.practice;
  if (p.commandList === 0) {
    menuBox(game);
    menuText(game, data);
    menuCursor(game, data);
  }
  if (p.modeSelect !== 0) modeSelectAction(game, data);
  else modeAction(game, data);
}
