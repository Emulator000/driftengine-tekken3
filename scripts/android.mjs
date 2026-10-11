/**
 * `npm run android`: the game as an Android app for the user's own phone, from the disc read with
 * `npm run disc`. The page is built into `dist/` with the disc's data, and DriftEngine's packager
 * (`@driftengine/package`, at the engine's version, as `drift.package.json` describes the app)
 * wraps it in an APK: one WebView serving the page from the APK's own files, signed with a key the
 * packager makes once on this machine and keeps in its cache. The packager is installed into
 * `.cache/packager/`; the Android toolchain it uses (a JDK, the Android SDK and Gradle) is fetched
 * the first time, into the user's cache. Only the APK is kept, in `out/android/`.
 *
 * The packager's own Android project is used as it is, but for its activity, held in landscape
 * either way up (`sensorLandscape`): the packager has no setting for it, so a copy of its
 * templates with that one change is what it builds from (`--resources`).
 *
 * The APK carries the disc's converted data: it is for the user's own devices, never to share.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'android');
const packagerHome = path.join(root, '.cache', 'packager');
const packager = path.join(packagerHome, 'node_modules', '@driftengine', 'package');
const resources = path.join(root, '.cache', 'android', 'resources');
const ORIENTATION = 'android:screenOrientation="sensorLandscape"';

function run(command, args, options = {}) {
  const done = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (done.error) throw done.error;
  if (done.status !== 0) process.exit(done.status ?? 1);
}

const version = (dir) => (existsSync(path.join(dir, 'package.json')) ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version : null);
/* The packager's desktop targets need Electron, which an Android build does not. */
const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' };

run(process.execPath, ['scripts/extract.mjs', '--if-missing']);
run(process.execPath, ['scripts/import.mjs', '--if-missing']);
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

const engine = version(path.join(root, 'node_modules', '@driftengine', 'core'));
if (version(packager) !== engine) {
  const install = ['install', '--prefix', packagerHome, '--no-audit', '--no-fund', `@driftengine/package@${engine}`];
  /* npm's own script under this Node where npm runs this script; npm itself elsewhere. */
  if (process.env.npm_execpath?.endsWith('.js')) run(process.execPath, [process.env.npm_execpath, ...install], { env });
  else run('npm', install, { env, shell: process.platform === 'win32' });
}

rmSync(resources, { recursive: true, force: true });
cpSync(path.join(packager, 'assets'), path.join(resources, 'assets'), { recursive: true });
cpSync(path.join(packager, 'android'), path.join(resources, 'android'), { recursive: true, filter: (from) => !/[\\/](build|\.gradle)$/.test(from) });
const manifest = path.join(resources, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const xml = readFileSync(manifest, 'utf8');
const held = xml.replace(/android:screenOrientation="[^"]*"/, ORIENTATION);
if (!held.includes(ORIENTATION)) throw new Error(`the packager's AndroidManifest.xml (${engine}) names no screenOrientation to hold in landscape`);
writeFileSync(manifest, held);

const bin = path.join(packager, 'bin', 'drift-package.mjs');
run(process.execPath, [bin, 'bootstrap', '--target=android'], { env });
run(process.execPath, [bin, 'build', '--target=android', `--resources=${resources}`], { env });

/* The Gradle project the packager staged holds the data twice more. */
rmSync(path.join(out, 'project'), { recursive: true, force: true });
const apk = readdirSync(out).filter((name) => name.endsWith('.apk'));
console.log(`\nThe APK is in ${path.relative(root, out)}: ${apk.join(', ')}`);
console.log('Install it on your own phone (developer options on): adb install -r <apk>, or copy it over and open it.');
console.log("It carries your disc's data: keep it to your own devices.");
