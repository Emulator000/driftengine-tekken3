/**
 * The remaster's tools, into `.cache/remaster/`, for the system `npm run remaster` runs on:
 * stable-diffusion.cpp's build for it (Vulkan's on Linux and Windows, Metal's on a Mac), started
 * once to see that it runs and which GPU it finds; Z-Image-Turbo with its text encoder and
 * autoencoder, and PBRify's models, each checked against its SHA-256 as it comes; then a Python
 * with PyTorch and spandrel made by uv, the CPU's PyTorch or the GPU's for the device named (ROCm
 * for an AMD GPU on Linux, CUDA for an NVIDIA one on Linux or Windows; a Mac's PyTorch has Metal's
 * in it).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { extractZip } from '../lib/zip.mjs';

const RELEASE = 'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-964-1d0a58a/';

/** stable-diffusion.cpp's build for each system, all of one release: its archive, the program, the API it draws with and the names of that API's devices. */
const BUILDS = {
  linux: {
    zip: 'sd-master-1d0a58a-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip',
    sha256: 'bade142929edfa7aad56aba46376e55142d14390262b904f4a2deb3a03ceb21d',
    saved: 'sd-vulkan.zip',
    cli: 'sd-cli',
    api: 'Vulkan',
    gpu: 'Vulkan',
  },
  win32: {
    zip: 'sd-master-1d0a58a-bin-win-vulkan-x64.zip',
    sha256: '74211cb5c382aec2aeb086b64f2fdf525efec5faec4200a2d3257bc2328954ab',
    saved: 'sd-vulkan.zip',
    cli: 'sd-cli.exe',
    api: 'Vulkan',
    gpu: 'Vulkan',
  },
  darwin: {
    zip: 'sd-master-1d0a58a-bin-Darwin-macOS-26.6.2-arm64.zip',
    sha256: '45001839e925f98ecd18ef5251725f74cff874eeac4599f1136acba65b26911e',
    saved: 'sd-metal.zip',
    cli: 'sd-cli',
    api: 'Metal',
    gpu: 'MTL',
  },
};

