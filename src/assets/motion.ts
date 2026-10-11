/** Motions (`motions/NN.json`) and the cubic's tables (`tables/motion.json`), validated. */
import { CHANNELS, type Channel, type CurveTables, type Motion } from '../sim/data/motion.ts';
import { AssetError, expectArray, expectBoolean, expectInt, expectInts, expectObject } from './validate.ts';

function channel(value: unknown, where: string, frames: number): Channel {
  const o = expectObject(value, where);
  const reversed = expectBoolean(o.reversed, `${where}.reversed`);
  const half = (key: string, min = -0x8000, max = 0x7fff): number => expectInt(o[key], `${where}.${key}`, min, max);
  switch (o.kind) {
    case 'zero':
      return { kind: 'zero', reversed };
    case 'constant':
      return { kind: 'constant', reversed, value: half('value') };
    case 'linear':
      return { kind: 'linear', reversed, start: half('start', 0, 0xffff), slope: half('slope') };
    case 'samples':
      return { kind: 'samples', reversed, values: expectInts(o.values, `${where}.values`, frames, (n) => new Int16Array(n), -0x8000, 0x7fff) };
    case 'keys': {
      const steps = expectInts(o.steps, `${where}.steps`, undefined, (n) => new Int32Array(n), -0x8000, 0x7fff);
      if (steps.length === 0) throw new AssetError(`${where}.steps`, 'is empty');
      const spans = expectInts(o.spans, `${where}.spans`, steps.length, (n) => new Uint8Array(n), 1, 32);
      return { kind: 'keys', reversed, start: half('start'), steps, spans };
    }
    default:
      throw new AssetError(`${where}.kind`, `is ${String(o.kind)}, not a channel kind`);
  }
}

export function parseMotions(json: unknown, where: string): Motion[] {
  const o = expectObject(json, where);
  return expectArray(o.motions, `${where} motions`).map((value, i) => {
    const at = `${where} motions[${i}]`;
    const m = expectObject(value, at);
    const frames = expectInt(m.frames, `${at}.frames`, 1, 0xff);
    return { id: expectInt(m.id, `${at}.id`, -0x8000, 0x7fff), frames, channels: expectArray(m.channels, `${at}.channels`, CHANNELS).map((c, k) => channel(c, `${at}.channels[${k}]`, frames)) };
  });
}

export function parseCurveTables(json: unknown, where = 'tables/motion.json'): CurveTables {
  const o = expectObject(json, where);
  const weights = (key: string): Uint16Array => expectInts(o[key], `${where} ${key}`, 256, (n) => new Uint16Array(n), 0, 0xffff);
  return {
    segment: expectArray(o.segment, `${where} segment`, 33).map((row, length) => expectInts(row, `${where} segment[${length}]`, length + 1, (n) => new Uint8Array(n), 0, 0xff)),
    back: weights('back'),
    after: weights('after'),
    next: weights('next'),
    first: weights('first'),
  };
}
