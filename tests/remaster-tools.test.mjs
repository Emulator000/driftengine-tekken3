/** The remaster's tools: the zip reader its programs are unpacked with, and what each system runs them with. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import { extractZip } from '../scripts/lib/zip.mjs';
import { pythonIn, remasterDevice, remasterHost, torchFor } from '../scripts/remaster/tools.mjs';

/** A zip archive of `files` (`name`, `data`, Unix `mode`, `deflate`d or stored), as made on Unix. */
function zipOf(files) {
  const locals = [];
  const entries = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), mode = 0o100644, deflate = false, crc = crc32(data) } of files) {
    const packed = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 30, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    entries.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const list = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(list.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, list, end]);
}

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'tekken3-remaster-'));

test('a zip archive is written out, stored and deflated files alike, a program kept runnable', () => {
  const dir = tmp();
  const archive = path.join(dir, 'tools.zip');
  const program = Buffer.from('#!/bin/sh\necho made\n'.repeat(40));
  writeFileSync(archive, zipOf([
    { name: 'notes.txt', data: Buffer.from('notes') },
    { name: 'lib/', mode: 0o40755 },
    { name: 'bin/run', data: program, mode: 0o100755, deflate: true },
  ]));
  const out = path.join(dir, 'out');
  assert.deepEqual(extractZip(archive, out), ['notes.txt', 'bin/run']);
  assert.equal(readFileSync(path.join(out, 'notes.txt'), 'utf8'), 'notes');
  assert.deepEqual(readFileSync(path.join(out, 'bin/run')), program);
  assert.ok(statSync(path.join(out, 'lib')).isDirectory());
  if (process.platform !== 'win32') assert.equal(statSync(path.join(out, 'bin/run')).mode & 0o777, 0o755);
  assert.ok(!existsSync(path.join(out, 'bin/run.part')), 'nothing left beside it');

  writeFileSync(path.join(out, 'bin/run'), 'old');
  const before = statSync(path.join(out, 'bin/run')).ino;
  extractZip(archive, out);
  assert.deepEqual(readFileSync(path.join(out, 'bin/run')), program, 'written again over the old');
  if (process.platform !== 'win32') assert.notEqual(statSync(path.join(out, 'bin/run')).ino, before, 'as a new file, not the old one rewritten');
});

test('a zip archive that is damaged or reaches outside its folder is refused', () => {
  const dir = tmp();
  const archive = path.join(dir, 'bad.zip');
  writeFileSync(archive, zipOf([{ name: 'a.txt', data: Buffer.from('made'), crc: 1234 }]));
  assert.throws(() => extractZip(archive, path.join(dir, 'out')), /CRC-32 does not match/);
  writeFileSync(archive, zipOf([{ name: '../escaped.txt', data: Buffer.from('made') }]));
  assert.throws(() => extractZip(archive, path.join(dir, 'out')), /outside the folder/);
  assert.ok(!existsSync(path.join(dir, 'escaped.txt')));
  writeFileSync(archive, zipOf([{ name: 'link', data: Buffer.from('target'), mode: 0o120777 }]));
  assert.throws(() => extractZip(archive, path.join(dir, 'out')), /is a link/);
  writeFileSync(archive, Buffer.from('not a zip at all, just some bytes that go on for a while'));
  assert.throws(() => extractZip(archive, path.join(dir, 'out')), /not a zip archive/);
});

