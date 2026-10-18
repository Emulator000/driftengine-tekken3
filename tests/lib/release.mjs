/**
 * A release's own code as its tag has it (its `src/sim`, `src/assets` and `src/net`), written into a
 * folder of its own, for a test to run it beside this release's: its modules imported from there.
 * Null without git or the tag.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function releaseCode(version, parts = ['src/sim', 'src/assets', 'src/net']) {
  const tag = `v${version}`;
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', tag, '--', ...parts], { cwd: root, encoding: 'utf8' });
  if (listed.status !== 0 || listed.stdout.trim() === '') return null;
  const names = listed.stdout.trim().split('\n');
  /* Every file in one call: each answered as its header line, its bytes and a new line. */
  const batch = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: names.map((name) => `${tag}:${name}\n`).join(''), maxBuffer: 1 << 28 });
  if (batch.status !== 0) return null;
  const dir = mkdtempSync(path.join(tmpdir(), `tekken3-${tag}-`));
  writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  const out = batch.stdout;
  let at = 0;
  for (const name of names) {
    const end = out.indexOf(10, at);
    const size = Number(out.subarray(at, end).toString().split(' ')[2]);
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out.subarray(end + 1, end + 1 + size));
    at = end + 1 + size + 1;
  }
  return {
    load: (file) => import(pathToFileURL(path.join(dir, file)).href),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
