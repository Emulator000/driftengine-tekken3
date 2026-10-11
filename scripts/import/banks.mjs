/**
 * The sound banks, as far as the fight times its voices by them: per bank its tones (the note each
 * plays at, its fine tune, its envelope's two words and its waveform) and per waveform the flags of
 * each of its 16-byte blocks (bit 0 its end, bit 1 to repeat from its loop, bit 2 the loop's start).
 * A tone is found as the sound library finds it: its program's first tone (the count of used
 * programs before it) times sixteen, plus the tone. With the table of pitches a note plays at
 * (0x8009ad18, sixteen per semitone).
 *
 * The effects' two banks are in the executable (headers at 0x80025850 and 0x80026a70, bodies at
 * 0x800d366c and 0x8011001c); a fighter's is its character pack's (`public/data/fighters/NN.vh`
 * and `.vb`), by its sound bank (0x80027890 by sound character, the character's from its roster
 * record's `+8`; Kazuya's 0x15 in his pack 52). The Theater's is in its overlay (BNS 301: header
 * at 0x800e051c, body at 0x800e113c), which it opens as VAB 2 for the credits.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PITCHES = 0x8009ad18;
const EFFECT_BANKS = [
  { header: 0x80025850, body: 0x800d366c },
  { header: 0x80026a70, body: 0x8011001c },
];
const BANK_OF = 0x80027890;
const ROSTER = 0x80097d40;
const PACKS = 0x800958c4;
const ROWS = 22;
const KAZUYA_BANK = 0x15;
const KAZUYA_PACK = 52;
const THEATER = 0x800b8d58;
const THEATER_BANK = { header: 0x800e051c, body: 0x800e113c };

/** A bank from its header and body, read through `u8` at offsets into each. */
function bank(header, body) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const magic = view.getUint32(0, true);
  if (magic >>> 8 !== 0x564142) throw new Error('a sound bank without its VAB magic');
  const version = view.getUint32(4, true);
  const capacity = (magic & 0xff) === 0x70 && 4 < version ? 0x80 : 0x40;
  const programCount = view.getUint16(0x12, true);
  const waveforms = view.getUint8(0x16);
  const programs = 0x20;
  const firstTones = [];
  let used = 0;
  for (let p = 0; p < capacity; p += 1) {
    firstTones.push(used);
    if (view.getUint8(programs + p * 0x10) !== 0) used += 1;
  }
  const tones = programs + capacity * 0x10;
  const toneList = Array.from({ length: programCount * 16 }, (_, i) => {
    const at = tones + i * 0x20;
    return { centre: view.getUint8(at + 4), fine: view.getUint8(at + 5), adsr1: view.getUint16(at + 0x10, true), adsr2: view.getUint16(at + 0x12, true), vag: view.getUint16(at + 0x16, true) };
  });
  const sizes = tones + programCount * 0x200;
  const size = (i) => view.getUint16(sizes + i * 2, true) << (4 < version ? 3 : 2);
  const vags = [[]];
  let start = size(0);
  for (let n = 1; n <= waveforms; n += 1) {
    const length = size(n);
    const flags = [];
    for (let k = 0; k * 16 < length; k += 1) flags.push(start + k * 16 + 1 < body.length ? body[start + k * 16 + 1] : 0);
    vags.push(flags);
    start += length;
  }
  return { firstTones, tones: toneList, vags };
}

