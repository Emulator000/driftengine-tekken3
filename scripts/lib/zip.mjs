/**
 * A zip archive's files written into a folder: those stored or deflated, each checked against its
 * CRC-32, a program kept runnable by the permissions an archive made on Unix gives it. Each file
 * is written beside its place and then moved into it, so a program it replaces is a new file
 * rather than one rewritten in place (which a Mac refuses to run again).
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

const END = 0x06054b50;
const ENTRY = 0x02014b50;
const LOCAL = 0x04034b50;
const UNIX = 3;

/** The files of the zip archive `archive` written into `dir`; their paths, relative to it. */
export function extractZip(archive, dir) {
  const zip = readFileSync(archive);
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error(`${archive}: not a zip archive`);
  const root = path.resolve(dir);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const written = [];
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(at) !== ENTRY) throw new Error(`${archive}: its list of files is damaged`);
    const madeOn = zip.readUInt16LE(at + 4) >> 8;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength).replaceAll('\\', '/');
    const mode = madeOn === UNIX ? zip.readUInt32LE(at + 38) >>> 16 : 0;
    const local = zip.readUInt32LE(at + 42);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);

    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw new Error(`${archive}: ${name} lies outside the folder`);
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if ((flags & 1) !== 0) throw new Error(`${archive}: ${name} is encrypted`);
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error(`${archive}: ${name} is too large to read (zip64)`);
    if ((mode & 0o170000) === 0o120000) throw new Error(`${archive}: ${name} is a link, which is not extracted`);
    if (method !== 0 && method !== 8) throw new Error(`${archive}: ${name} is packed in a way not read (method ${method})`);
    if (zip.readUInt32LE(local) !== LOCAL) throw new Error(`${archive}: ${name} is damaged`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const stored = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(stored) : stored;
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${archive}: ${name} is damaged (its CRC-32 does not match)`);

    mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    writeFileSync(part, data);
    if (process.platform !== 'win32' && (mode & 0o777) !== 0) chmodSync(part, mode & 0o777);
    renameSync(part, target);
    written.push(name);
  }
  return written;
}
