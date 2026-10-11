/** The fight's effect tables (`tables/effects.json`), validated. */
import type { EffectTables, FireTables, LightningStroke, SparkLook } from '../sim/data/effects.ts';
import { expectArray, expectInt, expectInts, expectNumber, expectObject } from './validate.ts';

const point = (value: unknown, where: string): number[] => [...expectInts(value, where, 3, (n) => new Int16Array(n), -0x8000, 0x7fff)];
const bytes = (value: unknown, where: string, length?: number): number[] => [...expectInts(value, where, length, (n) => new Uint8Array(n), 0, 0xff)];

function spark(value: unknown, where: string): SparkLook {
  const o = expectObject(value, where);
  return { frames: expectInt(o.frames, `${where}.frames`, 0, 0xffff), colour: bytes(o.colour, `${where}.colour`, 3) };
}

export function parseEffectTables(json: unknown, where = 'tables/effects.json'): EffectTables {
  const o = expectObject(json, where);
  return {
    mouth: expectArray(o.mouth, `${where} mouth`, 2).map((v, i) => point(v, `${where} mouth[${i}]`)),
    breathHurts: bytes(o.breathHurts, `${where} breathHurts`, 21),
    glowJoints: expectArray(o.glowJoints, `${where} glowJoints`, 0x100).map((v, i) => expectInt(v, `${where} glowJoints[${i}]`, 0, 0xffffffff)),
    glowOffsets: expectArray(o.glowOffsets, `${where} glowOffsets`, 22).map((row, i) => expectArray(row, `${where} glowOffsets[${i}]`, 2).map((v, k) => point(v, `${where} glowOffsets[${i}][${k}]`))),
    glowColour: bytes(o.glowColour, `${where} glowColour`, 3),
    puffs: expectArray(o.puffs, `${where} puffs`, 6).map((v, i) => point(v, `${where} puffs[${i}]`)),
    characterSparks: expectArray(o.characterSparks, `${where} characterSparks`).map((v, i) => spark(v, `${where} characterSparks[${i}]`)),
    introSparks: expectArray(o.introSparks, `${where} introSparks`, 2).map((v, i) => expectInt(v, `${where} introSparks[${i}]`, 0, 21)),
    genericSparks: expectArray(o.genericSparks, `${where} genericSparks`, 4).map((v, i) => spark(v, `${where} genericSparks[${i}]`)),
    shakes: expectArray(o.shakes, `${where} shakes`, 3).map((v, i) => [...expectInts(v, `${where} shakes[${i}]`, undefined, (n) => new Int8Array(n), -0x80, 0x7f)]),
    fire: parseFire(o.fire, `${where} fire`),
    lightning: expectArray(o.lightning, `${where} lightning`, 22).map((frame, k) =>
      expectArray(frame, `${where} lightning[${k}]`).map((v, i): LightningStroke => {
        const at = `${where} lightning[${k}][${i}]`;
        const stroke = expectObject(v, at);
        const points = expectArray(stroke.points, `${at}.points`).map((n, j) => expectNumber(n, `${at}.points[${j}]`, 0, 32));
        const brightness = expectArray(stroke.brightness, `${at}.brightness`, points.length / 2).map((n, j) => expectNumber(n, `${at}.brightness[${j}]`, 0, 1));
        return { points, brightness };
      }),
    ),
  };
}

function parseFire(value: unknown, where: string): FireTables {
  const o = expectObject(value, where);
  const pair = (v: unknown, at: string): number[][] => expectArray(v, at, 2).map((p, i) => point(p, `${at}[${i}]`));
  return {
    colour: bytes(o.colour, `${where}.colour`, 3),
    mouths: expectArray(o.mouths, `${where}.mouths`, 2).map((v, i) => pair(v, `${where}.mouths[${i}]`)),
    gonMouth: pair(o.gonMouth, `${where}.gonMouth`),
    gonFlames: pair(o.gonFlames, `${where}.gonFlames`),
    burningJoints: expectArray(o.burningJoints, `${where}.burningJoints`, 10).map((v, i) => expectInt(v, `${where}.burningJoints[${i}]`, 0, 23)),
    going: bytes(o.going, `${where}.going`, 8),
    gonHurts: bytes(o.gonHurts, `${where}.gonHurts`, 9),
    schedule: expectArray(o.schedule, `${where}.schedule`).map((v, i) => {
      const e = expectObject(v, `${where}.schedule[${i}]`);
      return { frame: expectInt(e.frame, `${where}.schedule[${i}].frame`, 0, 0x7fff), speed: expectInt(e.speed, `${where}.schedule[${i}].speed`, -0x8000, 0x7fff), height: expectInt(e.height, `${where}.schedule[${i}].height`, -0x8000, 0x7fff) };
    }),
    columnHurts: bytes(o.columnHurts, `${where}.columnHurts`, 0x1b),
  };
}
