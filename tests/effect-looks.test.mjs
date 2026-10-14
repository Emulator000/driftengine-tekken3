/**
 * The effects' looks: a function of the pieces alone (the same pieces lay the same particles, so a
 * held frame holds and a replay draws the same), and every fighter's design draws something over
 * its life, its lights included; the Mishimas' lightning lays its sheet's strokes over the sprite's
 * square, as large as the game draws it, joined and straightened into long segments; a streak runs
 * from its start to its end.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boltPaths, effectBuffers, fillEffects, STRETCH, streakParticle } from '../src/present/3d/effects/effect-looks.ts';

const VIEW = { right: [1, 0, 0], up: [0, 1, 0] };
const DESIGNS = ['fire ring', 'swirl', 'bloom', 'gold sphere', 'needles', 'web', 'cyan sphere', 'orbit', 'sparkles', 'lightning', 'fireworks', 'star', 'toxic', 'orbs'];
/** A sheet frame of one stroke down the sheet's whole height, a little left of its middle, over a sprite 0.75 m across. */
const SHEET = { strokes: [{ points: [12, 0, 14, 16, 12, 32], brightness: [0.3, 0.67, 0.3] }], mirrored: false, size: 0.75, shade: 1 };
const piece = (look, design, age) => ({ look, design, position: [0, 1, 0], velocity: [1, 0.2, 0], age, frames: 30, colour: [0, 0.75, 1], seed: 12345, ...(design === 'lightning' ? { sheet: SHEET } : {}) });
const drawn = (out) => out.streaks.count + out.glows.count + out.shapes.count + out.puffs.count + out.bolts.count;
const snapshot = (out) => JSON.stringify([out.streaks, out.glows, out.shapes, out.puffs, out.lights].map((set) => [set.count, Array.from(set.positions.slice(0, set.count * 3))]));

test('the same pieces lay the same particles', () => {
  const pieces = DESIGNS.map((design, i) => ({ ...piece('heavy', design, 0.1 + i * 0.05) })).concat([piece('hit', 'fire ring', 0.3), piece('burst', 'fire ring', 0.4), piece('dust', 'fire ring', 0.5)]);
  const a = effectBuffers();
  const b = effectBuffers();
  fillEffects(pieces, VIEW, a);
  fillEffects(pieces, VIEW, b);
  assert.equal(snapshot(a), snapshot(b));
});

test("every fighter's design draws over its life, and lights the world as it starts", () => {
  for (const design of DESIGNS) {
    const out = effectBuffers();
    for (const age of [0.02, 0.3, 0.6]) {
      fillEffects([piece('heavy', design, age)], VIEW, out);
      assert.ok(drawn(out) > 0, `${design} draws nothing at ${age}`);
    }
    fillEffects([piece('heavy', design, 0.02)], VIEW, out);
    assert.equal(out.lights.count, 1, `${design} casts no light`);
  }
});

test("the Mishimas' lightning lays its sheet's strokes over the sprite's square, centred on the blow, mirrored as the slot is", () => {
  const out = effectBuffers();
  const ends = (mirrored) => {
    fillEffects([{ ...piece('heavy', 'lightning', 0.3), sheet: { ...SHEET, mirrored } }], VIEW, out);
    assert.equal(out.bolts.count, 2, "a bolt for each of the stroke's two segments");
    return { top: Array.from(out.bolts.from.slice(0, 3)), bottom: Array.from(out.bolts.to.slice(3, 6)) };
  };
  const { top, bottom } = ends(false);
  /* The sheet's full height is the sprite's: 0.75 m, from 0.375 above the blow to 0.375 below. */
  assert.ok(Math.abs(top[1] - 1.375) < 1e-6 && Math.abs(bottom[1] - 0.625) < 1e-6, `the stroke runs from ${top[1]} to ${bottom[1]}`);
  /* Texel 12 of 32 is 0.09375 m left of the middle; mirrored, as far right. */
  assert.ok(Math.abs(top[0] + 0.09375) < 1e-6, `it starts at ${top[0]} across`);
  assert.ok(Math.abs(ends(true).top[0] - 0.09375) < 1e-6, 'mirrored, it starts as far right');
});

