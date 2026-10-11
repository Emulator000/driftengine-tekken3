/**
 * The remake, the game the page plays: from power-on, or with `?quick` (or any of `p1`, `p2`,
 * `stage`, `cpu`) a quick match at once. `stop` holds the game after that many fields (for
 * comparing pictures) and `quality` picks the picture's (`high` by default, or `low`). The game's
 * own assets come from `public/assets/`, its models and stages from `public/data/`.
 */
import { params } from './page.ts';

const quick = ['quick', 'p1', 'p2', 'stage', 'cpu'].some((key) => params.has(key));
if (quick) await (await import('./quick.ts')).playQuickMatch();
else await (await import('./game.ts')).playGame();
