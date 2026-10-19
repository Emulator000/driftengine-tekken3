/** The loop's frame times: a 60 Hz or 120 Hz display's frames run the 60 Hz fields evenly, and GAME SPEED's 50 Hz five fields in six of a 60 Hz display's frames. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evenTime, FIFTY_HZ, pacedTime } from '../src/app/pacing.ts';

const FIELD = 1 / 60;

/** Fields run each frame by an accumulator, as the engine's loop runs them, from frame times in milliseconds. */
function fieldsPerFrame(times) {
  let accumulator = 0;
  return times.map((ms) => {
    accumulator += ms / 1000;
    let fields = 0;
    while (accumulator >= FIELD) {
      accumulator -= FIELD;
      fields += 1;
    }
    return fields;
  });
}

/** A display's frame times at `hz`, wandering by up to `jitter` milliseconds each. */
function display(hz, frames, jitter) {
  let seed = 11;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: frames }, () => 1000 / hz + (random() * 2 - 1) * jitter);
}

test('a 120 Hz display runs a field every other frame', () => {
  const raw = display(120.02, 2000, 0.05);
  const uneven = (counted) => counted.filter((n, i) => i > 0 && n + counted[i - 1] !== 1).length;
  assert.equal(uneven(fieldsPerFrame(raw.map(evenTime))), 0);
  assert.ok(uneven(fieldsPerFrame(raw)) > 0, 'counted as they come, the fields come unevenly');
});

test('a 60 Hz display runs a field every frame, and a late frame two', () => {
  const raw = display(59.98, 2000, 0.08);
  raw[500] = 1000 / 30;
  const counted = fieldsPerFrame(raw.map(evenTime));
  counted.forEach((n, i) => assert.equal(n, i === 500 ? 2 : 1, `frame ${i}`));
});

test('frames at other rates keep their own times', () => {
  assert.equal(evenTime(1000 / 90), 1000 / 90);
  assert.equal(evenTime(1000 / 144), 1000 / 144);
  assert.ok(Math.abs(evenTime(8.4) - 1000 / 120) < 1e-5);
  assert.ok(Math.abs(evenTime(16.5) - 1000 / 60) < 1e-5);
});

test("at GAME SPEED's 50 Hz a 60 Hz display runs five fields in every six frames, never two in one", () => {
  const counted = fieldsPerFrame(display(59.98, 6000, 0.08).map((ms) => pacedTime(ms, FIFTY_HZ)));
  assert.ok(counted.every((n) => n <= 1), 'never two fields in a frame');
  for (let i = 6; i + 6 <= counted.length; i += 6) assert.equal(counted.slice(i, i + 6).reduce((a, b) => a + b, 0), 5, `frames ${i} to ${i + 5}`);
  assert.equal(pacedTime(1000 / 60, 1), evenTime(1000 / 60), 'at 60 Hz the frame times as they were');
});
