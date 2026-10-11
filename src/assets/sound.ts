/** The fight's sound tables (`tables/sound.json`), validated. */
import type { ScriptWord, SoundCharacter, SoundTables } from '../sim/data/sound.ts';
import { expectArray, expectInt, expectInts, expectObject } from './validate.ts';

const halves = (value: unknown, where: string, length?: number): number[] => [...expectInts(value, where, length, (n) => new Int16Array(n), -0x8000, 0x7fff)];
const codes = (value: unknown, where: string, length?: number): number[] => [...expectInts(value, where, length, (n) => new Uint16Array(n), 0, 0xffff)];
const half = (o: Record<string, unknown>, key: string, where: string): number => expectInt(o[key], `${where}.${key}`, -0x8000, 0xffff);

function character(value: unknown, where: string): SoundCharacter {
  const o = expectObject(value, where);
  const lines = expectObject(o.lines, `${where}.lines`);
  const cries = expectObject(o.cries, `${where}.cries`);
  return {
    lines: { counts: halves(lines.counts, `${where}.lines.counts`, 4), codes: halves(lines.codes, `${where}.lines.codes`) },
    grunts: halves(o.grunts, `${where}.grunts`),
    cries: { light: half(cries, 'light', `${where}.cries`), heavy: half(cries, 'heavy', `${where}.cries`), codes: halves(cries.codes, `${where}.cries.codes`) },
    gruntWait: half(o, 'gruntWait', where),
    eventLine: half(o, 'eventLine', where),
  };
}

export function parseSoundTables(json: unknown, where = 'tables/sound.json'): SoundTables {
  const o = expectObject(json, where);
  return {
    effects: codes(o.effects, `${where} effects`),
    volumes: [...expectInts(o.volumes, `${where} volumes`, 16, (n) => new Uint8Array(n), 0, 0x7f)],
    mokujin: expectArray(o.mokujin, `${where} mokujin`).map((v, i) => {
      const e = expectObject(v, `${where} mokujin[${i}]`);
      return { effect: half(e, 'effect', `${where} mokujin[${i}]`), code: half(e, 'code', `${where} mokujin[${i}]`) };
    }),
    characters: expectArray(o.characters, `${where} characters`).map((v, i) => character(v, `${where} characters[${i}]`)),
    hitSounds: halves(o.hitSounds, `${where} hitSounds`, 10),
    otherHitSounds: halves(o.otherHitSounds, `${where} otherHitSounds`, 10),
    mokujinHits: halves(o.mokujinHits, `${where} mokujinHits`, 5),
    eventSounds: halves(o.eventSounds, `${where} eventSounds`, 3),
    scripts: expectArray(o.scripts, `${where} scripts`).map((s, i) =>
      expectArray(s, `${where} scripts[${i}]`).map((v, k): ScriptWord => {
        const at = `${where} scripts[${i}][${k}]`;
        const w = expectObject(v, at);
        return { frame: expectInt(w.frame, `${at}.frame`, 1, 0xfff), kind: expectInt(w.kind, `${at}.kind`, 0, 0xf), code: expectInt(w.code, `${at}.code`, 0, 0xffff) };
      }),
    ),
    roundCalls: codes(o.roundCalls, `${where} roundCalls`, 11),
    banks: expectArray(o.banks, `${where} banks`, 0x18).map((v, i) => expectInt(v, `${where} banks[${i}]`, 0, 0xff)),
  };
}