/** Each bank's header and body: the effects' two from the executable, then the fighters' by sound bank. */
export function bankSources(exe, root) {
  const bytes = (address, count) => Uint8Array.from({ length: count }, (_, i) => exe.u8(address + i));
  const effects = EFFECT_BANKS.map(({ header, body }) => {
    const head = bytes(header, 0x20);
    const view = new DataView(head.buffer);
    const version = view.getUint32(4, true);
    const capacity = (view.getUint32(0, true) & 0xff) === 0x70 && 4 < version ? 0x80 : 0x40;
    const programCount = view.getUint16(0x12, true);
    const waveforms = view.getUint8(0x16);
    const headerBytes = 0x20 + capacity * 0x10 + programCount * 0x200 + 0x200;
    const full = bytes(header, headerBytes);
    const fullView = new DataView(full.buffer);
    const sizes = 0x20 + capacity * 0x10 + programCount * 0x200;
    let total = 0;
    for (let i = 0; i <= waveforms; i += 1) total += fullView.getUint16(sizes + i * 2, true) << (4 < version ? 3 : 2);
    return { header: full, body: bytes(body, Math.min(total, 0x7eff0)) };
  });
  const packOf = new Map();
  for (let code = 0; code < ROWS * 4; code += 1) {
    const record = exe.u32(ROSTER + code * 4);
    if (record === 0) continue;
    const id = exe.u8(BANK_OF + exe.u8(record + 8));
    if (id !== 0xff && !packOf.has(id)) packOf.set(id, exe.u8(PACKS + code));
  }
  packOf.set(KAZUYA_BANK, KAZUYA_PACK);
  /* The Theater's own bank, in its overlay (BNS 301, at 0x800b8d58): its header and body. */
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/301.bin')));
  const theater = (() => {
    const header = overlay.subarray(THEATER_BANK.header - THEATER, THEATER_BANK.body - THEATER);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const version = view.getUint32(4, true);
    const capacity = (view.getUint32(0, true) & 0xff) === 0x70 && 4 < version ? 0x80 : 0x40;
    const programCount = view.getUint16(0x12, true);
    const sizes = 0x20 + capacity * 0x10 + programCount * 0x200;
    let total = 0;
    for (let i = 0; i <= view.getUint8(0x16); i += 1) total += view.getUint16(sizes + i * 2, true) << (4 < version ? 3 : 2);
    return { header: Uint8Array.from(header), body: Uint8Array.from(overlay.subarray(THEATER_BANK.body - THEATER, THEATER_BANK.body - THEATER + total)) };
  })();
  const fighters = [];
  for (const [id, pack] of [...packOf].sort((a, b) => a[0] - b[0])) {
    const file = (ext) => path.join(root, `public/data/fighters/${String(pack).padStart(2, '0')}.${ext}`);
    if (!existsSync(file('vh')) || !existsSync(file('vb'))) continue;
    fighters.push({ id, header: new Uint8Array(readFileSync(file('vh'))), body: new Uint8Array(readFileSync(file('vb'))) });
  }
  return { effects, fighters, theater };
}

export function soundBanks(exe, root) {
  const { effects, fighters, theater } = bankSources(exe, root);
  return {
    pitches: Array.from({ length: 12 * 16 }, (_, i) => exe.u16(PITCHES + i * 2)),
    effects: effects.map(({ header, body }) => bank(header, body)),
    fighters: Object.fromEntries(fighters.map(({ id, header, body }) => [id, bank(header, body)])),
    theater: bank(theater.header, theater.body),
  };
}

/* ---- The banks for playing. ---- */

/** The chip's ADPCM filters' weights for the last sample and the one before, in 64ths. */
const POSITIVE = [0, 60, 115, 98, 122];
const NEGATIVE = [0, 0, -52, -55, -60];
const clamp16 = (v) => (v < -0x8000 ? -0x8000 : v > 0x7fff ? 0x7fff : v);

/**
 * A waveform's blocks from `start` decoded as the chip decodes them (28 samples a 16-byte block:
 * its shift and filter, then two samples a byte, each the nibble shifted down and the filter's
 * weighing of the two before added), up to the block marked its end or `limit` bytes. Its loop
 * starts at the last block marked a loop start before its end (its first block when none is) and
 * runs when the end block asks to repeat; -1 when it does not.
 */
export function decodeWaveform(body, start, limit) {
  const samples = [];
  let last = 0;
  let before = 0;
  let loop = 0;
  let repeats = false;
  for (let at = start; at + 16 <= Math.min(body.length, start + limit); at += 16) {
    const header = body[at];
    let shift = header & 0xf;
    if (shift > 12) shift = 9;
    const filter = Math.min((header >> 4) & 7, 4);
    const flags = body[at + 1];
    if ((flags & 4) !== 0) loop = samples.length;
    for (let k = 0; k < 28; k += 1) {
      const byte = body[at + 2 + (k >> 1)];
      const nibble = (k & 1) === 0 ? byte & 0xf : byte >> 4;
      const sample = clamp16((((nibble << 28) >> 16) >> shift) + ((last * POSITIVE[filter] + before * NEGATIVE[filter] + 32) >> 6));
      samples.push(sample);
      before = last;
      last = sample;
    }
    if ((flags & 1) !== 0) {
      repeats = (flags & 2) !== 0;
      break;
    }
  }
  return { samples: Int16Array.from(samples), loop: repeats ? loop : -1 };
}

