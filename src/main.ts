/**
 * Tekken 3 on DriftEngine (`npm run disc && npm run extract && npm run import`): the game
 * (`src/app/remake.ts`), or with `?viewer` in the address the viewer for every fighter and move. A
 * failure anywhere shows the game's stop (`src/app/crash.ts`).
 */
import { catchUncaught, showCrash } from './app/crash.ts';
import { remoteLog } from './app/remote-log.ts';

remoteLog();
catchUncaught();
const params = new URLSearchParams(location.search);
try {
  if (params.has('viewer')) await import('./viewer.ts');
  else await import('./app/remake.ts');
} catch (error) {
  showCrash(error, 'loading the game');
}
