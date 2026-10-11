/** The sound banks' timing (`tables/banks.json`), validated. */
import type { SoundBank, SoundBanks, Tone } from '../sim/data/banks.ts';
import { expectArray, expectInt, expectInts, expectObject } from './validate.ts';

function bank(value: unknown, where: string): SoundBank {
  const o = expectObject(value, where);
  const vags = expectArray(o.vags, `${where}.vags`).map((v, i) => [...expectInts(v, `${where}.vags[${i}]`, undefined, (n) => new Uint8Array(n), 0, 0xff)]);
  return {
    firstTones: [...expectInts(o.firstTones, `${where}.firstTones`, undefined, (n) => new Uint8Array(n), 0, 0xff)],
    tones: expectArray(o.tones, `${where}.tones`).map((v, i): Tone => {
      const at = `${where}.tones[${i}]`;
      const t = expectObject(v, at);
      return {
        centre: expectInt(t.centre, `${at}.centre`, 0, 0xff),
        fine: expectInt(t.fine, `${at}.fine`, 0, 0xff),
        adsr1: expectInt(t.adsr1, `${at}.adsr1`, 0, 0xffff),
        adsr2: expectInt(t.adsr2, `${at}.adsr2`, 0, 0xffff),
        vag: expectInt(t.vag, `${at}.vag`, 0, vags.length - 1 + 0x10000),
      };
    }),
    vags,
  };
}

export function parseSoundBanks(json: unknown, where = 'tables/banks.json'): SoundBanks {
  const o = expectObject(json, where);
  const fighters = expectObject(o.fighters, `${where} fighters`);
  return {
    pitches: [...expectInts(o.pitches, `${where} pitches`, 192, (n) => new Uint16Array(n), 0, 0xffff)],
    effects: expectArray(o.effects, `${where} effects`, 2).map((v, i) => bank(v, `${where} effects[${i}]`)),
    fighters: Object.fromEntries(Object.entries(fighters).map(([id, v]) => [Number(id), bank(v, `${where} fighters[${id}]`)])),
    theater: bank(o.theater, `${where} theater`),
  };
}
