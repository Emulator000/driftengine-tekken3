import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The engine comes from npm, unless a checkout sits at `../drftrun/driftengine`.
 *
 * With the checkout there, every engine import resolves to its source, so an engine edit is live
 * here on save. `DRIFT_ENGINE_LOCAL=0` forces the installed packages, which is what to reach for
 * when a bug might be the checkout's fault.
 */
const ENGINE_SRC = path.join(here, '../drftrun/driftengine/packages');
const LOCAL_ENGINE =
  process.env.DRIFT_ENGINE_LOCAL !== '0' && existsSync(path.join(ENGINE_SRC, 'core/src/index.ts'));

/** What this player imports, and what core's own barrel imports: `physics` and `drft`. */
const ENGINE_PACKAGES = ['core', 'physics', 'drft', 'audio', 'ui2d'].join('|');

export default defineConfig({
  resolve: {
    alias: LOCAL_ENGINE
      ? [
          {
            find: new RegExp(`^@driftengine/(${ENGINE_PACKAGES})/(.*)$`),
            replacement: path.join(ENGINE_SRC, '$1/src/$2'),
          },
          {
            find: new RegExp(`^@driftengine/(${ENGINE_PACKAGES})$`),
            replacement: path.join(ENGINE_SRC, '$1/src/index.ts'),
          },
        ]
      : [],
  },
  /*
   * 5190 when it is free, otherwise the next port that is: Vite prints the one it took. Served to
   * this machine alone: the page loads the disc's data.
   */
  server: { host: 'localhost', port: 5190 },
  preview: { host: 'localhost' },
  build: { target: 'es2022' },
});
