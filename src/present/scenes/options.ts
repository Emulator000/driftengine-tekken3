/**
 * The Options: the title's picture in blue, and over it what the scene drew (`drawn.ts`).
 */
import type { GameState } from '../../sim/game/state.ts';
import { drawScene, type DrawnContext } from './drawn.ts';
import type { ScreenLayer } from './screen.ts';
import { drawTitlePicture } from './title.ts';

export function drawOptions(game: GameState, art: ScreenLayer, layer: ScreenLayer, backdrop: ImageBitmap, context: DrawnContext): void {
  drawTitlePicture(art, backdrop, 1, 'options');
  drawScene(game, layer, context);
}
