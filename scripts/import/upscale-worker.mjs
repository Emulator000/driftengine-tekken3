/** A worker of `textures.mjs`: one atlas (a PNG) read, enlarged `scale` times and written. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';

import { decodePng, encodePng } from '../lib/png.mjs';
import { upscale } from '../lib/upscale.mjs';

parentPort.on('message', ({ from, to, scale }) => {
  const { width, height, rgba } = decodePng(readFileSync(from));
  const big = upscale(rgba, width, height, scale);
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, encodePng(big.w, big.h, big.pixels));
  parentPort.postMessage(to);
});
