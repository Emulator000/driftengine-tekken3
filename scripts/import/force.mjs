/**
 * Tekken Force's tables (`tables/force.json`), from its overlay (BNS 7, loaded at `0x800b0548`) and
 * its four stages' archives (BNS 51 to 54):
 *
 * - the wave entries (`0x800b0548`, 0x31 of {type, kind, 0}; type 99 ends a list);
 * - per enemy kind its gauge's length and the seconds its fall adds (`0x800b0670`);
 * - each stage's health by kind (`0x800b0684`, 16.16), the soldiers' costumes by stage and type
 *   (`0x800b06e8`), the boss fight's par frames (`0x800b06f4`) and the stage bonus (`0x800b0708`);
 * - the boss each character meets on each stage (`0x800b6378`, a pointer per roster code to four
 *   {roster, costume}, costume -1 by the player's own);
 * - the progress bar's four colours (`0x800b6518`);
 * - the versus screen's places (`0x800b6540` the portrait's, `0x800b6548` the name's, `0x800b6550`
 *   the stage name's right edge and line, `0x800b6554` its slide), the stages' names
 *   (`0x800b6558`, two lines each) and their colours (`0x800b6580`), and its three lines;
 * - per stage, from its archive: the script (the fourth member, 128 records of 0x14 bytes: s32
 *   distance, s16 op, x, 0, z, 0, argument, kind, 0) and the backdrop's map (the third: u16
 *   columns, rows, then each cell's texture word and each cell's palette word).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const OVERLAY = 0x800b0548;
const STAGES = [51, 52, 53, 54];
const SCRIPT = { records: 128, size: 0x14 };

/** An archive's members: a count, then each member's offset and size. */
function members(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint32(0, true) }, (_, i) => bytes.subarray(view.getUint32(4 + i * 8, true), view.getUint32(4 + i * 8, true) + view.getUint32(8 + i * 8, true)));
}

function stage(bytes) {
  const [, , map, script] = members(bytes);
  const mapView = new DataView(map.buffer, map.byteOffset, map.byteLength);
  const [columns, rows] = [mapView.getUint16(0, true), mapView.getUint16(2, true)];
  const cells = columns * rows;
  const scriptView = new DataView(script.buffer, script.byteOffset, script.byteLength);
  return {
    script: Array.from({ length: SCRIPT.records }, (_, i) => {
      const at = i * SCRIPT.size;
      const s16 = (k) => scriptView.getInt16(at + k, true);
      return [scriptView.getInt32(at, true), s16(4), s16(6), s16(0xa), s16(0xe), s16(0x10)];
    }),
    backdrop: {
      columns,
      rows,
      codes: Array.from({ length: cells }, (_, i) => mapView.getUint16(4 + i * 2, true)),
      cluts: Array.from({ length: cells }, (_, i) => mapView.getUint16(4 + (cells + i) * 2, true)),
    },
  };
}

export function forceTables(root) {
  const overlay = new Uint8Array(readFileSync(path.join(root, 'public/data/bns/007.bin')));
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength);
  const at = (address) => address - OVERLAY;
  const s16 = (address) => view.getInt16(at(address), true);
  const u16 = (address) => view.getUint16(at(address), true);
  const s32 = (address) => view.getInt32(at(address), true);
  const u32 = (address) => view.getUint32(at(address), true);
  const text = (address) => {
    let s = '';
    for (let i = at(address); overlay[i]; i += 1) s += String.fromCharCode(overlay[i]);
    return s.replace(/^(%[cfhvHV])+/, '');
  };
  const place = (address) => ({ x: s16(address), y: s16(address + 2), slideX: s16(address + 4), slideY: s16(address + 6) });
  return {
    waves: Array.from({ length: 0x31 }, (_, i) => [s16(0x800b0548 + i * 6), s16(0x800b054a + i * 6)]),
    kinds: Array.from({ length: 5 }, (_, k) => ({ gauge: u16(0x800b0670 + k * 4), seconds: u16(0x800b0672 + k * 4) })),
    health: Array.from({ length: 5 }, (_, s) => Array.from({ length: 5 }, (_, k) => s32(0x800b0684 + (s * 5 + k) * 4))),
    costumes: Array.from({ length: 6 }, (_, s) => [overlay[at(0x800b06e8) + s * 2], overlay[at(0x800b06e8) + s * 2 + 1]]),
    par: Array.from({ length: 5 }, (_, s) => s32(0x800b06f4 + s * 4)),
    stageBonus: Array.from({ length: 5 }, (_, s) => s32(0x800b0708 + s * 4)),
    bosses: Array.from({ length: 0x5c }, (_, code) => {
      const record = u32(0x800b6378 + code * 4);
      return Array.from({ length: 4 }, (_, s) => [u16(record + s * 4), s16(record + s * 4 + 2)]);
    }),
    barColours: Array.from({ length: 4 }, (_, k) => Array.from(overlay.subarray(at(0x800b6518) + k * 4, at(0x800b6518) + k * 4 + 3))),
    versus: {
      portrait: place(0x800b6540),
      name: place(0x800b6548),
      stageName: { x: s16(0x800b6550), y: s16(0x800b6552), slideX: s16(0x800b6554), slideY: s16(0x800b6556) },
      names: Array.from({ length: 5 }, (_, s) => [text(u32(0x800b6558 + s * 8)), text(u32(0x800b6558 + s * 8 + 4))]),
      colours: Array.from(overlay.subarray(at(0x800b6580), at(0x800b6580) + 5)),
      title: text(0x800b0abc),
      stage: text(0x800b0ad4),
      finalStage: text(0x800b0ae8),
    },
    stages: STAGES.map((n) => stage(new Uint8Array(readFileSync(path.join(root, `public/data/bns/${String(n).padStart(3, '0')}.bin`))))),
  };
}
