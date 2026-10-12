/**
 * The credits after an ending. After a wait, the Theater's sound; then its song (the disc's audio
 * track); once it is heard, a second's wait; "THE KING OF IRON FIST TOURNAMENT 3" and "TEKKEN 3"
 * over a band of light whose colour runs from the warm (253, 219, 182) to black, held, then
 * faded; then the staff roll, the remake's line among the blank ones it opens with: the list's
 * lines (each led by its kind: 0 a heading in the small type, 1 a name in the large, 2 a blank
 * line, 3 and 4 a heading as Tekken Ball is earned or not, 5 a name once Anna's third costume is)
 * climbing a line and a half a field, each glowing in as it rises from the foot of the screen and
 * out as it reaches the top. The list's end holds the roll
 * still: its headings glow on a while, flare up and darken, and the roll waits for the song's end,
 * then shows the namco mark, fading in and out. A button cuts it short.
 *
 * Each frame's draws (lines of type, bands of light, the mark) are the presentation's to draw.
 */
import type { CreditsTables } from '../data/scenes.ts';
import type { FightData, FightState } from '../fight/state.ts';
import { playSong, resetMusic, voiceLine } from '../fight/voices.ts';
import { songStarting, syncMusic } from '../sound/music.ts';
import type { CreditsState, GameState } from './state.ts';

/** The buttons that cut the roll short: start and the four. */
const SKIP_BUTTONS = 0x8f0;
/** The Theater's sound the roll opens with (the first side's bank, VAB 2 the Theater's), and its song. */
const OPENING_SOUND = 0xc7c0;
const SONG = 4;
/** Anna's third costume, among the costumes earned. */
const ANNA_THIRD = 0x40000;
/** The remake's line, a heading in place of one of the blank lines the staff roll opens with, before the game's own staff. */
const REMAKE = { line: 3, text: '0REMAKE IN DRIFTENGINE' } as const;
const BLANK = '2';

/** The staff list's line `k`, the remake's in its place. */
const staffLine = (tables: CreditsTables, k: number): string | undefined => (k === REMAKE.line && tables.staff[k] === BLANK ? REMAKE.text : tables.staff[k]);

const min = (a: number, b: number): number => (b < a ? b : a);

/** A line's width in the small or large type: a space 8 or 10, the rest by the type's widths from '!' (one skipped past '0'). */
function widthOf(tables: CreditsTables, text: string, small: boolean): number {
  const widths = small ? tables.smallWidths : tables.largeWidths;
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 49) w += c === 32 ? (small ? 8 : 10) : widths[c - 33]!;
    else w += widths[c - 34]!;
  }
  return w;
}

function drawText(credits: CreditsState, x: number, y: number, small: boolean, text: string): void {
  credits.drawn.push({ kind: 'text', x, y, small, brightness: credits.brightness, text });
}

function drawBand(credits: CreditsState, red: number, green: number, blue: number): void {
  credits.drawn.push({ kind: 'band', x0: credits.x0, y: credits.y, x1: credits.x1, x2: credits.x2, width: credits.width, red, green, blue });
}

const drawKeptBand = (credits: CreditsState): void => drawBand(credits, credits.red, credits.green, credits.blue);

/** The colour from the warm toward black over `f`: each part less its share. */
function warmFading(credits: CreditsState, f: number): void {
  credits.red = (-3 - min(f * 7, 253)) & 0xff;
  credits.green = (-37 - min(f * 6, 219)) & 0xff;
  credits.blue = (-74 - min(f * 5, 182)) & 0xff;
}

/** The colour from black toward the warm by `f` (by halves near the top): each part its share. */
function warmRising(credits: CreditsState, f: number, halves: boolean): void {
  credits.red = min(halves ? Math.trunc((f * 7) / 2) : f * 7, 253);
  credits.green = min(f * (halves ? 3 : 6), 219);
  credits.blue = min(halves ? Math.trunc((f * 5) / 2) : f * 5, 182);
}

/** A line's brightness near the foot, from `f` (440 less its top): dimmer the lower, never under 80. */
function footBrightness(credits: CreditsState, f: number): void {
  const v = ((f * 2) | 1) & 0xff;
  if (v < 91) return;
  const b = (90 - ((v - 90) >> 1)) & 0xff;
  credits.brightness = b < 80 ? 80 : b;
}

