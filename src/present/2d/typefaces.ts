/**
 * The typefaces the game's 2D prints in, loaded into the document so its canvases can paint them:
 * Russo One, heavy and squared, for the announcer's calls, the names and the menus; Saira Extra
 * Condensed Black, tall and narrow, for the timer's numerals. Both are under the SIL Open Font
 * License and ship with the game (`@fontsource`).
 */
import display from '@fontsource/russo-one/files/russo-one-latin-400-normal.woff2?url';
import numerals from '@fontsource/saira-extra-condensed/files/saira-extra-condensed-latin-900-normal.woff2?url';
import type { Typeface } from './type.ts';

export const DISPLAY: Typeface = { family: 'Russo One', weight: 400 };
export const NUMERALS: Typeface = { family: 'Saira Extra Condensed', weight: 900 };

/** Both typefaces loaded and added to the document's fonts. */
export async function loadTypefaces(): Promise<void> {
  const faces: [Typeface, string][] = [
    [DISPLAY, display],
    [NUMERALS, numerals],
  ];
  await Promise.all(
    faces.map(async ([face, url]) => {
      const font = new FontFace(face.family, `url(${url})`, { weight: String(face.weight) });
      document.fonts.add(await font.load());
    }),
  );
}
