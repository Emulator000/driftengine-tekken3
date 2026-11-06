/**
 * The arcade board's fighters' hands: the step a board's model draws a hand at, from the game's
 * shape for it, and (on the user's own extracted data, skipped without it) every board model's
 * hands closing as the disc's do, on the same parts.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readFtr } from '../scripts/lib/ftr.mjs';
import { boardHandStep } from '../src/present/3d/fighter/hand-steps.ts';

const FIST = 512;

test("a board's model draws a hand at thirty-three steps from open to a fist, then its other shapes", () => {
  assert.equal(boardHandStep(0, 0, false), 0, 'open');
  assert.equal(boardHandStep(15, 0, false), 0);
  assert.equal(boardHandStep(16, 0, false), 1);
  assert.equal(boardHandStep(256, 1, false), 16, 'half way');
  assert.equal(boardHandStep(FIST, 3, false), 32, 'a fist');
  assert.equal(boardHandStep(FIST + 1, 4, false), 33, 'the first other shape');
  assert.equal(boardHandStep(FIST + 2, 5, false), 34);
});

test("while a replay plays, a board's model draws a hand from the console's step the replay kept", () => {
  assert.deepEqual([0, 1, 2, 3].map((step) => boardHandStep(0, step, true)), [0, 16, 24, 32], 'open, half, three quarters, a fist');
  assert.equal(boardHandStep(0, 4, true), 33, 'the first other shape');
});

const data = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/data');
const skip = !existsSync(path.join(data, 'arcade/fighters')) && "no board's fighters extracted; run npm run extract with the board's data";

/** A mesh's hand shapes by part: each shape's points' mean distance from their joint, which a hand's closing draws in or out. */
function reaches(file) {
  const mesh = readFtr(new Uint8Array(readFileSync(file)));
  return new Map(mesh.shapes.map((g) => [g.part, { steps: g.steps, reach: g.shapes.map((shape) => shape.reduce((sum, v) => sum + Math.hypot(...v.points[0]), 0) / shape.length) }]));
}

test("every board model's hands close as the disc's: on the same parts, thirty-three steps from open to a fist the same way round, then the disc's other shape", { skip }, () => {
  const packs = readdirSync(path.join(data, 'arcade/fighters')).filter((n) => n.endsWith('.ftr') && existsSync(path.join(data, 'fighters', n)));
  assert.ok(packs.length >= 20, `the board's fighters (${packs.length})`);
  const wrong = [];
  for (const name of packs) {
    const [disc, board] = [reaches(path.join(data, 'fighters', name)), reaches(path.join(data, 'arcade/fighters', name))];
    for (const [part, own] of disc) {
      const theirs = board.get(part);
      if (theirs === undefined) {
        wrong.push(`${name} part ${part}: no hand shapes`);
        continue;
      }
      const drawn = (shape, step) => theirs.steps[boardHandStep(shape, step, false)];
      const steps = Array.from({ length: 33 }, (_, k) => drawn(k * 16, 0));
      if (new Set(steps).size !== 33) wrong.push(`${name} part ${part}: ${new Set(steps).size} shapes from open to a fist, not 33`);
      /* From open to a fist each changes the same way, by a part of its open hand's reach within two and a half times the other's. */
      const change = (from, to) => (to - from) / from;
      const [ours, its] = [change(own.reach[own.steps[0]], own.reach[own.steps[3]]), change(theirs.reach[drawn(0, 0)], theirs.reach[drawn(FIST, 3)])];
      if (!(Math.sign(ours) === Math.sign(its) && Math.abs(its) >= Math.abs(ours) / 2.5 && Math.abs(its) <= Math.abs(ours) * 2.5)) wrong.push(`${name} part ${part}: open to a fist changes ${(its * 100).toFixed(1)}% where the disc's changes ${(ours * 100).toFixed(1)}%`);
      /* The disc's other shape, where it has one, is the board's first. */
      if (own.steps[4] !== 0 && own.steps[4] !== undefined) {
        const [discOther, boardOther] = [own.reach[own.steps[4]], theirs.reach[drawn(FIST + 1, 4)]];
        if (!(Math.abs(boardOther - discOther) <= discOther / 10)) wrong.push(`${name} part ${part}: its other shape reaching ${boardOther?.toFixed(0)} where the disc's reaches ${discOther.toFixed(0)}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});
