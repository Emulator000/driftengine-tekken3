# Usage

## Commands

| Command | What it does |
| --- | --- |
| `npm run disc -- "<image>"` | Reads your disc image (a `.cue` with its `.bin` files, a single `.bin`, or a `.7z` holding them) into `.cache/` |
| `npm run extract` | Turns the disc's files into what the page loads, under `public/data/`; converts the movies when FFmpeg is installed |
| `npm run import` | Writes the game's typed assets, under `public/assets/` |
| `npm run t4 -- "<image>"` | Reads your Tekken 4 disc image (`.iso`, or a `.7z` holding one) for Kazuya; then run `npm run extract` again |
| `npm run dev` | Serves the game on `localhost:5190` (or the next free port), running `extract` and `import` first when their output is missing |
| `npm run dev:lan` | Serves the game to your own devices on your home network, over HTTPS ([On your phone](#on-your-phone)) |
| `npm run android` | Builds an Android app of the game for your own phone, with your disc's data in it, into `out/android/` ([On your phone](#on-your-phone)) |
| `npm run build` | Runs the tests, then builds the page into `dist/`. The build copies the disc's data from `public/` into `dist/`: it is for your own machine, never to host or share |
| `npm test` | The tests (those that need the disc's data skip without it), then the typecheck |

Every command runs alike on Windows, macOS and Linux.

### Environment

| Variable | Effect |
| --- | --- |
| `SEVEN_ZIP` | The 7-Zip program to run, when it is not on the path or in its usual folder |
| `DRIFT_ENGINE_LOCAL=0` | Uses the DriftEngine packages from npm even when an engine checkout sits at `../drftrun/driftengine` |
| `DRIFT_TOOLCHAIN_HOME` | Where `npm run android` keeps the Android toolchain and the app's signing key (`~/.cache/driftengine/toolchain` by default) |
| `DRIFT_ANDROID_KEYSTORE`, `DRIFT_ANDROID_KEYSTORE_PASSWORD`, `DRIFT_ANDROID_KEY_ALIAS` | A signing key of your own for the Android app, in place of the one made for you |

## The page's options

Add them to the address, for example `http://localhost:5190/?quick&p1=9&p2=13&stage=3`.

| Option | Effect |
| --- | --- |
| `quick` | A versus match at once, without the menus. Any of `p1`, `p2`, `stage` or `cpu` alone means a quick match too |
| `p1`, `p2` | The quick match's fighters, by roster id (below) |
| `stage` | The quick match's stage, from 0 |
| `cpu` | Which sides the computer plays: `2` (the default), `1`, `12` to watch it play itself, `0` for two players |
| `ending=ROSTER` or `ending=ROSTER,COSTUME` | Plays that character's ending at once |
| `record=time,ROSTER` or `record=survival,ROSTER,WINS` | Goes to the records with a new best time for that character (ten stages of 30 seconds) or a survival record of that many wins (more than the tenth best has), its name to enter, on the first pad |
| `textures=psx` | Draws the fighters' and stages' textures as the console did, each texel sharp, instead of enlarged and smoothed |
| `models=psx` | Draws the fighters with the console's meshes instead of the rounded ones |
| `quality=low` | Leaves out the ambient occlusion and the bloom; a phone's default (`quality=high` keeps them there) |
| `budget=N` | The frame time, in milliseconds, the picture's density is held to (20 by default): while most of a fight's frames take longer, the picture steps down toward half its pixels each way, and back up as the frames allow; `0` holds it still |
| `touch=1`, `touch=0` | The touch pad over the picture anywhere, or nowhere (by default on a touch screen or a phone) |
| `stop=N` | Holds the game after `N` fields (sixtieths of a second), for comparing pictures |
| `viewer` | Opens the viewer for every fighter and move instead of the game (`fighter`, `move` and `paused=1` set where it starts) |

### Roster ids

| Id | Fighter | Id | Fighter |
| --- | --- | --- | --- |
| 0 | Paul | 11 | Kuma |
| 1 | Law | 12 | Bryan |
| 2 | Lei | 13 | Heihachi |
| 3 | King | 14 | Ogre |
| 4 | Yoshimitsu | 16 | Gun Jack |
| 5 | Nina | 17 | Gon |
| 6 | Hwoarang | 18 | Anna |
| 7 | Xiaoyu | 19 | Dr. B |
| 8 | Eddy | 21 | Tekken Force |
| 9 | Jin | 22 | Kazuya (with Tekken 4's files) |
| 10 | Julia | | |

Mokujin (15) and True Ogre (20) are not in a fight yet.

## On your phone

Both ways below are for your own devices: the home network's page serves your disc's data, and the
Android app carries it.

### The Android app

`npm run android` makes the page's data when it is missing (as `npm run dev` does), builds the page
into `dist/`, and has DriftEngine's packager (`@driftengine/package`, at the engine's version, as
`drift.package.json` describes the app) wrap it in an APK: one activity holding the phone's WebView,
serving the game from the APK's own files, held in landscape either way up. It asks for no
permission, not even the network. Only
the APK is kept, `out/android/Tekken-3-<version>.apk`, some 750 MB; install it with
`adb install -r out/android/Tekken-3-<version>.apk`, or copy it to the phone and open it there.

The first build installs the packager into `.cache/packager/`, and fetches the Android toolchain it
builds with (a JDK, the Android SDK's command-line tools, platform and build tools, and Gradle) into
`~/.cache/driftengine/` (`DRIFT_TOOLCHAIN_HOME` moves it), accepting the Android SDK's licence for
you; later builds reuse them. A build needs some 4 GB of free disk space while it runs.

The APK is signed with a key the packager makes on the first build and keeps beside the toolchain
(`keystores/io.github.emulator000.tekken3.jks`). A phone installs a later build over an earlier one
only when both are signed with the same key: keep a copy of it, or a build from another machine (or
after the cache is cleared) has to be installed after removing the app. `DRIFT_ANDROID_KEYSTORE`
and its password and alias sign with a key of your own instead.

Android's back gesture is offered to the game first, which leaves it alone: a second back within
two seconds closes the app.

### The browser, over your home network

`npm run dev:lan` serves the game on every address of the machine, over HTTPS, and prints the
addresses to open (`https://<address>:5190`). Its certificate is made on your machine the first time,
into `.cache/lan/`, for the machine's addresses and names, and made again when the machine's
addresses change (the phone then asks to accept it once more). HTTPS is what gives the page WebGPU
and full screen there: a page over plain HTTP from another address is refused both. A home router
keeps the page inside the network unless a port is forwarded to it.

A page opened from another device posts what it logs, its errors and, every two seconds, what its
frames take (the fields and frames a second, the frames that ran two fields, the time between frames
and the main thread's time on the fields and on the drawing), the picture's size and density, and
its memory where the browser tells it, to the machine serving it, which keeps them in
`.cache/client.log`: a tab that stalls or crashes leaves its last moments there.

### On a touch screen

The touch pad drives the first player: a stick where the left thumb lands (eight ways), the four
buttons on the right in a diamond as on the pad (2 above, 1 and 4 either side, 3 below; a thumb
between two holds both), Select and Start between the thumbs. Start pauses the fight, as on the
pad. The first touch takes the page to full screen in landscape where the browser lets it; the
Android app is full screen already.

A phone's page is `quality=low`, and its picture's density is held to its frames (`budget`).
