/**
 * The game's music: CD-XA audio in `\TEKKEN3\TEKKEN3.XAS`, eight channels interleaved sector by
 * sector (a sector's channel is its number in the file modulo 8, as its subheader says). The
 * executable's table at `0x80024d78` gives each song (50, twelve bytes each) the file's sectors it
 * spans, start and end, and its channel; the game plays one with the drive's channel filter set
 * to it.
 *
 * A song is kept as the drive hands it to the sound chip: its own channel's sectors in order, each
 * sector's audio (18 sound groups of 128 bytes), after a header of the coding byte all its sectors
 * share (stereo, 37.8 kHz, 4 bits for every song on the disc) and its first sector in the file.
 */
import { closeSync, openSync, readSync } from 'node:fs';

import { SECTOR } from './iso.mjs';

const CHANNELS = 8;
/** A Form 2 sector's subheader (file, channel, submode, coding) and its audio data. */
const SUBHEADER = 16;
const AUDIO = 24;
const AUDIO_BYTES = 18 * 128;
const SUBMODE_AUDIO = 0x04;
const SONGS = 50;
const SONG_TABLE = 0x80024d78;
const ENTRY = 12;
/** The header: 'XA', the coding byte, a spare byte, the first sector (32 bits). */
export const XA_HEADER = 8;

/** The songs' table from the executable image (loaded at `base`): `{ start, end, channel }` each. */
export function xaSongTable(exe, base) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  return Array.from({ length: SONGS }, (_, i) => {
    const at = SONG_TABLE - base + i * ENTRY;
    return { start: view.getInt32(at, true), end: view.getInt32(at + 4, true), channel: view.getUint16(at + 8, true) };
  });
}

/** Each song's sectors from the raw image (`imagePath`, 2352-byte sectors) of the XA file at `lba`. */
export function readXaSongs(imagePath, lba, table) {
  const fd = openSync(imagePath, 'r');
  const raw = Buffer.alloc(SECTOR);
  try {
    return table.map(({ start, end, channel }, song) => {
      const first = start + ((channel - (start % CHANNELS) + CHANNELS) % CHANNELS);
      const count = first < end ? Math.ceil((end - first) / CHANNELS) : 0;
      const out = new Uint8Array(XA_HEADER + count * AUDIO_BYTES);
      const view = new DataView(out.buffer);
      out.set([0x58, 0x41], 0);
      view.setUint32(4, first, true);
      let coding = -1;
      for (let k = 0; k < count; k += 1) {
        readSync(fd, raw, 0, SECTOR, (lba + first + k * CHANNELS) * SECTOR);
        const [, ownChannel, submode, sectorCoding] = raw.subarray(SUBHEADER, SUBHEADER + 4);
        if (ownChannel !== channel || (submode & SUBMODE_AUDIO) === 0) throw new Error(`song ${song}: sector ${first + k * CHANNELS} is not channel ${channel}'s audio`);
        if (coding >= 0 && sectorCoding !== coding) throw new Error(`song ${song}: its sectors change coding`);
        coding = sectorCoding;
        out.set(raw.subarray(AUDIO, AUDIO + AUDIO_BYTES), XA_HEADER + k * AUDIO_BYTES);
      }
      out[2] = coding < 0 ? 0 : coding;
      return out;
    });
  } finally {
    closeSync(fd);
  }
}