/** A line placed: its width, its band's left edge centred (152 less half), its type's left past the offset, its right, its top. */
function placeLine(credits: CreditsState, tables: CreditsTables, text: string, small: boolean, top: number): void {
  const w = widthOf(tables, text, small);
  credits.widthCopy = w;
  credits.x0 = 152 - (w >> 1);
  credits.width = w;
  credits.x1 = credits.x0 + credits.offset;
  credits.x2 = credits.x1 + w;
  credits.y = top;
}

/** The title's two lines. */
function title(credits: CreditsState, tables: CreditsTables, count: number): void {
  credits.brightness = 90;
  for (credits.cursor = 0; credits.cursor < tables.title.length; credits.cursor += 1) {
    const text = tables.title[credits.cursor]!;
    const small = credits.cursor === 0;
    placeLine(credits, tables, text, small, (credits.cursor === 0 ? 0 : 18) + 220);
    if (count < 37) {
      if (count < 30) footBrightness(credits, 440 - credits.y);
      warmFading(credits, count);
      drawKeptBand(credits);
    } else if (count >= 181) {
      const left = 210 - count;
      credits.brightness = (left * 3 + 1) & 0xff;
      credits.fade = credits.fadeBase - left * 4;
    }
    if (count < 210) drawText(credits, credits.x1, credits.y, small, text);
  }
  credits.cursor = 0;
}

/** A line's zones by its place: glowing in from `rising`, out until `falling`, plain until `end`, beyond only its band. */
interface Zones {
  readonly rising: number;
  readonly falling: number;
  readonly end: number;
}
const HEADING_ZONES: Zones = { rising: 356, falling: 16, end: 436 };
const NAME_ZONES: Zones = { rising: 360, falling: 20, end: 440 };
const OPTION_ZONES: Zones = { rising: 340, falling: 0, end: 420 };

function glow(credits: CreditsState, lineY: number, zones: Zones): void {
  if ((lineY - zones.rising) >>> 0 < 80) {
    const f = 440 - credits.y;
    credits.fade = f;
    footBrightness(credits, f);
    warmFading(credits, f);
    drawKeptBand(credits);
  } else if ((lineY - zones.falling) >>> 0 < 80) {
    const f = 100 - credits.y;
    credits.fade = f;
    credits.brightness = ((credits.y & 0xff) - 19) & 0xff;
    warmRising(credits, f, true);
    drawKeptBand(credits);
  } else if ((lineY - zones.falling) >>> 0 < zones.end - zones.falling) credits.brightness = 80;
  else {
    credits.brightness = 1;
    drawBand(credits, 253, 219, 182);
  }
}

/** A heading (kind 0), held once the roll has ended: shown a while, then flaring up from black to the warm and back down, which ends the roll (true). */
function heading(credits: CreditsState, tables: CreditsTables, text: string): boolean {
  const lineY = credits.lineY;
  placeLine(credits, tables, text, true, lineY + 4);
  if (credits.end === 0) glow(credits, lineY, HEADING_ZONES);
  else {
    if (credits.end === 1) credits.hold += 1;
    if (credits.hold === 620) {
      credits.end = 2;
      credits.hold = 0;
    }
    if (2 <= credits.end) {
      const flare = credits.flare + 1;
      credits.flare = flare;
      if (credits.end === 2) {
        credits.fade = flare;
        credits.brightness = (80 - (flare & 0xff)) & 0xff;
        if (flare === 80) {
          credits.end = 3;
          credits.flare = 0;
        }
        warmRising(credits, flare, false);
        drawKeptBand(credits);
      } else if (credits.end === 3) {
        credits.fade = flare;
        credits.brightness = 1;
        if (flare === 80) {
          credits.end = 4;
          credits.brightness = 0;
          credits.scroll = 0;
          credits.state = 6;
          return true;
        }
        warmFading(credits, flare);
        drawKeptBand(credits);
      } else credits.brightness = 80;
    }
  }
  drawText(credits, credits.x1, lineY + 4, true, text.slice(1));
  return false;
}

function name(credits: CreditsState, tables: CreditsTables, text: string): void {
  const lineY = credits.lineY;
  placeLine(credits, tables, text, false, lineY);
  glow(credits, lineY, NAME_ZONES);
  drawText(credits, credits.x1, lineY, false, text.slice(1));
}

