/** A moveset (`movesets/NN.json`, `movesets/common.json`), validated, its links checked against its lists. */
import { MOVE_IDS, type Cancel, type HitRef, type HitTable, type Move, type MoveEvent, type Moveset, type Ref } from '../sim/data/moveset.ts';
import { parseMovesetCamera } from './camera.ts';
import { AssetError, expectArray, expectBoolean, expectInt, expectInts, expectObject } from './validate.ts';

type Range = readonly [number, number];
const BYTE: Range = [0, 0xff];
const HALF: Range = [0, 0xffff];
const SIGNED_HALF: Range = [-0x8000, 0x7fff];
const WORD: Range = [0, 0xffffffff];

function int(o: Record<string, unknown>, key: string, where: string, [min, max]: Range): number {
  return expectInt(o[key], `${where}.${key}`, min, max);
}

function ref(value: unknown, where: string, ownCount: number): Ref {
  const o = expectObject(value, where);
  const common = expectBoolean(o.common, `${where}.common`);
  return { common, index: int(o, 'index', where, common ? HALF : [0, ownCount - 1]) };
}

function frameWindow(value: unknown, where: string): { first: number; last: number } {
  const o = expectObject(value, where);
  return { first: int(o, 'first', where, BYTE), last: int(o, 'last', where, BYTE) };
}

function hitRef(value: unknown, where: string, tables: number): HitRef {
  if (value === null) return null;
  const o = expectObject(value, where);
  if ('shared' in o) return { shared: int(o, 'shared', where, [0, 12]) };
  return { table: int(o, 'table', where, [0, tables - 1]) };
}

/** Hit data's four codes and its track. */
export function parseHitData(value: unknown, where: string): { codes: number[]; track: HitTable['track'] } {
  const o = expectObject(value, where);
  const codes = [...expectInts(o.codes, `${where}.codes`, 4, (n) => new Uint8Array(n), 0, 0xff)];
  if (o.track === null) return { codes, track: null };
  const track = expectObject(o.track, `${where}.track`);
  const points = expectInts(track.points, `${where}.track.points`, undefined, (n) => new Int16Array(n), -0x2000, 0x1fff);
  if (points.length % 3 !== 0) throw new AssetError(`${where}.track.points`, `has ${points.length} values, not whole points`);
  return { codes, track: { word: expectInt(track.word, `${where}.track.word`, 0, 0xffff), points } };
}

function hitTable(value: unknown, where: string): HitTable {
  const o = expectObject(value, where);
  return { offset: int(o, 'offset', where, [0, 0x7fffffff]), ...parseHitData(o, where) };
}

export function parseCancel(value: unknown, where: string): Cancel {
  const o = expectObject(value, where);
  return {
    command: int(o, 'command', where, HALF),
    condition: int(o, 'condition', where, BYTE),
    test: int(o, 'test', where, BYTE),
    param: int(o, 'param', where, HALF),
    target: int(o, 'target', where, HALF),
    type: int(o, 'type', where, BYTE),
    from: int(o, 'from', where, BYTE),
    to: int(o, 'to', where, BYTE),
    start: int(o, 'start', where, BYTE),
  };
}

function event(value: unknown, where: string): MoveEvent {
  const o = expectObject(value, where);
  return { frame: int(o, 'frame', where, SIGNED_HALF), code: int(o, 'code', where, BYTE), arg: int(o, 'arg', where, BYTE) };
}

interface Lists {
  readonly cancels: number;
  readonly sounds: number;
  readonly events: number;
  readonly hitTables: number;
}

function move(value: unknown, where: string, lists: Lists): Move {
  const o = expectObject(value, where);
  return {
    motion: ref(o.motion, `${where}.motion`, 0x10000),
    flags: int(o, 'flags', where, WORD),
    hitLevel: int(o, 'hitLevel', where, WORD),
    cancels: int(o, 'cancels', where, [0, lists.cancels - 1]),
    next: int(o, 'next', where, SIGNED_HALF),
    facingOffset: int(o, 'facingOffset', where, SIGNED_HALF),
    damage: int(o, 'damage', where, [0, 0x3fff]),
    damageFlags: int(o, 'damageFlags', where, [0, 3]),
    stepSpeed: int(o, 'stepSpeed', where, SIGNED_HALF),
    length: int(o, 'length', where, BYTE),
    stepWindow: frameWindow(o.stepWindow, `${where}.stepWindow`),
    endFrame: int(o, 'endFrame', where, BYTE),
    sounds: int(o, 'sounds', where, [-1, lists.sounds - 1]),
    events: int(o, 'events', where, [-1, lists.events - 1]),
    hitFlags: int(o, 'hitFlags', where, WORD),
    hit: hitRef(o.hit, `${where}.hit`, lists.hitTables),
    hitStun: int(o, 'hitStun', where, BYTE),
    activeWindow: frameWindow(o.activeWindow, `${where}.activeWindow`),
    pushShape: int(o, 'pushShape', where, HALF),
    throwReaction: int(o, 'throwReaction', where, HALF),
    reactionKind: int(o, 'reactionKind', where, HALF),
  };
}

export function parseMoveset(json: unknown, where: string): Moveset {
  const o = expectObject(json, where);
  const cancels = expectArray(o.cancels, `${where} cancels`).map((v, i) => parseCancel(v, `${where} cancels[${i}]`));
  const sounds = expectArray(o.sounds, `${where} sounds`).map((v, i) => expectInt(v, `${where} sounds[${i}]`, 0, 0xffff));
  const events = expectArray(o.events, `${where} events`).map((v, i) => event(v, `${where} events[${i}]`));
  const hitTables = expectArray(o.hitTables, `${where} hitTables`).map((v, i) => hitTable(v, `${where} hitTables[${i}]`));
  const lists = { cancels: cancels.length, sounds: sounds.length, events: events.length, hitTables: hitTables.length };
  const moves = expectArray(o.moves, `${where} moves`).map((v, i) => move(v, `${where} moves[${i}]`, lists));
  const moveIds = expectArray(o.moveIds, `${where} moveIds`).map((v, i) => (v === null ? null : ref(v, `${where} moveIds[${i}]`, moves.length)));
  if (moveIds.length !== 0 && moveIds.length !== MOVE_IDS) throw new AssetError(`${where} moveIds`, `has ${moveIds.length} ids, not 0 or ${MOVE_IDS}`);
  const missing = expectArray(o.missing, `${where} missing`).map((v, i) => expectInt(v, `${where} missing[${i}]`, 0, MOVE_IDS - 1));
  const lacking = new Set(missing);
  moveIds.forEach((r, id) => {
    if (r === null && !lacking.has(id)) throw new AssetError(`${where} moveIds[${id}]`, 'has no move but is not missing');
  });
  return { moves, cancels, moveIds, missing, sounds, events, hitTables, ...parseMovesetCamera(o, where) };
}
