/**
 * Kazuya's voice for the port, from Tekken 4's: his sound bank and his voice record in Tekken 3's
 * forms.
 *
 * Tekken 4 keeps a voice record per sound character (0x28 bytes from `RECORDS`, his the 15th):
 * line lists for kinds 2, 3 and 4 (counts at `+2`, `+4`, `+6`, lists at `+8`, `+0xc`, `+0x10`), the
 * frames a grunt waits (`+0x14`), and the grunts' and the two cry lists (counts at `+0x16` to
 * `+0x1a`, lists at `+0x1c` to `+0x24`), its lines as sound ids and its grunts and cries as lines
 * by kind and number, all as Tekken 3's record has them. A sound id resolves through the banks at
 * `BANKS` (16 bytes: entries, kind, first id, count) to an entry of 8 bytes: the sample's offset
 * in its bank, its pitch (the SPU2's, 0x1000 at 48 kHz), volume and voice. His lines are bank 46's,
 * his character's second sound file (660), 13 samples at pitch 0x555, 16 kHz.
 *
 * Tekken 3 keeps its voices at about 8 kHz (a tone's centre 90 above its number and a shift of 50,
 * 0x2e3 at 44.1 kHz) and the two fighters' banks in 172 KB of sound RAM; his are taken to that rate
 * and encoded again, so his bank fits beside anyone's. Tone 0 of program 0, Tekken 3's winner's
 * line (0xc640), has no Tekken 4 counterpart and stays empty; his samples are tones 1 to 13.
 */
import { decodeAdpcm, encodeAdpcm, resample } from '../adpcm.mjs';

/** Where the executable's data sits in the file. */
const SEGMENT = { address: 0x180080, offset: 0x1080 };
const RECORDS = 0x31cc00;
const RECORD_BYTES = 0x28;
const BANKS = 0x31b190;
/** His voice record. */
const KAZUYA_RECORD = 15;
/** Tekken 4's sound chip's rate at pitch 0x1000, and Tekken 3's voices' rate (0x2e3 at 44.1 kHz). */
const SPU2_RATE = 48000;
const T3_VOICE_RATE = (0x2e3 / 0x1000) * 44100;
/** The code his lines play as in Tekken 3: his bank (3), voice 6 (the side's past 5), volume 6 of the game's volume table, program 0. */
const LINE_CODE = 0xc000 | (6 << 10) | (6 << 6);

/** Tekken 4's record and sound tables, read from its executable. */
function readT4(exe) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const at = (address) => address - SEGMENT.address + SEGMENT.offset;
  const u16 = (address) => view.getUint16(at(address), true);
  const s16 = (address) => view.getInt16(at(address), true);
  const u32 = (address) => view.getUint32(at(address), true);
  const list = (pointer, count) => Array.from({ length: count }, (_, i) => u16(pointer + i * 2));
  const record = RECORDS + KAZUYA_RECORD * RECORD_BYTES;
  const voice = {
    lines: [2, 3, 4].map((kind, k) => list(u32(record + 8 + k * 4), s16(record + 2 + k * 2))),
    wait: s16(record + 0x14),
    grunts: list(u32(record + 0x1c), s16(record + 0x16)),
    cries: [list(u32(record + 0x20), s16(record + 0x18)), list(u32(record + 0x24), s16(record + 0x1a))],
  };
  const ids = voice.lines.flat();
  const first = Math.min(...ids);
  for (let k = 0; ; k += 1) {
    const bank = BANKS + k * 16;
    const start = u16(bank + 0xa);
    const count = u16(bank + 0xc);
    if (start <= first && first < start + count) {
      const entries = Array.from({ length: count }, (_, i) => ({ id: start + i, offset: view.getInt32(at(u32(bank) + i * 8), true), pitch: u16(u32(bank) + i * 8 + 4) }));
      return { voice, entries };
    }
    if (k > 80) throw new Error('no Tekken 4 sound bank holds his lines');
  }
}

/**
 * His bank and record: `t4Exe` Tekken 4's executable, `bank` his sound file (660), `heihachiVh`
 * Heihachi's bank header in Tekken 3 (its program and tone records, the template). Gives the
 * bank's header and body, and the record's lists (`voice`: the body's size, the grunt wait, then
 * the lines, grunts and cries lists as Tekken 3 keeps them, at the byte offsets its head gives).
 */
export function kazuyaVoice({ t4Exe, bank, heihachiVh }) {
  const { voice, entries } = readT4(t4Exe);
  const lineIds = voice.lines.flat();
  const samples = entries.filter((e) => lineIds.includes(e.id)).sort((a, b) => a.offset - b.offset);
  if (samples.length > 15) throw new Error(`${samples.length} samples do not fit one program`);
  const tone = new Map(samples.map((e, i) => [e.id, i + 1]));
  const waveforms = samples.map((e) => encodeAdpcm(resample(decodeAdpcm(bank, e.offset), (e.pitch / 0x1000) * SPU2_RATE, T3_VOICE_RATE)));

  /* The header: Heihachi's with one program of his tones, their waveforms' sizes after. */
  const programs = 0x20;
  const tones = programs + 0x80 * 0x10;
  const sizes = tones + 0x200;
  const vh = new Uint8Array(sizes + 0x200);
  const view = new DataView(vh.buffer);
  vh.set(heihachiVh.subarray(0, 0x20));
  const body = waveforms.reduce((n, w) => n + w.length, 0);
  view.setUint32(0xc, vh.length + body, true);
  view.setUint16(0x12, 1, true);
  view.setUint16(0x14, samples.length, true);
  view.setUint16(0x16, samples.length, true);
  vh.set(heihachiVh.subarray(programs, programs + 0x10), programs);
  vh[programs] = samples.length + 1;
  /* Heihachi's second tone as the template (his first is his winner's line): volume, pan, envelope. */
  const toneTemplate = heihachiVh.subarray(tones + 0x20, tones + 0x40);
  samples.forEach((e, i) => {
    const t = i + 1;
    const record = tones + t * 0x20;
    vh.set(toneTemplate, record);
    vh[record + 4] = 90 + t;
    vh[record + 5] = 50;
    vh[record + 6] = 60 + t;
    vh[record + 7] = 60 + t;
    view.setUint16(record + 0x14, 0, true);
    view.setUint16(record + 0x16, t, true);
  });
  view.setUint16(sizes, 0, true);
  waveforms.forEach((w, i) => view.setUint16(sizes + (i + 1) * 2, w.length >> 3, true));
  const vb = new Uint8Array(body);
  let at = 0;
  for (const w of waveforms) {
    vb.set(w, at);
    at += w.length;
  }

  /* The record's lists: the lines (counts for kinds 2 to 5, then the codes), the grunts, the cries. */
  const lines = [...voice.lines.map((l) => l.length), 0, ...lineIds.map((id) => LINE_CODE | tone.get(id))];
  const grunts = [voice.grunts.length, ...voice.grunts];
  const cries = [voice.cries[0].length, voice.cries[1].length, ...voice.cries.flat()];
  const head = 12;
  const words = [...lines, ...grunts, ...cries];
  const record = new Uint8Array(head + words.length * 2);
  const out = new DataView(record.buffer);
  out.setUint32(0, body, true);
  out.setUint16(4, voice.wait, true);
  out.setUint16(6, head, true);
  out.setUint16(8, head + lines.length * 2, true);
  out.setUint16(10, head + (lines.length + grunts.length) * 2, true);
  words.forEach((w, i) => out.setUint16(head + i * 2, w, true));
  return { vh, vb, voice: record, lines: voice, tones: samples.length };
}
