/**
 * `npm run remaster` (`node scripts/remaster.mjs [--cpu | --rocm | --cuda | --mps] [jobs...]`): the
 * remaster's assets made on this machine, from the data `npm run import` made, into
 * `public/assets/remaster/`, for REMASTER in REMAKE OPTION. Its tools are fetched into
 * `.cache/remaster/` the first time (`scripts/remaster/tools.mjs`: stable-diffusion.cpp's build for
 * this system, the models' weights, each checked against its SHA-256, and a Python with PyTorch),
 * then `scripts/remaster/generate.py` makes every part (or the jobs named). PBRify's models run on
 * the GPU where there is one: on Linux an AMD one through ROCm or an NVIDIA one through CUDA, on
 * Windows an NVIDIA one through CUDA, found by their tools (`rocminfo`, `nvidia-smi`) unless named;
 * on a Mac its GPU through Metal (MPS); on the CPU otherwise, far more slowly. Z-Image runs through
 * stable-diffusion.cpp: its Vulkan build on Linux and Windows (a GPU's Vulkan driver, or Mesa's
 * lavapipe on Linux's CPU), its Metal build on a Mac. It runs on an x64 PC with Linux or Windows,
 * and on a Mac with Apple silicon and macOS 26 or later. A run that stops picks up where it was.
 *
 * What it makes is the game's content made over: for the user's own machine, never to share.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanEnv, fetchTools, remasterDevice, remasterHost, which } from './remaster/tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const named = args.find((a) => ['--cpu', '--rocm', '--cuda', '--mps'].includes(a));
const jobs = args.filter((a) => !a.startsWith('--'));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** Whether this Node runs on a Mac through Rosetta. */
const translated = () => process.platform === 'darwin' && spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).stdout?.trim() === '1';
const host = remasterHost({ platform: process.platform, arch: process.arch, release: os.release(), translated: process.arch === 'x64' && translated() });
if (host.error !== undefined) fail(host.error);
if (!existsSync(path.join(root, 'public', 'assets', 'manifest.json'))) fail('The imported data is missing: run npm run import first.');

let device;
try {
  device = remasterDevice(host, named?.slice(2), which);
} catch (error) {
  fail(error.message);
}
const gpu = { rocm: 'the GPU (rocm)', cuda: 'the GPU (cuda)', mps: 'the GPU (Metal)' }[device];
console.log(`remaster: PBRify on ${gpu ?? 'the CPU (slow: a GPU makes it many times faster)'}, Z-Image through ${host.build.api}`);
const uv = which('uv');
if (uv === undefined) {
  const install = { win32: ' (winget install astral-sh.uv)', darwin: ' (brew install uv)' }[process.platform] ?? '';
  fail(`The remaster's Python is made with uv (https://docs.astral.sh/uv/): install it${install}, then run this again.`);
}

let python;
try {
  python = await fetchTools(path.join(root, '.cache', 'remaster'), host, device, uv);
} catch (error) {
  fail(error.message);
}
/* ROCm picks its kernels quickly rather than timing every one the first time it meets a shape. */
const env = cleanEnv({ REMASTER_DEVICE: device, ...(device === 'rocm' ? { MIOPEN_FIND_MODE: 'FAST' } : {}) });
const done = spawnSync(python, ['-I', path.join(root, 'scripts', 'remaster', 'generate.py'), ...(jobs.length > 0 ? jobs : ['all'])], { cwd: root, stdio: 'inherit', env });
if (done.error !== undefined) fail(`The remaster's Python did not start: ${done.error.message}`);
if (done.status !== 0) process.exit(done.status ?? 1);
console.log('remaster: made; turn REMASTER on in REMAKE OPTION (or open the game with ?remaster=on).');
