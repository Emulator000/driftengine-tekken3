/**
 * The fighters' and the stages' texture atlases enlarged by edge-directed interpolation
 * (`scripts/lib/upscale.mjs`) for the smooth textures the remake draws by default:
 * `textures/fighters/NN.png` (and the attract intros' `textures/intro/I-PP.png`) four times their
 * size, `textures/stages/NN.png` and the arcade's `textures/arcade/stages/NN.png` twice (a stage's
 * atlas is already 1024 square). Each is made again only when its source or the enlarger is newer,
 * the work spread over worker threads, an atlas each.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { TEXTURE_SCALE } from '../../src/assets/manifest.ts';

export async function upscaleTextures(root, output) {
  const jobs = [];
  const enlarger = statSync(new URL('../lib/upscale.mjs', import.meta.url)).mtimeMs;
  for (const [kind, scale] of [
    ['fighters', TEXTURE_SCALE.fighters],
    ['intro', TEXTURE_SCALE.fighters],
    ['stages', TEXTURE_SCALE.stages],
    ['arcade/stages', TEXTURE_SCALE.stages],
  ]) {
    const dir = path.join(root, 'public/data', kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.png')).sort()) {
      const from = path.join(dir, name);
      const to = output.keep(`textures/${kind}/${name}`);
      if (existsSync(to) && Math.max(statSync(from).mtimeMs, enlarger) <= statSync(to).mtimeMs) continue;
      jobs.push({ from, to, scale });
    }
  }
  if (jobs.length === 0) return 0;
  const workers = Array.from({ length: Math.max(1, Math.min(jobs.length, availableParallelism() - 1)) }, () => new Worker(new URL('./upscale-worker.mjs', import.meta.url)));
  let next = 0;
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise((resolve, reject) => {
          const take = () => {
            if (next >= jobs.length) {
              void worker.terminate();
              resolve();
              return;
            }
            worker.postMessage(jobs[next++]);
          };
          worker.on('message', take);
          worker.on('error', reject);
          take();
        }),
    ),
  );
  return jobs.length;
}