const WEIGHTS = [
  ['https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf', 'weights/zimage/z_image_turbo-Q4_K.gguf', '14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd'],
  ['https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', 'weights/qwen3/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'],
  ['https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors', 'weights/vae/ae.safetensors', 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38'],
  ['https://github.com/Kim2091/Kim2091-Models/releases/download/4x-PBRify_UpscalerV4/4x-PBRify_UpscalerV4.pth', 'weights/pbrify/4x-PBRify_UpscalerV4.pth', '82db39e31e01da6816a9814c0553a8dcdb7bd2d655353e67075c9295068cb789'],
  ['https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_NormalV3.pth', 'weights/pbrify/1x-PBRify_NormalV3.pth', 'b0a18270da765f02eaae3c228203bee0677fc28b2854a562515e4aae9c61223b'],
  ['https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_Height.pth', 'weights/pbrify/1x-PBRify_Height.pth', '5b973ecb8bae9d96d14d77b8a8f1d88fb6a8580bcc1bb55d2872811acdc4277d'],
  ['https://github.com/Kim2091/PBRify_Remix/raw/main/Models/1x-PBRify_RoughnessV2.pth', 'weights/pbrify/1x-PBRify_RoughnessV2.pth', '7003c39041af64cdb77d5120bd560a2878538fbb14a07657d8fd12aac5773679'],
];

const TORCH = '2.14.1';

/** Each system's devices for PBRify's models, in the order tried: a GPU where its tool is on the path, else the next; the CPU last. */
const DEVICES = {
  linux: [['rocm', 'rocminfo'], ['cuda', 'nvidia-smi'], ['cpu']],
  win32: [['cuda', 'nvidia-smi'], ['cpu']],
  darwin: [['mps'], ['cpu']],
};

/**
 * What the remaster runs with on a system (`platform`, `arch` and `release` as Node's `os` gives
 * them; `translated` where a Mac runs this Node through Rosetta): stable-diffusion.cpp's build,
 * the Python uv makes and the devices offered; or why it cannot run there.
 */
export function remasterHost({ platform, arch, release, translated = false }) {
  if (platform === 'linux') {
    if (arch !== 'x64') return { error: "On Linux the remaster needs an x64 PC: stable-diffusion.cpp's Linux build is x64's." };
    return { platform, build: BUILDS.linux, python: '3.12', devices: DEVICES.linux };
  }
  if (platform === 'win32') return { platform, build: BUILDS.win32, python: '3.12', devices: DEVICES.win32 };
  if (platform === 'darwin') {
    if (arch !== 'arm64' && !translated) return { error: "On a Mac the remaster needs Apple silicon: PyTorch, which runs PBRify's models, is no longer built for Intel Macs." };
    /* Darwin 25 is macOS 26. */
    if (Number(release.split('.')[0]) < 25) return { error: "On a Mac the remaster needs macOS 26 or later: stable-diffusion.cpp's Mac build is made for it." };
    /* Apple silicon's own Python even where this Node runs through Rosetta, so PyTorch and stable-diffusion.cpp run natively. */
    return { platform, build: BUILDS.darwin, python: 'cpython-3.12-macos-aarch64-none', devices: DEVICES.darwin };
  }
  return { error: `The remaster runs on Linux, Windows and macOS, not on ${platform}.` };
}

/** The device PBRify's models run on: the one named (`cpu`, `rocm`, `cuda`, `mps`) where the system offers it, else the first whose tool `which` finds. */
export function remasterDevice(host, named, which) {
  const offered = host.devices.map(([device]) => device);
  if (named !== undefined && !offered.includes(named)) {
    throw new Error(`--${named} is not offered on this system, which offers ${offered.map((device) => `--${device}`).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`);
  }
  return named ?? host.devices.find(([, tool]) => tool === undefined || which(tool) !== undefined)[0];
}

/** PyTorch for a device on a system: the index it comes from, its version and the folder of the Python it is installed in. */
export function torchFor(platform, device) {
  /* A Mac's PyTorch is one build, with Metal's (MPS) in it. */
  if (platform === 'darwin') return { index: 'cpu', version: TORCH, folder: 'py' };
  if (device === 'rocm') return { index: 'rocm7.2', version: `${TORCH}+rocm7.2`, folder: 'py-rocm' };
  if (device === 'cuda') return { index: 'cu130', version: `${TORCH}+cu130`, folder: 'py-cuda' };
  return { index: 'cpu', version: `${TORCH}+cpu`, folder: 'py' };
}

/** The program of a Python uv made in `folder`. */
export function pythonIn(folder, platform) {
  return platform === 'win32' ? path.join(folder, 'Scripts', 'python.exe') : path.join(folder, 'bin', 'python');
}

/** A program's path where it is on the path (on Windows, its `.exe`), else undefined. */
export function which(command) {
  const extensions = process.platform === 'win32' ? ['.exe'] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* not here */
      }
    }
  }
  return undefined;
}

/** The environment without the libraries' path a shell may set, which can lead the GPU's tools to other builds of their libraries. */
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.LD_LIBRARY_PATH;
  return env;
}

const sizeOf = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

async function sha256Of(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** `url` into `file`, unless it is there already with its SHA-256; hashed as it comes, put in place once it matches. Whether it was fetched. */
async function get(url, file, sha256, name) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && (await sha256Of(file)) === sha256) return false;
  const part = `${file}.part`;
  for (let attempt = 1; ; attempt += 1) {
    const hash = createHash('sha256');
    try {
      const response = await fetch(url);
      if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length'));
      console.log(`fetching ${name}${length > 0 ? ` (${sizeOf(length)})` : ''}`);
      const hashing = new Transform({
        transform(chunk, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), hashing, createWriteStream(part));
    } catch (error) {
      rmSync(part, { force: true });
      if (attempt >= 3) throw new Error(`${name} could not be fetched: ${error.message}`);
      console.log(`${name}: ${error.message}; trying again`);
      continue;
    }
    if (hash.digest('hex') !== sha256) {
      rmSync(part, { force: true });
      throw new Error(`${name}: SHA-256 does not match`);
    }
    renameSync(part, file);
    console.log(`fetched ${name}`);
    return true;
  }
}