function optionHeading(credits: CreditsState, tables: CreditsTables, text: string): void {
  const lineY = credits.lineY;
  placeLine(credits, tables, text, true, lineY + 20);
  glow(credits, lineY, OPTION_ZONES);
  drawText(credits, credits.x1, lineY + 20, true, text.slice(1));
}

/** The staff roll: its lines from the top one down to the foot, then the climb; false when it ended this frame (no frame counted). */
function staff(game: GameState, tables: CreditsTables): boolean {
  const credits = game.credits;
  if (credits.scroll < -18) {
    credits.scroll += 18;
    credits.line += 1;
    if (tables.staff.length <= credits.line) {
      credits.brightness = 0;
      credits.state = 6;
      credits.scroll = 0;
      return false;
    }
  }
  credits.brightness = 90;
  credits.cursor = credits.line;
  credits.lineY = credits.scroll;
  while (credits.lineY < 480) {
    const text = staffLine(tables, credits.cursor);
    if (text === undefined && credits.end === 0) {
      credits.end = 1;
      break;
    }
    /* Past the list's end the game reads its line at address 0, which holds zero: no kind, the last line's stays, and nothing to set. */
    const line = text ?? '';
    const c = line.length === 0 ? -48 : line.charCodeAt(0) - 48;
    if (c === 0) credits.kind = 0;
    else if (c === 1) credits.kind = 1;
    else if (c === 2) credits.kind = 2;
    else if (c === 3) credits.kind = game.earned.ball === 0 ? -1 : 3;
    else if (c === 4) credits.kind = game.earned.ball === 0 ? 0 : -1;
    else if (c === 5) credits.kind = (game.records.extraCostumes & ANNA_THIRD) === 0 ? -1 : 1;
    if (credits.kind === 0) {
      if (heading(credits, tables, line)) return false;
    } else if (credits.kind === 1) name(credits, tables, line);
    else if (credits.kind === 3) optionHeading(credits, tables, line);
    credits.cursor += 1;
    credits.lineY += 18;
  }
  if (credits.end === 0) credits.scroll -= credits.toggle !== 0 ? 2 : 1;
  return true;
}

/** The roll set up (its pressed and end words as the Theater's overlay loads them), its count stepped once; whether a button was pressed. */
export function startCredits(credits: CreditsState): boolean {
  Object.assign(credits, { state: 0, scroll: 480, line: 0, fadeBase: 120, offset: 32, toggle: 0, count: 0, cursor: 0, hold: 0, flare: 0, red: 253, green: 219, blue: 182 });
  credits.count += 1;
  return credits.pressed !== 0;
}

/** A frame of the roll; true once it is over or cut short. */
export function stepCredits(game: GameState, data: Pick<FightData, 'sound' | 'music'>, tables: CreditsTables): boolean {
  const credits = game.credits;
  const world: FightState = game.world;
  credits.drawn.length = 0;
  if (((world.input.fresh[0]! | world.input.fresh[1]!) & SKIP_BUTTONS) !== 0) credits.pressed = 1;
  const count = credits.count;
  switch (credits.state) {
    case 0:
      if (count < 31) break;
      voiceLine(world, data, 0, OPENING_SOUND, 0);
      credits.state = 1;
      credits.count = 0;
      break;
    case 1:
      if (count !== 240) break;
      playSong(world, SONG, false);
      credits.state = 2;
      break;
    case 2: {
      const starting = songStarting(syncMusic(world.sound, data.music));
      if (starting === null) resetMusic(world);
      else if (starting) break;
      credits.state = 3;
      credits.line = 0;
      credits.count = 0;
      break;
    }
    case 3:
      if (count === 60) credits.state = 4;
      break;
    case 4:
      title(credits, tables, count);
      if (count === 239) credits.state = 5;
      break;
    case 5:
      if (!staff(game, tables)) return false;
      break;
    case 6:
      if (count !== 9060) break;
      credits.count = 0;
      credits.state = 7;
      break;
    case 7:
      if (180 <= count) return true;
      if (count < 11) credits.brightness = (credits.brightness + 12) & 0xff;
      else if (121 <= count) credits.brightness = (credits.brightness - 2) & 0xff;
      credits.drawn.push({ kind: 'mark', brightness: credits.brightness });
      break;
    default:
      break;
  }
  const toggle = credits.toggle + 1;
  credits.toggle = toggle === 2 ? 0 : toggle;
  credits.count += 1;
  return credits.pressed !== 0;
}
