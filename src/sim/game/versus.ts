/**
 * The versus screen (scene 0xb), between choosing and fighting: the mode lays out what it draws (a
 * portrait and a name a side, the line between them, the stage's line, a band of colour and the
 * background; in Tekken Force the human's alone, with the mode's line, the stage's and the stage's
 * name), the portraits and names slide in over eight frames, the lines show once they are in, and
 * the scene goes on to the one the mode asked for.
 */
import type { FightTables } from '../fight/match.ts';
import type { SceneTables, VersusPlace } from '../data/scenes.ts';
import { holdPicture } from './logo.ts';
import { MenuMode } from './menu.ts';
import { print } from './printer.ts';
import { lookOf } from './select.ts';
import type { GameState, VersusRecord } from './state.ts';

/** The slide's frames. */
const SLIDE = 8;
/** A name's letters' advance in the big font, the edges it keeps inside, the screen's width. */
const NAME = { advance: 21, left: 12, right: 0x165, font: 3, colour: 8 } as const;
const SCREEN_WIDTH = 0x170;
/** The line between the portraits, and the stage's line: their colours, fonts and places. */
const VERSUS_LINE = { colour: 0, font: 2, x: 0xa2, y: 0xfa } as const;
const STAGE_LINE = { colour: 6, font: 1, x: 0x1c, y: 0x2a } as const;
/** The band's line, and Survival's band. */
const BAND_Y = 0x24;
const SURVIVAL_BAND = 3;
const TEAM_BAND = 2;
/** The roster codes past which a character reads the empty code's record. */
const LAST_CODE = 0x58;

/** A side's portrait: its character's light, whether it faces the other way (mirrored for the second side), its place and slide. */
function portrait(game: GameState, scenes: SceneTables, side: number, code: number): VersusRecord {
  const look = lookOf(scenes, code >>> 2, code & 3);
  const flipped = ((look & 0xff) >> 5) & 1;
  const place = scenes.versus.portraits[side]!;
  return { kind: 'portrait', side, code, colour: look >>> 8, flipped: side === 0 ? flipped : flipped ^ 1, ...place };
}

/** A side's name in the big font: left-aligned at its x, or right-aligned at minus it, kept within the screen, sliding in from beyond its edge. */
function name(tables: FightTables, scenes: SceneTables, side: number, code: number, place: VersusPlace = scenes.versus.names[side]!): VersusRecord {
  const text = tables.roster.codes[Math.min(code, LAST_CODE)]?.name ?? '';
  const width = text.length * NAME.advance;
  let left = place.x;
  let right: number;
  if (left < 0) {
    right = -left;
    left = right - width;
  } else right = left + width;
  if (left < NAME.left) left = NAME.left;
  if (!(right < NAME.right)) left = left + NAME.right - 1 - right;
  const slideX = place.slideX === 0 ? 0 : 0 < place.slideX ? SCREEN_WIDTH - left : -(left + width);
  return { kind: 'name', text, colour: NAME.colour, font: NAME.font, x: left, y: place.y, slideX, slideY: place.slideY };
}

/** Practice's band under the names, and Tekken Ball's. */
const PRACTICE_BAND = 4;
const BALL_BAND = 5;

/**
 * A mode's layout: each side's portrait and name, the line between them, the stage's line
 * (versus's match, Survival's fight by its wins, the demo's own, Practice's and Tekken Ball's
 * names), the band and background (the two-player one with two humans, and always in versus;
 * Survival's, Practice's and Tekken Ball's bands their own).
 */
