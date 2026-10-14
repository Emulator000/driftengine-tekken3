/** The skeleton's tables (`tables/skeleton.json`), validated. */
import type { SkeletonTables, Spring, SpringAim, SpringClear } from '../sim/data/skeleton.ts';
import { AssetError, expectArray, expectBoolean, expectInt, expectInts, expectObject } from './validate.ts';

/** The game's model packs, which the springs table has a row for. */
const SPRING_PACKS = 0x34;
const ACCESSORIES = 4;
const JOINTS = 22;

const shorts = (value: unknown, where: string, length: number): number[] => [...expectInts(value, where, length, (n) => new Int16Array(n), -0x8000, 0x7fff)];
const words = (value: unknown, where: string): number[] => [...expectInts(value, where, 6, (n) => new Int32Array(n), -0x80000000, 0x7fffffff)];

function parseAim(value: unknown, where: string): SpringAim {
  const o = expectObject(value, where);
  const weights = shorts(o.weights, `${where} weights`, 2);
  let behind: SpringAim['behind'] = null;
  if (o.behind !== null) {
    const b = expectObject(o.behind, `${where} behind`);
    behind = { aimAxes: words(b.aimAxes, `${where} behind.aimAxes`), axes: words(b.axes, `${where} behind.axes`) };
  }
  return { joint: expectInt(o.joint, `${where} joint`, 0, JOINTS - 1), point: shorts(o.point, `${where} point`, 3), weights: [weights[0]!, weights[1]!], behind };
}

/** A spring; its reach is a length, so its tip lies along its x. */
export function parseSpring(value: unknown, where: string): Spring {
  const o = expectObject(value, where);
  const short = (key: string, min = -0x8000): number => expectInt(o[key], `${where} ${key}`, min, 0x7fff);
  let limits: Spring['limits'] = null;
  if (o.limits !== null) {
    const [most, least] = shorts(o.limits, `${where} limits`, 2);
    limits = [most!, least!];
  }
  return {
    reach: short('reach', 0),
    keep: short('keep'),
    pull: short('pull'),
    slant: short('slant'),
    axes: words(o.axes, `${where} axes`),
    aim: o.aim === null ? null : parseAim(o.aim, `${where} aim`),
    knees: expectBoolean(o.knees, `${where} knees`),
    yawHeld: expectBoolean(o.yawHeld, `${where} yawHeld`),
    pitchAtLeast: o.pitchAtLeast === null ? null : expectInt(o.pitchAtLeast, `${where} pitchAtLeast`, -0x80000000, 0x7fffffff),
    limits,
    /* The console's springs follow their tip at once and lean with their slant. */
    smoothing: o.smoothing === undefined ? 1 : expectInt(o.smoothing, `${where} smoothing`, 1, 0x7fff),
    lean: o.lean === undefined ? true : expectBoolean(o.lean, `${where} lean`),
    clear: o.clear === undefined || o.clear === null ? null : parseClear(o.clear, `${where} clear`),
  };
}

function parseClear(value: unknown, where: string): SpringClear {
  const o = expectObject(value, where);
  const along = shorts(o.along, `${where} along`, 2);
  return { joint: expectInt(o.joint, `${where} joint`, 0, JOINTS - 1), along: [along[0]!, along[1]!], radius: expectInt(o.radius, `${where} radius`, 0, 0x7fff) };
}

export function parseSkeletonTables(json: unknown, where = 'tables/skeleton.json'): SkeletonTables {
  const o = expectObject(json, where);
  const offsets = expectObject(o.offsets, `${where} offsets`);
  const vector = (value: unknown, at: string): number[] => [...expectInts(value, at, 3, (n) => new Int32Array(n), -0x80000000, 0x7fffffff)];
  const pair = (key: string): [number[], number[]] => {
    const list = expectArray(offsets[key], `${where} offsets.${key}`, 2);
    return [vector(list[0], `${where} offsets.${key}[0]`), vector(list[1], `${where} offsets.${key}[1]`)];
  };
  const hands = expectObject(o.hands, `${where} hands`);
  const wings = expectObject(o.wings, `${where} wings`);
  /** A wing table: steps of the wings' model (41 of them), ending in two -1s and holding none before. */
  const wingFrames = (key: string): Int8Array => {
    const at = `${where} wings.${key}`;
    const frames = expectInts(wings[key], at, undefined, (n) => new Int8Array(n), -1, 40);
    const end = frames.indexOf(-1);
    if (end < 1 || end !== frames.length - 2 || frames[end + 1] !== -1) throw new AssetError(at, 'is not a run of steps ending in two -1s');
    return frames;
  };
  return {
    eulerJoints: expectInts(o.eulerJoints, `${where} eulerJoints`, 10, (n) => new Uint8Array(n), 0, 21),
    fixup: [...expectInts(o.fixup, `${where} fixup`, 9, (n) => new Int16Array(n), -0x8000, 0x7fff)],
    offsets: {
      chest: vector(offsets.chest, `${where} offsets.chest`),
      shoulders: pair('shoulders'),
      hips: vector(offsets.hips, `${where} offsets.hips`),
      hands: pair('hands'),
      feet: pair('feet'),
    },
    inverseRoots: expectInts(o.inverseRoots, `${where} inverseRoots`, 192, (n) => new Int16Array(n), -0x8000, 0x7fff),
    inverseRootsBefore: expectInts(o.inverseRootsBefore, `${where} inverseRootsBefore`, 192, (n) => new Int16Array(n), -0x8000, 0x7fff),
    partJoints: expectInts(o.partJoints, `${where} partJoints`, 22, (n) => new Uint8Array(n), 0, 21),
    partRecords: expectInts(o.partRecords, `${where} partRecords`, 22, (n) => new Uint8Array(n), 0, 0x1a),
    partDrawn: expectInts(o.partDrawn, `${where} partDrawn`, 22, (n) => new Uint8Array(n), 0, 1),
    accessoriesDrawn: expectArray(o.accessoriesDrawn, `${where} accessoriesDrawn`, 0x37).map((row, i) => expectInts(row, `${where} accessoriesDrawn[${i}]`, 4, (n) => new Uint8Array(n), 0, 0xff)),
    springs: expectArray(o.springs, `${where} springs`, SPRING_PACKS).map((row, pack) =>
      expectArray(row, `${where} springs[${pack}]`, ACCESSORIES).map((spring, k) => (spring === null ? null : parseSpring(spring, `${where} springs[${pack}][${k}]`))),
    ),
    hands: {
      fists: expectInts(hands.fists, `${where} hands.fists`, 0x37, (n) => new Uint8Array(n), 0, 7),
      open: expectInts(hands.open, `${where} hands.open`, 0x37, (n) => new Uint8Array(n), 0, 0xff),
    },
    wings: { opening: wingFrames('opening'), beating: wingFrames('beating') },
  };
}
