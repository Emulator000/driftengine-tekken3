/**
 * The head turning toward the opponent (`src/sim/fight/look.ts`), on synthetic tables: when a move
 * lets it, where it turns, how far, how fast, a close target kept, a round's first frame, Gon's head;
 * and the head as drawn (`src/present/3d/fighter/head-ease.ts`): a switch closed, a stance's nod let by, a turn followed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anglesOf, headMayTurn, newLook, resetLooks, turnHead } from '../src/sim/fight/look.ts';
import { eulerRotation } from '../src/sim/fight/skeleton.ts';
import { multiply } from '../src/sim/math/matrix.ts';

/** Sine in 4.12 over 4096 steps and a quarter more; the arctangent and root tables as the game lays theirs. */
const math = {
  sine: Int16Array.from({ length: 0x1400 }, (_, i) => Math.round(4096 * Math.sin((2 * Math.PI * i) / 4096))),
  atan: Uint8Array.from({ length: 1025 }, (_, i) => Math.round((Math.atan(i / 1024) * 4096) / (2 * Math.PI)) - (i >> 1)),
  roots: Int16Array.from({ length: 192 }, (_, k) => Math.round(Math.sqrt(k + 64) * 512)),
  negativeRoots: new Int16Array(512),
  libraryNegativeRoots: new Int16Array(512),
};

const FIGHTING = 2;
const LETS = 1 << 30;
const GON = 0x11;
const degrees = (turn) => (turn * 360) / 0x10000;
const move = (hitFlags, first = 0, last = 0, length = 60) => ({ hitFlags, activeWindow: { first, last }, length });

/** A neck standing up: its local x up the neck (the world's -y, y being down), y toward +x, z toward +z; the head at its place. */
const upright = { rotation: [0, 4096, 0, -4096, 0, 0, 0, 0, 4096], translation: [0, 0, 0] };
/** A neck bent over: its x level, toward +x. */
const bent = { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [0, 0, 0] };
const head = { rotation: [4096, 0, 0, 0, 4096, 0, 0, 0, 4096], translation: [0, 0, 0] };

/** The head's angles after one frame from a round's start, toward `aim` from a neck `neck`. */
function snapped(aim, neck = upright, roster = 0) {
  const look = newLook();
  resetLooks([look]);
  turnHead(math, look, roster, neck, head, aim, new Array(9).fill(0));
  return look;
}

test('the head turns only while the fight is on, on a move that lets it, and an attack only from its swing\'s end', () => {
  assert.equal(headMayTurn(FIGHTING, move(LETS), 1), true);
  assert.equal(headMayTurn(FIGHTING, move(0), 1), false, 'the move does not let it');
  assert.equal(headMayTurn(1, move(LETS), 1), false, 'the opening');
  /* An attack whose swing ends at 20 in a 60-frame move: from frame 43, 17 before its end. */
  assert.equal(headMayTurn(FIGHTING, move(LETS, 12, 20), 42), false);
  assert.equal(headMayTurn(FIGHTING, move(LETS, 12, 20), 43), true);
  /* Its swing ending later: from there. */
  assert.equal(headMayTurn(FIGHTING, move(LETS, 30, 50), 49), false);
  assert.equal(headMayTurn(FIGHTING, move(LETS, 30, 50), 50), true);
});

test('a target straight ahead leaves the head level; one to the side turns it as far as it lies, to 80 degrees', () => {
  assert.deepEqual(snapped([1000, 0, 0]).angles, [0, 0, 0]);
  assert.ok(Math.abs(degrees(snapped([1000, 0, 1000]).angles[2]) - 45) < 0.5);
  assert.ok(Math.abs(degrees(snapped([0, 0, 1000]).angles[2]) - 80) < 0.1, 'held at 80 degrees');
  assert.ok(Math.abs(degrees(snapped([0, 0, -1000]).angles[2]) + 80) < 0.1, 'either way');
});

test('a neck bent over turns the head no more than 30 degrees', () => {
  assert.ok(Math.abs(degrees(snapped([0, 1000, 1000], bent).angles[2]) - 30) < 0.1);
});

test('a target above or below pitches the head, to 60 degrees one way and 25 the other', () => {
  const up = degrees(snapped([1000, -3000, 0]).angles[1]);
  const down = degrees(snapped([1000, 3000, 0]).angles[1]);
  assert.ok(Math.abs(up + 60) < 0.1, `up ${up}`);
  assert.ok(Math.abs(down - 25) < 0.1, `down ${down}`);
});

test('Gon\'s head does not turn to the side', () => {
  assert.equal(snapped([1000, 0, 1000], upright, GON).angles[2], 0);
});

test('the head goes half its way toward the target a frame, at most 10 degrees', () => {
  const look = snapped([1000, 0, 0]);
  const local = new Array(9).fill(0);
  turnHead(math, look, 0, upright, head, [0, 0, 1000], local);
  assert.ok(Math.abs(degrees(look.angles[2]) - 10) < 0.1, 'a first step of 10 degrees');
  for (let frame = 0; frame < 30; frame += 1) turnHead(math, look, 0, upright, head, [0, 0, 1000], local);
  assert.ok(Math.abs(degrees(look.angles[2]) - 80) < 0.1, 'there in the end');
  const before = look.angles[2];
  turnHead(math, look, 0, upright, head, [1000, 0, 1000], local);
  const moved = degrees(before - look.angles[2]);
  assert.ok(moved > 0 && moved <= 10 + 1e-9, `back toward 45 degrees by at most 10 (${moved})`);
});

