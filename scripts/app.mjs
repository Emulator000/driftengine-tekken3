/**
 * `npm run desktop`, `npm run android` and `npm run ios` (`node scripts/app.mjs [target]`): the
 * game as an app for the user's own computer or phone, from the disc read with `npm run disc`. The page is built
 * into `dist/` with the disc's data, and DriftEngine's packager (`@driftengine/package`, at the
 * engine's version, as `drift.package.json` describes the app) wraps it:
 *
 *   (none)               this computer's app, the game in its own window (Electron): on Windows an
 *                        installer and a zip, on macOS a .dmg and a zip for its chip, on Linux an
 *                        AppImage and a tar.gz
 *   mac-arm64, mac-x64   a Mac's app built on Linux, signed ad hoc, as a zip (a Windows app is
 *                        built on Windows)
 *   android              an APK: one WebView serving the page from the APK's own files, held in
 *                        landscape, signed with a key the packager makes once on this machine
 *   ios                  on a Mac with Xcode, an iPhone's: its Xcode project (to sign and run on
 *                        the user's own iPhone from Xcode) and an unsigned .ipa
 *
 * The packager is installed into `.cache/packager/` and run with this Node; what it builds with
 * (Electron; a JDK, the Android SDK and Gradle; XcodeGen) is fetched the first time, into the
 * user's cache. Only the finished files are kept, in `out/<target>/`; `--out=<dir>` (for a project on a
 * network drive, which the packager refuses to stage on) puts them in `<dir>/<target>/`.
 *
 * On Windows the build needs to make symbolic links (electron-builder unpacks a signing tool that
 * holds some), which an account may do with Developer Mode on: where a test link cannot be made,
 * the build says so before it starts, and goes on.
 *
 * An app carries the disc's converted data: it is for the user's own devices, never to share.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagerHome = path.join(root, '.cache', 'packager');
const packager = path.join(packagerHome, 'node_modules', '@driftengine', 'package');
const TARGETS = ['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64', 'android', 'ios'];
/** The systems each target is built on, where it is not built on every one. */
const BUILT_ON = { 'win-x64': ['win32'], 'mac-arm64': ['darwin', 'linux'], 'mac-x64': ['darwin', 'linux'], 'linux-x64': ['linux'], ios: ['darwin'] };
/** What a build leaves in `out/<target>/` that is the app: its files, and an iPhone's Xcode project. */
const FINISHED = /\.(apk|AppImage|tar\.gz|exe|dmg|zip|ipa)$/;
const KEPT_FOLDERS = { ios: ['project'] };

/** Stop, saying why in one line. */
function refuse(message) {
  console.error(message);
  process.exit(1);
}

/** This computer's target. */
function desktop() {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  return refuse(`no app is built for ${process.platform} on ${process.arch}: Windows, macOS, and Linux on x64 are`);
}

const flags = process.argv.slice(2).filter((arg) => arg.startsWith('--'));
const target = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? desktop();
if (!TARGETS.includes(target)) refuse(`a target is one of ${TARGETS.join(', ')}; ${target} is not`);
if (BUILT_ON[target] !== undefined && !BUILT_ON[target].includes(process.platform)) {
  const where = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  refuse(`${target} is built on ${BUILT_ON[target].map((p) => where[p]).join(' or ')}, and this is ${where[process.platform] ?? process.platform}`);
}
const outRoot = flags.find((flag) => flag.startsWith('--out='))?.slice('--out='.length);
const out = path.join(outRoot === undefined ? path.join(root, 'out') : path.resolve(outRoot), target);

function run(command, args, options = {}) {
  const done = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (done.error) throw done.error;
  if (done.status !== 0) process.exit(done.status ?? 1);
}

/** Whether this account can make a symbolic link, as 7-Zip will when electron-builder unpacks its signing tool. */
function canLink() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tekken3-link-'));
  try {
    writeFileSync(path.join(dir, 'file'), '');
    symlinkSync(path.join(dir, 'file'), path.join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (target === 'win-x64' && !canLink()) {
  const cache = path.join(process.env.LOCALAPPDATA ?? '%LOCALAPPDATA%', 'electron-builder', 'Cache', 'winCodeSign');
  console.warn(
    [
      'This account cannot make symbolic links, and the build needs to: electron-builder unpacks a signing tool',
      'that holds two, and without them it fails at its very end ("A required privilege is not held by the client").',
      'Turn Developer Mode on (Settings > System > For developers, or: start ms-settings:developers), or build from',
      `an administrator's terminal. After a failed build, remove the half-unpacked tool first: ${cache}`,
      'Building anyway.\n',
    ].join('\n'),
  );
}

const version = (dir) => (existsSync(path.join(dir, 'package.json')) ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version : null);

run(process.execPath, ['scripts/extract.mjs', '--if-missing']);
run(process.execPath, ['scripts/import.mjs', '--if-missing']);
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

const engine = version(path.join(root, 'node_modules', '@driftengine', 'core'));
if (version(packager) !== engine) {
  const install = ['install', '--prefix', packagerHome, '--no-audit', '--no-fund', `@driftengine/package@${engine}`];
  /* Electron's runtime is fetched by the packager's bootstrap where a target needs it, not here. */
  const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' };
  /* npm's own script under this Node where npm runs this script; npm itself elsewhere. */
  if (process.env.npm_execpath?.endsWith('.js')) run(process.execPath, [process.env.npm_execpath, ...install], { env });
  else run('npm', install, { env, shell: process.platform === 'win32' });
}

const bin = path.join(packager, 'bin', 'drift-package.mjs');
/* A terminal that is itself an Electron app sets this for what it starts, and it makes Electron plain Node. */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
run(process.execPath, [bin, 'bootstrap', `--target=${target}`], { env });
run(process.execPath, [bin, 'build', `--target=${target}`, ...flags], { env });

/* What the packager staged, and the unpacked app beside the finished files, hold the data again. */
for (const name of readdirSync(out)) {
  const at = path.join(out, name);
  const kept = statSync(at).isDirectory() ? (KEPT_FOLDERS[target] ?? []).includes(name) : FINISHED.test(name);
  if (!kept) rmSync(at, { recursive: true, force: true });
}
console.log(`\nThe app is in ${path.relative(root, out) || out}: ${readdirSync(out).join(', ')}`);
if (target === 'android') console.log('Install it on your own phone (developer options on): adb install -r <apk>, or copy it over and open it.');
if (target === 'ios') console.log('Open project/ in Xcode, choose your team under Signing, and run it on your own iPhone.');
console.log("It carries your disc's data: keep it to your own devices.");
