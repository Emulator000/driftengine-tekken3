/**
 * The ISO 9660 file system on a raw PlayStation disc image: 2352-byte sectors, Mode 2 Form 1, so
 * each sector's 2048 bytes of data start 24 bytes in (sync, header, subheader).
 */
import { closeSync, openSync, readSync } from 'node:fs';

export const SECTOR = 2352;
const DATA = 2048;
const DATA_AT = 24;

export function openDisc(file) {
  const fd = openSync(file, 'r');
  const raw = Buffer.alloc(SECTOR);

  /** `count` sectors' data from `lba`, joined. */
  function sectors(lba, count) {
    const out = Buffer.alloc(count * DATA);
    for (let i = 0; i < count; i += 1) {
      readSync(fd, raw, 0, SECTOR, (lba + i) * SECTOR);
      raw.copy(out, i * DATA, DATA_AT, DATA_AT + DATA);
    }
    return out;
  }

  /** The bytes of a file, by its directory entry. */
  function read(entry) {
    return sectors(entry.lba, Math.ceil(entry.size / DATA)).subarray(0, entry.size);
  }

  /** Every file and directory, depth first, with its path, first sector and size. */
  function list() {
    const pvd = sectors(16, 1);
    if (pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error(`${file}: no ISO 9660 volume at sector 16`);
    const out = [];
    const walk = (lba, size, prefix) => {
      const dir = sectors(lba, Math.ceil(size / DATA));
      for (let at = 0; at < size; ) {
        const length = dir[at];
        if (length === 0) {
          at = (Math.floor(at / DATA) + 1) * DATA;
          continue;
        }
        const nameLength = dir[at + 32];
        const name = dir.toString('latin1', at + 33, at + 33 + nameLength);
        const entry = {
          path: `${prefix}/${name.replace(/;1$/, '')}`,
          lba: dir.readUInt32LE(at + 2),
          size: dir.readUInt32LE(at + 10),
          directory: (dir[at + 25] & 2) !== 0,
        };
        if (nameLength === 1 && (dir[at + 33] === 0 || dir[at + 33] === 1)) {
          at += length;
          continue;
        }
        out.push(entry);
        if (entry.directory) walk(entry.lba, entry.size, entry.path);
        at += length;
      }
    };
    walk(pvd.readUInt32LE(156 + 2), pvd.readUInt32LE(156 + 10), '');
    return out;
  }

  return { sectors, read, list, close: () => closeSync(fd) };
}
