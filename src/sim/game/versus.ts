/**
 * The versus screen (scene 0xb), between choosing and fighting: the mode lays out what it draws (a
 * portrait and a name a side, the line between them, the stage's line, a band of colour and the
 * background), the portraits and names slide in over eight frames, the lines show once they are
 * in, and the scene goes on to the one the mode asked for.
 */
import type { FightTables } from '../fight/match.ts';
import type { SceneTables } from '../data/scenes.ts';
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
/** The band's line. */
const BAND_Y = 0x24;
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
function name(tables: FightTables, scenes: SceneTables, side: number, code: number): VersusRecord {
  const text = tables.roster.codes[Math.min(code, LAST_CODE)]?.name ?? '';
  const place = scenes.versus.names[side]!;
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

/**
 * Arcade's, versus's or the demo's layout: each side's portrait and name, the line between them,
 * the stage's line (versus's match, the demo's own), the band and background (the two-player one
 * with two humans, and always in versus).
 */
function layOut(game: GameState, tables: FightTables, scenes: SceneTables): VersusRecord[] {
  const world = game.world;
  const codes = [0, 1].map((side) => (game.entrants.roster[side]! << 2) | game.entrants.costume[side]!);
  const picture = world.match.humanCount !== 1 || world.mode === MenuMode.VERSUS ? 1 : 0;
  let stageLine: string;
  if (world.mode === MenuMode.DEMO) stageLine = scenes.versus.demoStage;
  else if (world.mode === MenuMode.VERSUS) stageLine = scenes.versus.fight.replace('%d', String(game.run.versusMatches + 1));
  else if (world.mode === MenuMode.ARCADE || world.mode === MenuMode.TIME_ATTACK) stageLine = scenes.versus.stage.replace('%d', String(world.match.stage + 1));
  else throw new Error(`mode ${world.mode}'s versus layout is not remade`);
  const band = scenes.versus.bands[world.mode === MenuMode.DEMO ? 1 : picture]!;
  return [
    portrait(game, scenes, 0, codes[0]!),
    name(tables, scenes, 0, codes[0]!),
    portrait(game, scenes, 1, codes[1]!),
    name(tables, scenes, 1, codes[1]!),
    { kind: 'text', text: scenes.versus.versus, ...VERSUS_LINE },
    { kind: 'text', text: stageLine, ...STAGE_LINE },
    { kind: 'band', colour: band.colour, width: band.width, y: BAND_Y },
    { kind: 'background', picture: world.mode === MenuMode.DEMO ? 1 : picture },
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
      versus.records.splice(0, versus.records.length, ...layOut(game, tables, scenes));
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