test('each system runs the remaster with its own build, Python and devices, or says why it cannot', () => {
  const linux = remasterHost({ platform: 'linux', arch: 'x64', release: '6.8.0' });
  assert.equal(linux.build.cli, 'sd-cli');
  assert.equal(linux.build.api, 'Vulkan');
  assert.match(linux.build.zip, /Linux-.*x86_64-vulkan\.zip$/);
  assert.equal(linux.python, '3.12');
  const windows = remasterHost({ platform: 'win32', arch: 'x64', release: '10.0.26100' });
  assert.equal(windows.build.cli, 'sd-cli.exe');
  assert.match(windows.build.zip, /win-vulkan-x64\.zip$/);
  const mac = remasterHost({ platform: 'darwin', arch: 'arm64', release: '25.1.0' });
  assert.equal(mac.build.api, 'Metal');
  assert.match(mac.build.zip, /Darwin-.*arm64\.zip$/);
  assert.equal(mac.python, 'cpython-3.12-macos-aarch64-none', "Apple silicon's Python");
  assert.equal(remasterHost({ platform: 'darwin', arch: 'x64', release: '25.1.0', translated: true }).build, mac.build, 'Node through Rosetta on Apple silicon');
  for (const builds of [linux, windows, mac]) assert.match(builds.build.sha256, /^[0-9a-f]{64}$/);

  assert.match(remasterHost({ platform: 'linux', arch: 'arm64', release: '6.8.0' }).error, /x64 PC/);
  assert.match(remasterHost({ platform: 'darwin', arch: 'x64', release: '25.1.0' }).error, /Apple silicon/);
  assert.match(remasterHost({ platform: 'darwin', arch: 'arm64', release: '24.6.0' }).error, /macOS 26/, 'macOS 15 is Darwin 24');
  assert.match(remasterHost({ platform: 'freebsd', arch: 'x64', release: '14.1' }).error, /Linux, Windows and macOS/);
});

test("PBRify's device: a GPU whose tool is found, else the CPU; one named where the system offers it", () => {
  const linux = remasterHost({ platform: 'linux', arch: 'x64', release: '6.8.0' });
  const windows = remasterHost({ platform: 'win32', arch: 'x64', release: '10.0.26100' });
  const mac = remasterHost({ platform: 'darwin', arch: 'arm64', release: '25.1.0' });
  const found = (...tools) => (tool) => (tools.includes(tool) ? `/usr/bin/${tool}` : undefined);
  assert.equal(remasterDevice(linux, undefined, found('rocminfo', 'nvidia-smi')), 'rocm', 'AMD first, as before');
  assert.equal(remasterDevice(linux, undefined, found('nvidia-smi')), 'cuda');
  assert.equal(remasterDevice(linux, undefined, found()), 'cpu');
  assert.equal(remasterDevice(windows, undefined, found('rocminfo')), 'cpu', "ROCm's PyTorch is not built for Windows");
  assert.equal(remasterDevice(windows, undefined, found('nvidia-smi')), 'cuda');
  assert.equal(remasterDevice(mac, undefined, found()), 'mps');
  assert.equal(remasterDevice(mac, 'cpu', found()), 'cpu');
  assert.equal(remasterDevice(linux, 'cuda', found('rocminfo')), 'cuda');
  assert.throws(() => remasterDevice(windows, 'rocm', found()), /--rocm is not offered on this system, which offers --cuda and --cpu/);
  assert.throws(() => remasterDevice(mac, 'cuda', found()), /--mps and --cpu/);
  assert.throws(() => remasterDevice(linux, 'mps', found()), /--rocm, --cuda and --cpu/);
});

test('PyTorch for each system and device, and where its Python is', () => {
  assert.deepEqual(torchFor('linux', 'rocm'), { index: 'rocm7.2', version: '2.14.1+rocm7.2', folder: 'py-rocm' });
  assert.deepEqual(torchFor('linux', 'cuda'), { index: 'cu130', version: '2.14.1+cu130', folder: 'py-cuda' });
  assert.deepEqual(torchFor('linux', 'cpu'), { index: 'cpu', version: '2.14.1+cpu', folder: 'py' });
  assert.deepEqual(torchFor('win32', 'cuda'), { index: 'cu130', version: '2.14.1+cu130', folder: 'py-cuda' });
  assert.deepEqual(torchFor('win32', 'cpu'), { index: 'cpu', version: '2.14.1+cpu', folder: 'py' });
  assert.deepEqual(torchFor('darwin', 'mps'), { index: 'cpu', version: '2.14.1', folder: 'py' }, "a Mac's build has no local version");
  assert.deepEqual(torchFor('darwin', 'cpu'), torchFor('darwin', 'mps'));
  assert.equal(pythonIn('venv', 'win32'), path.join('venv', 'Scripts', 'python.exe'));
  assert.equal(pythonIn('venv', 'linux'), path.join('venv', 'bin', 'python'));
});
