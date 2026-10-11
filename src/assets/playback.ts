/** The sound banks for playing (`sound/banks.json` and each bank's PCM) and the music's tables (`sound/music.json`), validated. */
import type { PlayableBank, PlayableBanks, PlayableTone } from '../present/sound/banks.ts';
import type { MusicTables, SongPick } from '../sim/sound/music.ts';
import { expectArray, expectBoolean, expectInt, expectObject, expectString } from './validate.ts';

const byte = (value: unknown, where: string): number => expectInt(value, where, 0, 0xff);
const word = (value: unknown, where: string): number => expectInt(value, where, 0, 0xffff);

function tone(value: unknown, where: string): PlayableTone {
  const o = expectObject(value, where);
  return {
    mode: byte(o.mode, `${where}.mode`),
    volume: byte(o.volume, `${where}.volume`),
    pan: byte(o.pan, `${where}.pan`),
    centre: byte(o.centre, `${where}.centre`),
    fine: byte(o.fine, `${where}.fine`),
    adsr1: word(o.adsr1, `${where}.adsr1`),
    adsr2: word(o.adsr2, `${where}.adsr2`),
    vag: word(o.vag, `${where}.vag`),
  };
}

/** A bank's attributes, and its PCM file's name for `pcm` to fetch. */
async function bank(value: unknown, where: string, pcm: (file: string) => Promise<ArrayBuffer>): Promise<PlayableBank> {
  const o = expectObject(value, where);
  const samples = new Int16Array(await pcm(expectString(o.file, `${where}.file`)));
  const waveforms = expectArray(o.waveforms, `${where}.waveforms`).map((w, i) => {
    const at = `${where}.waveforms[${i}]`;
    const v = expectObject(w, at);
    const offset = expectInt(v.offset, `${at}.offset`, 0, samples.length);
    const length = expectInt(v.length, `${at}.length`, 0, samples.length - offset);
    return { offset, length, loop: expectInt(v.loop, `${at}.loop`, -1, length) };
  });
  return {
    volume: byte(o.volume, `${where}.volume`),
    programs: expectArray(o.programs, `${where}.programs`).map((p, i) => {
      const v = expectObject(p, `${where}.programs[${i}]`);
      return { firstTone: expectInt(v.firstTone, `${where}.programs[${i}].firstTone`, 0, 0x7f), volume: byte(v.volume, `${where}.programs[${i}].volume`), pan: byte(v.pan, `${where}.programs[${i}].pan`) };
    }),
    tones: expectArray(o.tones, `${where}.tones`).map((t, i) => tone(t, `${where}.tones[${i}]`)),
    waveforms,
    pcm: samples,
  };
}

/** The banks, `json` the parsed `sound/banks.json` and `pcm` fetching a bank's PCM by its file's name. */
export async function loadPlayableBanks(json: unknown, pcm: (file: string) => Promise<ArrayBuffer>, where = 'sound/banks.json'): Promise<PlayableBanks> {
  const o = expectObject(json, where);
  const fighters = expectObject(o.fighters, `${where} fighters`);
  return {
    pitches: expectArray(o.pitches, `${where} pitches`, 12 * 16).map((v, i) => word(v, `${where} pitches[${i}]`)),
    effects: await Promise.all(expectArray(o.effects, `${where} effects`, 2).map((b, i) => bank(b, `${where} effects[${i}]`, pcm))),
    fighters: Object.fromEntries(await Promise.all(Object.entries(fighters).map(async ([id, b]) => [Number(id), await bank(b, `${where} fighters.${id}`, pcm)] as const))),
    theater: await bank(o.theater, `${where} theater`, pcm),
  };
}

function pick(value: unknown, where: string): SongPick {
  const o = expectObject(value, where);
  return { xa: expectInt(o.xa, `${where}.xa`, 0, 0x7f), track: expectBoolean(o.track, `${where}.track`), volume: expectInt(o.volume, `${where}.volume`, 0, 0x7f), loops: expectBoolean(o.loops, `${where}.loops`) };
}

export function parseMusicTables(json: unknown, where = 'sound/music.json'): MusicTables {
  const o = expectObject(json, where);
  return {
    picks: expectArray(o.picks, `${where} picks`, 32).map((v, i) => {
      const [a, b] = expectArray(v, `${where} picks[${i}]`, 2);
      return [pick(a, `${where} picks[${i}][0]`), pick(b, `${where} picks[${i}][1]`)] as const;
    }),
    xaSongs: expectArray(o.xaSongs, `${where} xaSongs`).map((v, i) => {
      const s = expectObject(v, `${where} xaSongs[${i}]`);
      const first = expectInt(s.first, `${where} xaSongs[${i}].first`, 0, 0x7fffffff);
      return { first, end: expectInt(s.end, `${where} xaSongs[${i}].end`, first, 0x7fffffff) };
    }),
    tracks: expectArray(o.tracks, `${where} tracks`).map((v, i) => {
      const t = expectObject(v, `${where} tracks[${i}]`);
      return { track: expectInt(t.track, `${where} tracks[${i}].track`, 1, 99), sectors: expectInt(t.sectors, `${where} tracks[${i}].sectors`, 0, 0xfffffff) };
    }),
    set: expectInt(o.set, `${where} set`, 0, 2),
    stereo: expectInt(o.stereo, `${where} stereo`, 0, 1),
    volume: expectInt(o.volume, `${where} volume`, 0, 0x7f),
  };
}
