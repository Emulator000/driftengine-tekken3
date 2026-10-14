/**
 * A fighter set on the floor by its feet: standing a little above it or sunk a little into it, its
 * feet are put on it (lifted a few centimetres at most); lying, thrown or in the air, with a sash or
 * a hand through the floor, it is drawn as the game poses it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liftOnto } from '../src/present/3d/layout.ts';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('a fighter standing on its feet has them set on the floor, lifted a few centimetres at most', () => {
  near(liftOnto({ body: 0.015, feet: 0.015 }), -0.015);
  near(liftOnto({ body: -0.012, feet: -0.012 }), 0.012);
  near(liftOnto({ body: -0.1, feet: -0.1 }), 0.03);
  /* A heel a little lower than the toes' foot: still on its feet. */
  near(liftOnto({ body: -0.02, feet: -0.01 }), 0.01);
});

test('a fighter in the air, lying or not on its feet is drawn as the game poses it', () => {
  assert.equal(liftOnto({ body: 0.5, feet: 0.5 }), 0);
  /* Lying, a sash through the floor below the heels and the head. */
  assert.equal(liftOnto({ body: -0.113, feet: -0.018 }), 0);
  /* On its hands, its feet in the air. */
  assert.equal(liftOnto({ body: -0.01, feet: 0.8 }), 0);
  /* A model with no feet. */
  assert.equal(liftOnto({ body: 0, feet: Infinity }), 0);
});

test('the lift eases out as a fighter leaves its feet or the floor, never jumping', () => {
  let last = liftOnto({ body: -0.02, feet: -0.02 });
  for (let above = 0; above <= 0.08; above += 0.001) {
    const lift = liftOnto({ body: -0.02, feet: -0.02 + above });
    assert.ok(Math.abs(lift - last) < 0.005, `a step of ${Math.abs(lift - last)} at ${above}`);
    last = lift;
  }
  last = liftOnto({ body: 0, feet: 0 });
  for (let height = 0; height <= 0.08; height += 0.001) {
    const lift = liftOnto({ body: height, feet: height });
    assert.ok(Math.abs(lift - last) < 0.005, `a step of ${Math.abs(lift - last)} at ${height}`);
    last = lift;
  }
});