test('a target close in front is kept for a second before the next is taken', () => {
  const look = snapped([300, 0, 200]);
  const kept = look.target[2];
  const local = new Array(9).fill(0);
  for (let frame = 1; frame < 60; frame += 1) {
    turnHead(math, look, 0, upright, head, [300, 0, -200], local);
    assert.equal(look.target[2], kept, `still kept on frame ${frame}`);
  }
  turnHead(math, look, 0, upright, head, [300, 0, -200], local);
  assert.notEqual(look.target[2], kept, 'taken on the 60th');
});

test('the frame the head first turns, it starts from where the motion holds it: the angles its local rotation is the base turned by', () => {
  const base = new Array(9).fill(0);
  eulerRotation(math, 0x4000, 0, 0x4000, base);
  const turned = new Array(9).fill(0);
  const local = new Array(9).fill(0);
  for (const angles of [[0, 0x800, -0x1200], [0x300, -0x900, 0x1000], [0, 0, 0]]) {
    eulerRotation(math, angles[0], angles[1], angles[2], turned);
    multiply(base, turned, local);
    const out = [0, 0, 0];
    anglesOf(math, local, out);
    for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(degrees(out[k] - angles[k])) < 1, `${angles}: ${out}`);
  }
});

test('the head\'s local rotation is turned: a quarter turn about x and z times its angles', () => {
  const local = new Array(9).fill(0);
  const look = newLook();
  resetLooks([look]);
  turnHead(math, look, 0, upright, head, [1000, 0, 0], local);
  const base = new Array(9).fill(0);
  eulerRotation(math, 0x4000, 0, 0x4000, base);
  assert.deepEqual(local, base, 'level and straight ahead: the base alone');
});

/** Turns about z by `deg` degrees, row-major; the angle such a turn is by. */
const about = (deg) => {
  const a = (deg * Math.PI) / 180;
  return Float64Array.from([Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]);
};
const angleOf = (r) => (Math.atan2(r[3], r[0]) * 180) / Math.PI;
/** A neck upright and the head on it turned `deg` degrees. */
const turning = (deg) => {
  const joints = [];
  joints[1] = { r: about(0), t: Float64Array.from([0, -1400, 0]) };
  joints[2] = { r: about(deg), t: Float64Array.from([0, -1600, 0]) };
  return joints;
};

test('drawn, a switch of the head\'s turn is closed over six fields, what hangs from the head turned with it', async () => {
  const { HeadEase } = await import('../src/present/3d/fighter/head-ease.ts');
  const pose = (deg) => {
    const joints = turning(deg);
    joints[18] = { r: about(deg), t: Float64Array.from([0, -1700, 0]) };
    return joints;
  };
  const ease = new HeadEase();
  ease.apply(pose(40), [18], 1, 100);
  /* The game starts or stops turning it: the head is 40 degrees off at once. */
  const seen = [];
  for (let field = 101; field <= 108; field += 1) {
    const joints = pose(0);
    ease.apply(joints, [18], 0, field);
    seen.push(angleOf(joints[2].r));
    assert.ok(Math.abs(angleOf(joints[18].r) - angleOf(joints[2].r)) < 1e-9, 'the hair turns with the head');
    assert.ok(Math.abs(Math.hypot(joints[18].t[0], joints[18].t[1] + 1600) - 100) < 1e-6, 'about the head');
  }
  assert.ok(Math.abs(seen[0] - (40 * 5) / 6) < 1e-6, `a sixth of the way the first field (${seen[0]})`);
  for (let k = 1; k < seen.length; k += 1) assert.ok(seen[k - 1] - seen[k] <= 40 / 6 + 1e-6, `a field's step ${seen[k - 1] - seen[k]}`);
  assert.ok(Math.abs(seen.at(-1)) < 1e-6, 'and ends on the motion\'s head');
});

test('drawn, a turning head lets the nod of a bouncing stance by', async () => {
  const { HeadEase } = await import('../src/present/3d/fighter/head-ease.ts');
  const ease = new HeadEase();
  let most = 0;
  for (let field = 0; field < 240; field += 1) {
    /* The game's head nodding 4 degrees either way, once a second. */
    const joints = turning(4 * Math.sin((2 * Math.PI * field) / 60));
    ease.apply(joints, [], 1, field);
    if (field > 60) most = Math.max(most, Math.abs(angleOf(joints[2].r)));
  }
  assert.ok(most < 1, `drawn, it nods ${most.toFixed(2)} degrees`);
});

test('drawn, a turning head follows a wide turn no more than 6 degrees behind, then settles on it', async () => {
  const { HeadEase } = await import('../src/present/3d/fighter/head-ease.ts');
  const ease = new HeadEase();
  for (let field = 0; field < 300; field += 1) {
    /* The game turns the head 40 degrees, 10 a field, and keeps it there. */
    const game = Math.min(40, 10 * field);
    const joints = turning(game);
    ease.apply(joints, [], 1, field);
    const drawn = angleOf(joints[2].r);
    assert.ok(Math.abs(game - drawn) <= 6 + 1e-6, `field ${field}: ${drawn.toFixed(2)} for ${game}`);
    if (field === 299) assert.ok(Math.abs(game - drawn) < 0.1, `settled at ${drawn.toFixed(2)}`);
  }
});
