/** The fight camera's tables (`tables/camera.json`), and a moveset's own shots and scripts, validated. */
import type { BuiltInShot, CameraScript, CameraTables, Scene, SceneCall, SceneChoice, ScriptSegment, ShotChoice, ShotName } from '../sim/data/camera.ts';
import { AssetError, expectArray, expectInt, expectInts, expectObject } from './validate.ts';

const HALF = [-0x8000, 0x7fff] as const;
const int = (o: Record<string, unknown>, key: string, where: string, [min, max]: readonly [number, number]): number => expectInt(o[key], `${where}.${key}`, min, max);
const halves = (value: unknown, where: string, length?: number): number[] => [...expectInts(value, where, length, (n) => new Int16Array(n), -0x8000, 0x7fff)];

function shotName(value: unknown, where: string, scripts: number): ShotName {
  if (typeof value === 'number') return expectInt(value, where, -0x80000000, 0x7fffffff);
  const o = expectObject(value, where);
  return { script: int(o, 'script', where, [0, scripts - 1]) };
}

function shotChoice(value: unknown, where: string, scripts: number): ShotChoice {
  const o = expectObject(value, where);
  return { kind: int(o, 'kind', where, HALF), odds: int(o, 'odds', where, [0, 0xffff]), shot: shotName(o.shot, `${where}.shot`, scripts) };
}

function segment(value: unknown, where: string): ScriptSegment {
  const o = expectObject(value, where);
  switch (o.kind) {
    case 'constant':
      return { kind: 'constant', length: int(o, 'length', where, [0, 0x3ff]), value: int(o, 'value', where, HALF) };
    case 'linear':
      return { kind: 'linear', length: int(o, 'length', where, [0, 0x3ff]), start: int(o, 'start', where, [0, 0xffff]), slope: int(o, 'slope', where, HALF) };
    case 'keys': {
      const steps = expectInts(o.steps, `${where}.steps`, undefined, (n) => new Int32Array(n), -0x10000, 0x10000);
      return { kind: 'keys', start: int(o, 'start', where, HALF), steps, spans: expectInts(o.spans, `${where}.spans`, steps.length, (n) => new Uint8Array(n), 1, 32) };
    }
    case 'samples':
      return { kind: 'samples', values: expectInts(o.values, `${where}.values`, undefined, (n) => new Int16Array(n), -0x8000, 0x7fff) };
    default:
      throw new AssetError(`${where}.kind`, `is ${String(o.kind)}, not a segment's kind`);
  }
}

function cameraScript(value: unknown, where: string): CameraScript {
  const o = expectObject(value, where);
  return {
    side: int(o, 'side', where, [0, 0xffff]),
    frames: int(o, 'frames', where, [0, 0x3ff]),
    channels: expectArray(o.channels, `${where}.channels`).map((c, i) => expectArray(c, `${where}.channels[${i}]`).map((s, k) => segment(s, `${where}.channels[${i}][${k}]`))),
  };
}

/** A moveset's camera shots and the scripts they name. */
export function parseMovesetCamera(o: Record<string, unknown>, where: string): { shots: ShotChoice[]; scripts: CameraScript[] } {
  const scripts = expectArray(o.scripts, `${where} scripts`).map((v, i) => cameraScript(v, `${where} scripts[${i}]`));
  const shots = expectArray(o.shots, `${where} shots`).map((v, i) => shotChoice(v, `${where} shots[${i}]`, scripts.length));
  return { shots, scripts };
}

function builtInShot(value: unknown, where: string): BuiltInShot {
  const o = expectObject(value, where);
  return { length: int(o, 'length', where, HALF), exit: int(o, 'exit', where, HALF), pitches: halves(o.pitches, `${where}.pitches`, 4), yaws: halves(o.yaws, `${where}.yaws`, 4) };
}

function scene(value: unknown, where: string): Scene {
  const o = expectObject(value, where);
  return {
    kind: int(o, 'kind', where, HALF),
    hold: int(o, 'hold', where, HALF),
    length: int(o, 'length', where, HALF),
    close: int(o, 'close', where, HALF),
    reach: ((r) => [r[0]!, r[1]!] as const)(expectArray(o.reach, `${where}.reach`, 2).map((v, i) => expectInt(v, `${where}.reach[${i}]`, -0x80000000, 0x7fffffff))),
    pitches: halves(o.pitches, `${where}.pitches`, 4),
    yaws: halves(o.yaws, `${where}.yaws`, 4),
  };
}

export function parseCameraTables(json: unknown, where = 'tables/camera.json'): CameraTables {
  const o = expectObject(json, where);
  const scenes = expectArray(o.scenes, `${where} scenes`).map((v, i) => scene(v, `${where} scenes[${i}]`));
  const sceneLists = expectArray(o.sceneLists, `${where} sceneLists`).map((list, i) =>
    expectArray(list, `${where} sceneLists[${i}]`).map((v, k): SceneChoice => {
      const at = `${where} sceneLists[${i}][${k}]`;
      const e = expectObject(v, at);
      return { odds: int(e, 'odds', at, HALF), scenes: [...expectInts(e.scenes, `${at}.scenes`, 4, (n) => new Uint16Array(n), 0, scenes.length - 1)] };
    }),
  );
  const sceneCalls = expectArray(o.sceneCalls, `${where} sceneCalls`, 4).map((v, i): SceneCall => {
    const at = `${where} sceneCalls[${i}]`;
    const e = expectObject(v, at);
    return { character: int(e, 'character', at, HALF), moveId: int(e, 'moveId', at, HALF), list: int(e, 'list', at, [0, sceneLists.length - 1]) };
  });
  const knockout = expectObject(o.knockout, `${where} knockout`);
  return {
    moveShots: expectArray(o.moveShots, `${where} moveShots`).map((v, i) => (v === null ? null : shotChoice(v, `${where} moveShots[${i}]`, 0))),
    shots: expectArray(o.shots, `${where} shots`, 30).map((v, i) => builtInShot(v, `${where} shots[${i}]`)),
    shotRows: [...expectInts(o.shotRows, `${where} shotRows`, 30, (n) => new Int16Array(n), 0, 30)],
    noShotExit: int(o, 'noShotExit', where, HALF),
    scriptExit: int(o, 'scriptExit', where, HALF),
    sceneLists,
    sceneCalls,
    scenes,
    openingSweeps: expectArray(o.openingSweeps, `${where} openingSweeps`, 10).map((v, i) => halves(v, `${where} openingSweeps[${i}]`, 3)),
    knockout: { ahead: halves(knockout.ahead, `${where} knockout.ahead`, 3), out: halves(knockout.out, `${where} knockout.out`, 3), heights: halves(knockout.heights, `${where} knockout.heights`, 3) },
    attractShots: [...expectInts(o.attractShots, `${where} attractShots`, 4, (n) => new Uint16Array(n), 0, 0xffff)],
    orbitPitches: [...expectInts(o.orbitPitches, `${where} orbitPitches`, 8, (n) => new Int16Array(n), -0x8000, 0x7fff)],
    orbitSpeeds: [...expectInts(o.orbitSpeeds, `${where} orbitSpeeds`, 2, (n) => new Int16Array(n), -0x8000, 0x7fff)],
  };
}