/**
 * A bank as the presentation plays it: its PCM (every waveform decoded, end to end) and what the
 * sound library keys a voice by: the bank's volume (`+0x18`), each program's first tone, volume
 * (`+1`) and pan (`+4`), each tone's mode (`+1`), volume (`+2`), pan (`+3`), note (`+4`), fine
 * tune (`+5`), envelope words (`+0x10`, `+0x12`) and waveform (`+0x16`), and each waveform's place
 * in the PCM, its length and its loop's start (-1 none).
 */
function playableBank(header, body) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const version = view.getUint32(4, true);
  const capacity = (view.getUint32(0, true) & 0xff) === 0x70 && 4 < version ? 0x80 : 0x40;
  const programCount = view.getUint16(0x12, true);
  const waveformCount = view.getUint8(0x16);
  const programs = [];
  let used = 0;
  for (let p = 0; p < capacity; p += 1) {
    const at = 0x20 + p * 0x10;
    programs.push({ firstTone: used, volume: view.getUint8(at + 1), pan: view.getUint8(at + 4) });
    if (view.getUint8(at) !== 0) used += 1;
  }
  const toneBase = 0x20 + capacity * 0x10;
  const tones = Array.from({ length: programCount * 16 }, (_, i) => {
    const at = toneBase + i * 0x20;
    return {
      mode: view.getUint8(at + 1),
      volume: view.getUint8(at + 2),
      pan: view.getUint8(at + 3),
      centre: view.getUint8(at + 4),
      fine: view.getUint8(at + 5),
      adsr1: view.getUint16(at + 0x10, true),
      adsr2: view.getUint16(at + 0x12, true),
      vag: view.getUint16(at + 0x16, true),
    };
  });
  const sizes = toneBase + programCount * 0x200;
  const size = (i) => view.getUint16(sizes + i * 2, true) << (4 < version ? 3 : 2);
  const pcm = [];
  let offset = 0;
  const waveforms = [{ offset: 0, length: 0, loop: -1 }];
  let start = size(0);
  for (let n = 1; n <= waveformCount; n += 1) {
    const { samples, loop } = decodeWaveform(body, start, size(n));
    waveforms.push({ offset, length: samples.length, loop });
    pcm.push(samples);
    offset += samples.length;
    start += size(n);
  }
  const all = new Int16Array(offset);
  let at = 0;
  for (const samples of pcm) {
    all.set(samples, at);
    at += samples.length;
  }
  return { attributes: { volume: view.getUint8(0x18), programs, tones, waveforms }, pcm: all };
}

/**
 * The banks for playing: their attributes (`sound/banks.json`, the pitch table with them) and each
 * one's PCM (`sound/banks/effects-N.pcm`, `sound/banks/fighter-NN.pcm`, 16-bit little-endian).
 */
export function playableBanks(exe, root, output) {
  const { effects, fighters, theater } = bankSources(exe, root);
  const write = (name, { header, body }) => {
    const { attributes, pcm } = playableBank(header, body);
    output.bytes(`sound/banks/${name}.pcm`, new Uint8Array(pcm.buffer));
    return { file: `${name}.pcm`, ...attributes };
  };
  output.json('sound/banks.json', {
    pitches: Array.from({ length: 12 * 16 }, (_, i) => exe.u16(PITCHES + i * 2)),
    effects: effects.map((source, i) => write(`effects-${i}`, source)),
    fighters: Object.fromEntries(fighters.map((source) => [source.id, write(`fighter-${String(source.id).padStart(2, '0')}`, source)])),
    theater: write('theater', theater),
  });
}
