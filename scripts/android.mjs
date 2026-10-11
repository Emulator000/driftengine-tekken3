/**
 * `npm run android`: the game as an Android app for the user's own phone, from the disc read with
 * `npm run disc`. The page is built into `dist/` with the disc's data, and DriftEngine's packager
 * (`@driftengine/package`, at the engine's version, as `drift.package.json` describes the app)
 * wraps it in an APK: one WebView serving the page from the APK's own files, signed with a key the
 * packager makes once on this machine and keeps in its cache. The packager and the Android
 * toolchain it uses (a JDK, the Android SDK and Gradle) are fetched the first time, into the
 * user's cache. Only the APK is kept, in `out/android/`.
 *
 * The APK carries the disc's converted data: it is for the user's own devices, never to share.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'android');

function run(command, args, options = {}) {
  const done = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (done.error) throw done.error;
  if (done.status !== 0) process.exit(done.status ?? 1);
}

run(process.execPath, ['scripts/extract.mjs', '--if-missing']);
run(process.execPath, ['scripts/import.mjs', '--if-missing']);
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

const engine = JSON.parse(readFileSync(path.join(root, 'node_modules', '@driftengine', 'core', 'package.json'), 'utf8')).version;
/* The packager's desktop targets need Electron, which an Android build does not. */
const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' };
for (const step of ['bootstrap', 'build']) {
  run('npx', ['--yes', `@driftengine/package@${engine}`, step, '--target=android'], { env, shell: process.platform === 'win32' });
}

/* The Gradle project the packager staged holds the data twice more. */
rmSync(path.join(out, 'project'), { recursive: true, force: true });
const apk = readdirSync(out).filter((name) => name.endsWith('.apk'));
console.log(`\nThe APK is in ${path.relative(root, out)}: ${apk.join(', ')}`);
console.log('Install it on your own phone (developer options on): adb install -r <apk>, or copy it over and open it.');
console.log('It carries your disc\'s data: keep it to your own devices.');