/** A path's segments' lengths, in texels. */
const segments = (path) => Array.from({ length: path.points.length / 2 - 1 }, (_, n) => Math.hypot(path.points[n * 2 + 2] - path.points[n * 2], path.points[n * 2 + 3] - path.points[n * 2 + 1]));

test("the lightning's staircase of texels is drawn as one straight segment", () => {
  /* A thinned line a little off vertical: down a texel at a time, a texel across every fourth. */
  const points = [];
  for (let y = 0; y <= 16; y += 1) points.push(10 + Math.floor(y / 4), y);
  const [path] = boltPaths([{ points, brightness: points.filter((_, k) => k % 2 === 0).map(() => 0.5) }]);
  assert.deepEqual(path.points, [10, 0, 14, 16]);
  assert.deepEqual(path.brightness, [0.5, 0.5]);
});

test('strokes meeting at a fork join along the straightest way through it, the third branch its own', () => {
  /* A bolt down the sheet broken at a fork at (8, 8), a branch off it to the right. */
  const up = { points: [8, 0, 8, 4, 8, 8], brightness: [0.2, 0.4, 0.6] };
  const down = { points: [8, 16, 8, 12, 8, 8], brightness: [0.3, 0.5, 0.6] };
  const branch = { points: [8, 8, 12, 9, 16, 12], brightness: [0.6, 0.4, 0.2] };
  const paths = boltPaths([branch, up, down]);
  assert.equal(paths.length, 2);
  const trunk = paths.find((p) => p.points.length === 4);
  assert.deepEqual(trunk.points, [8, 0, 8, 16], 'the trunk is one straight segment');
  assert.ok(paths.some((p) => p.points[0] === 8 && p.points[1] === 8 && p.points.at(-2) === 16), 'the branch leaves the fork');
});

test("a bolt the tracer left split at every texel is drawn as one, in segments longer than its glow is wide", () => {
  /* A thinned line at a slope of a half: a texel across, then one across and down, each step a stroke of its own meeting the next end to end. */
  const at = (k) => [k, Math.floor(k / 2)];
  const strokes = Array.from({ length: 24 }, (_, k) => ({ points: [...at(k), ...at(k + 1)], brightness: [0.5, 0.5] }));
  const paths = boltPaths(strokes);
  assert.equal(paths.length, 1, 'joined into one bolt');
  const ends = [paths[0].points.slice(0, 2), paths[0].points.slice(-2)].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(ends, [at(0), at(24)], 'from its first texel to its last');
  const lengths = segments(paths[0]);
  assert.ok(Math.min(...lengths) > 4, `its segments run ${lengths.map((v) => v.toFixed(1))} texels`);
});

test('a streak, stretched as the batch stretches a particle, runs from its start to its end', () => {
  /*
   * The batch lays a particle's quad on corners a half-width across and along its travel, and moves
   * each corner on along the travel by half the travel over the stretch times the cosine between
   * them, 45 degrees: the quad's ends lie that far either side of the particle, past the half-width.
   */
  const from = [0.2, 1.1, -0.3];
  const to = [0.9, 1.4, -0.1];
  const { position, velocity } = streakParticle(from, to);
  const travel = velocity.map((v) => v * STRETCH);
  const reach = (Math.hypot(...travel) * Math.SQRT1_2) / 2;
  const way = travel.map((v) => v / Math.hypot(...travel));
  const ends = [-1, 1].map((sign) => position.map((p, k) => p + sign * way[k] * reach));
  ends[0].forEach((v, k) => assert.ok(Math.abs(v - from[k]) < 1e-9, `it starts at ${ends[0]}`));
  ends[1].forEach((v, k) => assert.ok(Math.abs(v - to[k]) < 1e-9, `it ends at ${ends[1]}`));
});