function layOut(game: GameState, tables: FightTables, scenes: SceneTables): VersusRecord[] {
  const world = game.world;
  const codes = [0, 1].map((side) => (game.entrants.roster[side]! << 2) | game.entrants.costume[side]!);
  let picture = world.match.humanCount !== 1 || world.mode === MenuMode.VERSUS ? 1 : 0;
  let band = picture;
  let stageLine: string;
  if (world.mode === MenuMode.DEMO) {
    stageLine = scenes.versus.demoStage;
    picture = 1;
    band = 1;
  } else if (world.mode === MenuMode.VERSUS) stageLine = scenes.versus.fight.replace('%d', String(game.run.versusMatches + 1));
  else if (world.mode === MenuMode.SURVIVAL) {
    stageLine = scenes.versus.fight.replace('%d', String(world.match.survivalWins + 1));
    picture = 0;
    band = SURVIVAL_BAND;
  } else if (world.mode === MenuMode.ARCADE || world.mode === MenuMode.TIME_ATTACK) stageLine = scenes.versus.stage.replace('%d', String(world.match.stage + 1));
  else if (world.mode === MenuMode.PRACTICE) {
    stageLine = scenes.practice.lines.title;
    picture = 0;
    band = PRACTICE_BAND;
  } else if (world.mode === MenuMode.TEKKEN_BALL) {
    stageLine = tables.ball.title;
    band = BALL_BAND;
  } else throw new Error(`mode ${world.mode}'s versus layout is not remade`);
  const { colour, width } = scenes.versus.bands[band]!;
  return [
    portrait(game, scenes, 0, codes[0]!),
    name(tables, scenes, 0, codes[0]!),
    portrait(game, scenes, 1, codes[1]!),
    name(tables, scenes, 1, codes[1]!),
    { kind: 'text', text: scenes.versus.versus, ...VERSUS_LINE },
    { kind: 'text', text: stageLine, ...STAGE_LINE },
    { kind: 'band', colour, width, y: BAND_Y },
    { kind: 'background', picture },
  ];
}

/** The names, sliding while the countdown runs, and once it is over the lines. */
function drawVersus(game: GameState): void {
  const countdown = game.versus.countdown;
  for (const record of game.versus.records) {
    if (record.kind === 'name') print(game, record.font, record.colour, record.x + ((countdown * record.slideX) >> 3), record.y + ((countdown * record.slideY) >> 3), record.text);
    else if (record.kind === 'text' && countdown === 0) print(game, record.font, record.colour, record.x, record.y, record.text);
  }
}

/** The icons' box: each icon's width with the line between, and its height. */
const TEAM_BOX = { across: 0x21, h: 0x3e } as const;
/** No character: an icon not yet shown. */
const NO_CHARACTER = 0x58;

/**
 * A team's row on the versus screen: the members still to come after the one sent in (those
 * drawn but not chosen not yet shown), then those beaten, dimmed, each an icon sliding in from a
 * step's eight widths away; a box behind them.
 */
function teamRow(game: GameState, scenes: SceneTables, side: number): VersusRecord[] {
  const team = game.world.match.teams[side]!;
  const place = scenes.versus.teamIcons[side]!;
  const size = Math.min(team.size, 8);
  let x = size === 8 ? place.xOfEight : place.x;
  const records: VersusRecord[] = [];
  const shown = Math.max(team.chosen, team.next + 1);
  const icon = (k: number): void => {
    if (k === team.next) return;
    const code = k < shown ? Math.min(team.members[k]!, NO_CHARACTER) : NO_CHARACTER;
    records.push({ kind: 'teamIcon', code, beaten: k < team.next, x, y: place.y, slideX: place.step << 3, slideY: 0 });
    x += place.step;
  };
  for (let k = team.next; k < size; k += 1) icon(k);
  for (let k = 0; k < team.next; k += 1) icon(k);
  if (1 < size) {
    const boxX = (size === 8 ? place.xOfEight : place.x) - 1 + (side !== 0 ? (size - 2) * place.step : 0);
    records.push({ kind: 'teamBox', x: boxX, y: place.y - 2, w: (size - 1) * TEAM_BOX.across + 1, h: TEAM_BOX.h });
  }
  return records;
}

/** Team Battle's layout: each team's row, each side's portrait and name in its own places, the line between them, the bout's line, the light behind the rows, the band and background. */
function layOutTeams(game: GameState, tables: FightTables, scenes: SceneTables): VersusRecord[] {
  const world = game.world;
  const codes = [0, 1].map((side) => (game.entrants.roster[side]! << 2) | game.entrants.costume[side]!);
  const picture = world.match.humanCount !== 1 ? 1 : 0;
  const records: VersusRecord[] = [];
  for (const side of [0, 1]) {
    records.push(...teamRow(game, scenes, side));
    records.push({ ...portrait(game, scenes, side, codes[side]!), ...scenes.versus.teamPortraits[side]! } as VersusRecord);
    const placed = name(tables, scenes, side, codes[side]!, scenes.versus.teamNames[side]!);
    records.push(placed);
  }
  const { colour, width } = scenes.versus.bands[TEAM_BAND]!;
  records.push(
    { kind: 'text', text: scenes.versus.versus, ...VERSUS_LINE },
    { kind: 'text', text: scenes.versus.fight.replace('%d', String(game.run.team.bout + 1)), ...STAGE_LINE },
    { kind: 'teamLight' },
    { kind: 'band', colour, width, y: BAND_Y },
    { kind: 'background', picture },
  );
  return records;
}

