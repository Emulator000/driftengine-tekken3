/**
 * The printer: text drawn as runs of glyphs, each with its font and colour number, its first
 * glyph's place in the screen's units and its table entry, as the original's printer lays them:
 * a space moves the pen a glyph on, a new line goes back to the line's start one line down.
 */
import type { GameState, PrintRun } from './state.ts';

/** The printer's fonts: each glyph's advance across and a line's height. */
export const FONTS = [
  { advance: 9, line: 18 },
  { advance: 13, line: 26 },
  { advance: 22, line: 42 },
  { advance: 21, line: 42 },
] as const;

/** The table entry text goes in unless a scene picks another. */
export const TEXT_LAYER = 7;

/** The runs of glyphs `text` printed from (x, y) makes (a space moves the pen on, a new line goes back to the line's start one line down), and where the pen ends across. */
export function printRuns(font: number, colour: number, x: number, y: number, text: string, layer = TEXT_LAYER): { runs: PrintRun[]; pen: number } {
  const { advance, line } = FONTS[font]!;
  const runs: PrintRun[] = [];
  let pen = x;
  let start: number | null = null;
  let run = '';
  const end = (): void => {
    if (start !== null) runs.push({ font, colour, x: start, y, layer, text: run.trimEnd() });
    start = null;
    run = '';
  };
  for (const ch of text) {
    if (ch === '\n') {
      end();
      y += line;
      pen = x;
      continue;
    }
    if (ch !== ' ' && start === null) start = pen;
    if (start !== null) run += ch;
    pen += advance;
  }
  end();
  return { runs, pen };
}

/** `text` printed from (x, y); returns where the pen ends across, for text that goes on in another colour. */
export function print(game: GameState, font: number, colour: number, x: number, y: number, text: string, layer = TEXT_LAYER): number {
  const { runs, pen } = printRuns(font, colour, x, y, text, layer);
  game.printed.push(...runs);
  return pen;
}
