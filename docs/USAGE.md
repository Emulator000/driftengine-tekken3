# Usage

## Commands

| Command | What it does |
| --- | --- |
| `npm run disc -- "<image>"` | Reads your disc image (a `.cue` with its `.bin` files, a single `.bin`, or a `.7z` holding them) into `.cache/` |
| `npm run extract` | Turns the disc's files into what the page loads, under `public/data/`; converts the movies when FFmpeg is installed |
| `npm run import` | Writes the game's typed assets, under `public/assets/` |
| `npm run t4 -- "<image>"` | Reads your Tekken 4 disc image (`.iso`, or a `.7z` holding one) for Kazuya; then run `npm run extract` again |
| `npm run dev` | Serves the game on `localhost:5190` (or the next free port), running `extract` and `import` first when their output is missing |
| `npm run dev:lan` | Serves the game to your own devices on your home network, over HTTPS ([In a phone's browser](#in-a-phones-browser)) |
| `npm run desktop` | Builds the game as an app for this computer (Windows, macOS or Linux), with your disc's data in it, into `out/<target>/`; `-- mac-arm64` or `-- mac-x64` builds a Mac's on Linux ([As an app](#as-an-app)) |
| `npm run android` | Builds the game as an Android app for your own phone, with your disc's data in it, into `out/android/` ([As an app](#as-an-app)) |
| `npm run ios` | On a Mac with Xcode, builds the game as an iPhone app, with your disc's data in it, into `out/ios/` ([As an app](#as-an-app)) |
| `npm run build` | Runs the tests, then builds the page into `dist/`. The build copies the disc's data from `public/` into `dist/`: it is for your own machine, never to host or share |
| `npm test` | The tests (those that need the disc's data skip without it), then the typecheck |

Every command runs alike on Windows, macOS and Linux, but for the app `npm run desktop` builds,
which is the system's own.

### Environment

| Variable | Effect |
| --- | --- |
| `SEVEN_ZIP` | The 7-Zip program to run, when it is not on the path or in its usual folder |
| `DRIFT_ENGINE_LOCAL=0` | Uses the DriftEngine packages from npm even when an engine checkout sits at `../drftrun/driftengine` |
| `DRIFT_TOOLCHAIN_HOME` | Where `npm run desktop` and `npm run android` keep what they build with (Electron's runtime, the Android toolchain) and the Android app's signing key (`~/.cache/driftengine/toolchain` by default) |
| `DRIFT_ANDROID_KEYSTORE`, `DRIFT_ANDROID_KEYSTORE_PASSWORD`, `DRIFT_ANDROID_KEY_ALIAS` | A signing key of your own for the Android app, in place of the one made for you |
| `CSC_LINK`, `CSC_KEY_PASSWORD` (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` on Windows) | A code-signing certificate of your own for the computer's app (electron-builder's names) |
| `APPLE_TEAM_ID` | Your Apple developer team, signing the iPhone app as it is built (without it, Xcode signs it for your own iPhone) |

## The page's options

Add them to the address, for example `http://localhost:5190/?quick&p1=9&p2=13&stage=3`.

| Option | Effect |
| --- | --- |
| `quick` | A versus match at once, without the menus. Any of `p1`, `p2`, `stage` or `cpu` alone means a quick match too |
| `p1`, `p2` | The quick match's fighters, by roster id (below) |
| `stage` | The quick match's stage, from 0 |
| `cpu` | Which sides the computer plays: `2` (the default), `1`, `12` to watch it play itself, `0` for two players |
| `arcade=ROSTER`, `arcade=ROSTER,COSTUME` or `arcade=ROSTER,COSTUME,STAGE` | Starts Arcade at once with that character on the first pad, at that stage (1 to 10; by default the tenth, against Ogre, who becomes True Ogre once a round is won against him) |
| `versus` | Starts Versus at once, both pads in, on its character select |
| `ball` | Starts Tekken Ball at once, the first pad in, on its character select (where the first to choose a character chooses the ball) |
| `force`, `force=ROSTER`, `force=ROSTER,COSTUME` or `force=ROSTER,COSTUME,STAGE` | Starts Tekken Force at once, the first pad in: on its character select, or with that character chosen at that stage (1 to 4, 5 the final stage; by default the first) |
| `ending=ROSTER` or `ending=ROSTER,COSTUME` | Plays that character's ending at once |
| `unlock` | Earns everything the game unlocks, as its last unlock does: every character (the character select then shows its two rows), the costumes, Tekken Ball and the Theater |
| `unlock=ball` or `unlock=theater` | Earns Tekken Ball alone, or the Theater alone, as the game's own unlock does (the mode menu lists it, new) |
| `record=time,ROSTER` or `record=survival,ROSTER,WINS` | Goes to the records with a new best time for that character (ten stages of 30 seconds, through Time Attack's results) or a survival record of that many wins (more than the tenth best has, through Survival's results), its name to enter, on the first pad |
| `record=force,ROSTER` or `record=force,ROSTER,FLAGS` | Goes to Tekken Force's results for that character on the first side, a run cleared with a new best score, then the records; `FLAGS` 1 a copper key (the default), 8 Dr. B saved, 0x10 the bosses beaten shown |
| `textures=psx` | Draws the fighters' and stages' textures as the console did, each texel sharp, instead of enlarged and smoothed |
| `models=psx`, `models=rounded` | Draws the fighters with the console's meshes, or the rounded ones (by default the rounded ones, but at `quality=verylow`) |
| `quality=high` | The whole picture: ambient occlusion and bloom over the multisampled HDR scene; the default but on a phone |
| `quality=low` | Leaves out the ambient occlusion and the bloom; a phone's default |
| `quality=verylow` | The picture for an entry-level phone: the scene drawn straight to the screen with no pass after it, one pixel to the CSS pixel and no more pixels than a 640 by 480 picture, thirty pictures a second (the game still runs sixty fields), and the fighters with the console's meshes. It is the default on a phone whose GPU the browser names as an entry-level part (a Mali-G31, G51, G52 or G57, an Adreno 5xx or 600s to 610s, or a PowerVR), and on any device whose fight ran too slow even at its least density on a start before ([A slow device](#a-slow-device)) |
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
| 8 | Eddy | 20 | True Ogre |
| 9 | Jin | 21 | Tekken Force |
| 10 | Julia | 22 | Kazuya (with Tekken 4's files) |

Mokujin (15) plays the moves of a character drawn each round, as in the game.

## The progress

The game keeps what it keeps on a memory card on the console: the characters, costumes and modes
earned, the endings seen, each character's plays, the best records and the options (the key
configuration, the music, the display's place). Here it keeps them on the device you play on: in
the browser's storage for the page's address, or in the app's own. The Options' SAVE DATA page
(the console's memory card page) saves them (SAVE), brings back what was last saved (LOAD), and
turns the auto save on or off. With AUTO SAVE on, the game saves where the console saves on its
own (on the way back to the title, and before the records) whenever the records changed; options
changed in the Options are kept by a SAVE, or by the next of those. A device with nothing saved yet
starts with AUTO SAVE and both pads' VIBRATION on. A page started with `arcade`, `versus`, `ball`,
`force`, `ending`, `record` or `unlock` reads the progress but never saves it, so those shortcuts
leave it as it was. Clearing the site's data in the browser (or the app's) starts the game afresh.

## Controllers

Each player plays on the controller it last pressed anything on: the keyboard, the touch pad, or
a gamepad. The buttons the game shows (the Options' prompts, the pad in the key configuration)
are that controller's: a PlayStation pad's symbols, an Xbox pad's A B X Y and LB RB LT RT (A is
the cross, at the bottom), a Nintendo pad's B A Y X and L R ZL ZR, the keys a keyboard player
presses, the touch pad's 1 to 4. A keyboard player reads START as ENTER where the game names it.

A gamepad with motors vibrates as the console's DualShock does, the small motor and the large one
playing the game's own patterns while VIBRATION is on in the Options' key configuration (on to
start, where the console starts it off; YES or NO there for each pad). The browser has to drive
gamepad motors: Chromium-based browsers and the desktop app do.

## As an app

`npm run desktop`, `npm run android` and `npm run ios` make the page's data when it is missing (as
`npm run dev` does), build the page into `dist/`, and have DriftEngine's packager (`@driftengine/package`, at the
engine's version, as `drift.package.json` describes the apps) wrap it in an app. The first build
installs the packager into `.cache/packager/` and fetches what it builds with into
`~/.cache/driftengine/` (`DRIFT_TOOLCHAIN_HOME` moves it); later builds reuse them. Only the
finished files are kept, in `out/<target>/` (`--out=<folder>` puts them in `<folder>/<target>/`).
A build needs some 4 GB of free disk space while it runs. Every app carries your disc's data: it is
for your own devices, never to share or upload.

### On this computer

`npm run desktop` builds the app for the system it runs on: Electron's window serving the game from
the app's own files, 1280 by 720 to start and resizable, drawn with WebGPU where the system offers
it.

| On | It writes |
| --- | --- |
| Windows | `out/win-x64/`: an installer (`Tekken 3 Setup <version>.exe`) and a zip of the app |
| macOS | `out/mac-arm64/` (Apple silicon) or `out/mac-x64/` (Intel): a `.dmg` and a zip |
| Linux (x64) | `out/linux-x64/`: `Tekken 3-<version>.AppImage` and `tekken3-<version>.tar.gz` |

Each is some 900 MB. `npm run desktop -- mac-arm64` (or `mac-x64`) builds a Mac's app on Linux, as a
zip signed ad hoc; a Windows app is built on Windows, and a Linux app on Linux. The first build
fetches Electron's runtime (and, for a Mac's app built on Linux, `rcodesign`, which signs it).

Alt+Enter takes the game to full screen and back. The app's window takes a browser's own keys away
(reloading, printing, finding, zooming, the inspector).

The app carries no certificate of yours unless `CSC_LINK` names one: Windows' SmartScreen may ask
before its first run, and macOS runs the app signed ad hoc on the Mac that built it, while one
copied from elsewhere may need its quarantine flag cleared first
(`xattr -dr com.apple.quarantine "Tekken 3.app"`).

On Windows the build makes symbolic links (electron-builder unpacks a signing tool that holds some),
which an account may do with Developer Mode on (Settings, System, For developers). Without it the
build fails at its very end, saying "A required privilege is not held by the client"; the build
warns before it starts. After such a failure, remove the half-unpacked tool
(`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`) before building again. A project on a
network drive builds with `--out=` naming a folder on a local disk:
`npm run desktop -- --out=C:\tekken3-out`.

### On an Android phone

`npm run android` builds an APK: one activity holding the phone's WebView, serving the game from
the APK's own files, held in landscape either way up. It asks for no permission, not even the
network. It writes `out/android/Tekken-3-<version>.apk`, some 750 MB; install it with
`adb install -r out/android/Tekken-3-<version>.apk`, or copy it to the phone and open it there.

The first build fetches the Android toolchain (a JDK, the Android SDK's command-line tools, platform
and build tools, and Gradle), accepting the Android SDK's licence for you.

The APK is signed with a key the packager makes on the first build and keeps beside the toolchain
(`keystores/io.github.emulator000.tekken3.jks`). A phone installs a later build over an earlier one
only when both are signed with the same key: keep a copy of it, or a build from another machine (or
after the cache is cleared) has to be installed after removing the app. `DRIFT_ANDROID_KEYSTORE`
and its password and alias sign with a key of your own instead.

Android's back gesture is offered to the game first, which leaves it alone: a second back within
two seconds closes the app.

### On an iPhone

`npm run ios`, on a Mac with Xcode, builds an iPhone app: one view holding a `WKWebView`, serving
the game from the app's own files. It writes `out/ios/`: the Xcode project (in `project/`) and an
unsigned `Tekken-3-<version>.ipa`. To play it on your own iPhone, open the project in Xcode, choose
your Apple ID's team under Signing & Capabilities, and run it on the iPhone: Apple signs an app for
your own device that way, for seven days at a time. `APPLE_TEAM_ID` signs the build with your
team as it is built instead. The first build fetches XcodeGen, which writes the project; Xcode
comes from the App Store.

It has not been built or played yet: DriftEngine's iPhone host is written to Apple's documentation
and has not run on a Mac either.

## In a phone's browser

The page over your home network serves your disc's data: it is for your own devices.

### Over your home network

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

A phone's page is `quality=low`, or `quality=verylow` on an entry-level phone, and its picture's
density is held to its frames (`budget`).

### A slow device

The picture's density steps down while a fight's frames run slow (`budget`), to half its pixels
each way. Where most of a fight's frames still run over budget at that density (300 frames
judged together), the browser keeps it, and every start after draws `quality=verylow`; the page
logs it (`.cache/client.log` for a phone on `npm run dev:lan`). It is kept until the site's data
is cleared in the browser, or the app's storage in an Android app's settings; `?quality=` in the
address decides for that start whatever was kept.