/** What Windows lacks where stable-diffusion.cpp's build or PyTorch does not load: Microsoft's C++ libraries, or a version of them older than theirs. */
const REDISTRIBUTABLE =
  "stable-diffusion.cpp and PyTorch need the latest Microsoft Visual C++ Redistributable (x64): install or update it (winget install Microsoft.VCRedist.2015+.x64), then run this again.";

const lastLines = (done) => `${done.stdout}${done.stderr}`.trim().split(/\r?\n/).slice(-12).join('\n');

/** The devices stable-diffusion.cpp finds, `[name, description]`, or why it does not start. */
function devicesOf(cli, platform) {
  const done = spawnSync(cli, ['--list-devices'], { cwd: path.dirname(cli), encoding: 'utf8', env: cleanEnv() });
  if (done.error !== undefined) throw new Error(`stable-diffusion.cpp did not start: ${done.error.message}`);
  if (done.status !== 0) {
    const code = done.status === null ? 0 : done.status >>> 0;
    /* A library it needs not found, or found without what it needs from it. */
    if (platform === 'win32' && (code === 0xc0000135 || code === 0xc0000139)) throw new Error(REDISTRIBUTABLE);
    const said = lastLines(done);
    throw new Error(`stable-diffusion.cpp did not start (${done.status === null ? `signal ${done.signal}` : `exit ${done.status}`})${said === '' ? '' : `:\n${said}`}`);
  }
  return done.stdout
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length === 2)
    .map(([name, description]) => [name.trim(), description.trim()]);
}

/**
 * Every tool the remaster needs, into `cache` (`.cache/remaster/`), for `host` and PBRify's
 * `device`, with `uv` the path of uv's program. Returns the Python to run its scripts with.
 */
export async function fetchTools(cache, host, device, uv) {
  const { build } = host;
  const sd = path.join(cache, 'bin', 'sd');
  await get(RELEASE + build.zip, path.join(sd, build.saved), build.sha256, `bin/sd/${build.saved}`);
  extractZip(path.join(sd, build.saved), sd);
  const gpus = devicesOf(path.join(sd, build.cli), host.platform).filter(([name]) => name.startsWith(build.gpu));
  if (gpus.length > 0) console.log(`remaster: Z-Image through ${build.api} on ${gpus[0][1]}`);
  else console.log(`remaster: no GPU found through ${build.api}, so Z-Image runs on the CPU, far more slowly${host.platform === 'darwin' ? '' : ` (a GPU's ${build.api} driver makes it many times faster)`}`);

  for (const [url, file, sha256] of WEIGHTS) await get(url, path.join(cache, file), sha256, file);

  const torch = torchFor(host.platform, device);
  const venv = path.join(cache, torch.folder);
  const uvRun = (args, env) => {
    const done = spawnSync(uv, args, { stdio: 'inherit', env });
    if (done.error !== undefined) throw new Error(`uv did not start: ${done.error.message}`);
    if (done.status !== 0) throw new Error(`uv ${args[0]} ${args[1]} failed (exit ${done.status})`);
  };
  if (!existsSync(venv)) uvRun(['venv', '-q', '--python', host.python, venv], process.env);
  uvRun(
    ['pip', 'install', '-q', '--index-url', `https://download.pytorch.org/whl/${torch.index}`, '--extra-index-url', 'https://pypi.org/simple', '--index-strategy', 'unsafe-best-match', `torch==${torch.version}`, 'torchvision', 'spandrel', 'pillow', 'numpy'],
    { ...process.env, VIRTUAL_ENV: venv },
  );
  /* PyTorch loaded once, so a library it lacks is said now rather than at the first picture. */
  const python = pythonIn(venv, host.platform);
  const loaded = spawnSync(python, ['-I', '-c', 'import torch, spandrel'], { encoding: 'utf8', env: cleanEnv() });
  if (loaded.error !== undefined) throw new Error(`The remaster's Python did not start: ${loaded.error.message}`);
  if (loaded.status !== 0) {
    const said = lastLines(loaded);
    if (host.platform === 'win32' && /WinError 126|DLL load failed/.test(said)) throw new Error(REDISTRIBUTABLE);
    throw new Error(`PyTorch did not load:\n${said}`);
  }
  return python;
}
