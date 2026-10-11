/**
 * Tekken 3 on DriftEngine (`npm run disc && npm run extract && npm run import`): the game
 * (`src/app/remake.ts`), or with `?viewer` in the address the viewer for every fighter and move.
 */
export {};

const params = new URLSearchParams(location.search);
if (params.has('viewer')) await import('./viewer.ts');
else await import('./app/remake.ts');