/** Tekken Force's lines: the mode's, the stage's, and the stage's name's second line below its first. */
const FORCE_TITLE = { colour: 6, font: 1, x: 0x1c, y: 0x2a } as const;
const FORCE_STAGE = { colour: 6, font: 1, x: 0x20, y: 0x54 } as const;
const FORCE_NAME_LINE = 0x2e;
const FORCE_BAND = 6;
/** Tekken Force's last stage, which is named apart. */
const FINAL_STAGE = 4;

/**
 * Tekken Force's layout: the human's portrait and name in the mode's own places (the other side's
 * portrait not shown), the mode's line, the stage's (FINAL STAGE for the last), the stage's name in
 * its colour in two lines right-aligned, sliding in from the right, the mode's band and the
 * one-player background.
 */
function layOutForce(game: GameState, tables: FightTables, scenes: SceneTables): VersusRecord[] {
  const world = game.world;
  const force = tables.force.versus;
  const stage = world.match.stage;
  const side = world.match.force.side !== 0 ? 1 : 0;
  const code = (game.entrants.roster[side]! << 2) | game.entrants.costume[side]!;
  const lines = force.names[stage]!.map(
    (text, k): VersusRecord => ({ kind: 'name', text, colour: force.colours[stage]!, font: NAME.font, x: force.stageName.x - text.length * NAME.advance, y: force.stageName.y + k * FORCE_NAME_LINE, slideX: force.stageName.slideX, slideY: force.stageName.slideY }),
  );
  const { colour, width } = scenes.versus.bands[FORCE_BAND]!;
  return [
    { ...portrait(game, scenes, side, code), ...force.portrait },
    name(tables, scenes, side, code, force.name),
    { kind: 'text', text: force.title, ...FORCE_TITLE },
    { kind: 'text', text: stage < FINAL_STAGE ? force.stage.replace('%d', String(stage + 1)) : force.finalStage, ...FORCE_STAGE },
    ...lines,
    { kind: 'band', colour, width, y: BAND_Y },
    { kind: 'background', picture: 0 },
  ];
}

/** Each mode's layout. */
function layOutMode(game: GameState, tables: FightTables, scenes: SceneTables): VersusRecord[] {
  if (game.world.mode === MenuMode.TEAM_BATTLE) return layOutTeams(game, tables, scenes);
  if (game.world.mode === MenuMode.TEKKEN_FORCE) return layOutForce(game, tables, scenes);
  return layOut(game, tables, scenes);
}

/** Scene 0xb: the picture let go, the layout and its pictures, the slide, a last frame, then the scene the mode asked for. */
export function versusScene(game: GameState, tables: FightTables, scenes: SceneTables): void {
  const versus = game.versus;
  let draw = false;
  switch (game.step) {
    case 0:
      holdPicture(game, 0);
      game.step = 1;
      break;
    case 1: {
      versus.records.splice(0, versus.records.length, ...layOutMode(game, tables, scenes));
      const background = versus.records.find((r) => r.kind === 'background');
      if (background?.kind === 'background') game.versusBackground = scenes.versus.backgrounds[background.picture]!;
      for (const record of versus.records) if (record.kind === 'portrait') game.versusPortraits[record.side] = lookOf(scenes, record.code >>> 2, record.code & 3) & 0x1f;
      versus.countdown = SLIDE;
      game.step = 2;
      break;
    }
    case 2:
      draw = true;
      versus.countdown -= 1;
      if (versus.countdown < 1) game.step = 3;
      break;
    case 3:
      draw = true;
      game.step = 4;
      break;
    case 4:
      game.scene = game.run.after.scene;
      game.step = game.run.after.step;
      break;
  }
  if (draw) drawVersus(game);
}
