/**
 * The source's rules, kept by scanning it: no PlayStation addresses in the game's code, and a
 * simulation free of the engine, the loaders, the presentation, the app and the browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REMAKE_RULES, SIM_RULES, scan, scanTree } from './lib/architecture.mjs';

test('the scanner finds each kind of violation on its line', () => {
  const text = ['const a = 1;', 'w32(0x800a9228, 0);', 'const pad = 0x1f800004;'].join('\n');
  assert.deepEqual(scan(text, REMAKE_RULES).map((f) => `${f.name}@${f.line}`).sort(), ['PlayStation address@2', 'PlayStation address@3']);
  assert.deepEqual(scan('const pitch = 0x2e3;\nconst sign = 0x80000000;', REMAKE_RULES), [], 'constants are fine, the sign bit too');
  const sim = ["import { AudioGraph } from '@driftengine/audio';", "import { parseMoveset } from '../../assets/moveset.ts';", 'const w = window.innerWidth;'].join('\n');
  assert.deepEqual(scan(sim, SIM_RULES).map((f) => f.name), ['engine import', 'outer layer import', 'browser global']);
  assert.deepEqual(scan("/** The window of frames it applies in, the document's word, its step window. */\nconst a = await fetch('x');", SIM_RULES).map((f) => `${f.name}@${f.line}`), ['browser global@2'], 'the words in prose are fine, the calls are not');
});

test('the game source keeps the rules', () => {
  const scanned = [...scanTree('src/sim', [...REMAKE_RULES, ...SIM_RULES]), ...['src/assets', 'src/present', 'src/app'].flatMap((root) => scanTree(root, REMAKE_RULES))];
  assert.deepEqual(scanned.filter((f) => f.findings.length > 0), []);
});
