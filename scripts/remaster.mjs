/**
 * `npm run remaster` (`node scripts/remaster.mjs [--cpu | --rocm | --cuda] [jobs...]`): the
 * remaster's assets made on this machine, from the data `npm run import` made, into
 * `public/assets/remaster/`, for REMASTER in REMAKE OPTION. Its tools are fetched into
 * `.cache/remaster/` the first time (`scripts/remaster/fetch.sh`: stable-diffusion.cpp, the models'
 * weights, each checked against its SHA-256, and a Python with PyTorch), then
 * `scripts/remaster/generate.py` makes every part (or the jobs named). PBRify's models run on the GPU
 * where there is one: an AMD one through ROCm, an NVIDIA one through CUDA, found by their tools
 * (`rocminfo`, `nvidia-smi`) unless named; on the CPU otherwise, far more slowly. Z-Image runs through
 * stable-diffusion.cpp's Vulkan build, so it needs a Vulkan driver (a GPU's, or Mesa's lavapipe on the
 * CPU). A run that stops picks up where it was. Linux only for now: that build is Linux's.
 *
 * What it makes is the game's content made over: for the user's own machine, never to share.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const named = args.find((a) => ['--cpu', '--rocm', '--cuda'].includes(a));
const jobs = args.filter((a) => !a.startsWith('--'));

if (process.platform !== 'linux') {
  console.error('npm run remaster runs on Linux for now: the image model\'s build it uses is Linux\'s.');
  process.exit(1);
}
if (!existsSync(path.join(root, 'public', 'assets', 'manifest.json'))) {
  console.error('The imported data is missing: run npm run import first.');
  process.exit(1);
}

/** Whether a command is on the path. */
const has = (command) => spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
const device = named ?? (has('rocminfo') ? '--rocm' : has('nvidia-smi') ? '--cuda' : '--cpu');
console.log(`remaster: PBRify ${device === '--cpu' ? 'on the CPU (slow: a GPU makes it many times faster)' : `on the GPU (${device.slice(2)})`}, Z-Image through Vulkan`);
if (!has('uv')) {
  console.error('The remaster\'s Python is made with uv (https://docs.astral.sh/uv/): install it, then run this again.');
  process.exit(1);
}
const missing = ['curl', 'unzip', 'sha256sum'].filter((command) => !has(command));
if (missing.length > 0) {
  console.error(`The remaster's tools are fetched with ${missing.join(', ')}: install ${missing.length > 1 ? 'them' : 'it'}, then run this again.`);
  process.exit(1);
}

const run = (command, commandArgs) => {
  const done = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, REMASTER_DEVICE: device.slice(2) } });
  if (done.status !== 0) process.exit(done.status ?? 1);
};
run('sh', [path.join(root, 'scripts', 'remaster', 'fetch.sh'), device]);
run('sh', [path.join(root, 'scripts', 'remaster', 'py'), path.join(root, 'scripts', 'remaster', 'generate.py'), ...(jobs.length > 0 ? jobs : ['all'])]);
console.log('remaster: made; turn REMASTER on in REMAKE OPTION (or open the game with ?remaster=on).');
