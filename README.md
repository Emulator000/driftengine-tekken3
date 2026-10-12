# Tekken 3 on DriftEngine

Tekken 3, rebuilt as a modern browser game on [DriftEngine](https://driftengine.dev) from the data
of your own disc: the fighters, their moves, the stages, the music, the voices and the movies are
read from the image you make of your Tekken 3 disc, on your machine, and played in the browser at
the display's resolution.

## Project Status and Disclaimer

This is an unofficial, independently developed technical research and interoperability project.

It is not affiliated with, endorsed by, sponsored by, authorized by, or approved by Bandai Namco
Entertainment or Sony Interactive Entertainment.

Tekken, Tekken 3, Tekken 4, their characters, trademarks, game assets, audiovisual content, game
data, software and related intellectual property belong to their respective rights holders.
PlayStation is a trademark of Sony Interactive Entertainment.

This repository does not contain or distribute Tekken 3 or Tekken 4 game files, disc images,
executables, game assets, music, movies or other copyrighted game content.

A disc of the game is required. Game content is read locally from an image of your own disc.

Nothing in this repository grants any rights to Tekken, Tekken 3, Tekken 4, Bandai Namco
Entertainment, Sony Interactive Entertainment, or any third-party intellectual property.

## What This Repository Does Not Include

This repository intentionally does not contain or provide:

- disc images, or links to them
- the game's executable or any of its files
- characters, models, textures or animations
- stages
- audio, music or voices
- movies
- converted, extracted or decoded game content
- builds of the game, apps for a computer or a phone: each is built on your machine, from your own disc
- copy protection or region lock bypasses
- downloads of original game content

## Requirements

- **Your own Tekken 3 disc**, USA release (SLUS-00402), and a way to make an image of it (below).
  Other regions are not read.
- **Node.js 22.12 or newer** (<https://nodejs.org>).
- **A recent browser**: Chrome or Edge on Windows, macOS or Linux, or Safari 26 on macOS, which
  draw it with WebGPU. Where WebGPU is missing the engine falls back to WebGL2.
- **An app, optional**: the game builds into an app of its own for Windows, macOS, Linux, an
  Android phone or an iPhone, from your disc, and plays in any phone's or tablet's browser over your home
  network (below).
- **FFmpeg**, optional: converts the disc's movies to web video. Without it the movies are left
  out and their time passes in black.
- **7-Zip**, optional: only to read an image you keep as a `.7z` archive.

| | Node.js | FFmpeg (optional) | 7-Zip (optional) |
| --- | --- | --- | --- |
| Windows | `winget install OpenJS.NodeJS.LTS` | `winget install Gyan.FFmpeg` | `winget install 7zip.7zip` |
| macOS | `brew install node` | `brew install ffmpeg` | `brew install sevenzip` |
| Linux | your distribution's `nodejs` (22.12+), or nodejs.org | your distribution's `ffmpeg` | your distribution's `7zip` or `p7zip` |

## Getting Started

### 1. Make an image of your disc

The game reads a raw image of the disc: every sector at its full 2352 bytes, with the audio tracks,
as a `.cue` sheet and its `.bin` file (or one `.bin` per track; both are read).

- **Windows**: in ImgBurn, *Create image file from disc*; it writes a `.bin` and a `.cue`.
- **macOS and Linux**: with `cdrdao` (`brew install cdrdao`, or your distribution's package):

  ```sh
  cdrdao read-cd --read-raw --datafile tekken3.bin --driver generic-mmc-raw tekken3.toc
  toc2cue tekken3.toc tekken3.cue
  ```

  (Add `--device` with your drive when `cdrdao` does not find it: `cdrdao scanbus` lists them.)
  `cdrdao` writes the audio tracks' samples in the other byte order; `npm run disc` notices and
  puts them right.

Any other tool that writes a raw BIN/CUE image works the same.

### 2. Install and read the disc

```sh
npm install
npm run disc -- "path/to/tekken3.cue"
```

`npm run disc` checks that the image is Tekken 3 (USA) and keeps what it reads under `.cache/`.

### 3. Play

```sh
npm run dev
```

and open the address it prints (`http://localhost:5190`). The first start converts the disc's data
into `public/data/` and `public/assets/`, which takes a few minutes (the movies the longest, when
FFmpeg is installed); later starts are immediate. Everything stays on your machine: the server
listens on `localhost` only, and none of it is committed.

Sound starts once a key, click or touch lets the browser play audio.

### 4. As an app (optional)

The game builds into an app of its own, with your disc's data in it:

- **For this computer**:

  ```sh
  npm run desktop
  ```

  builds the app for the system you run it on, into `out/<target>/`: on Windows an installer and a
  zip, on macOS a `.dmg` and a zip for your Mac's chip, on Linux an AppImage and a `.tar.gz` (some
  900 MB each). The game opens in a window of its own, drawn with WebGPU where the system offers it.
  A Mac's app can also be built on Linux (`npm run desktop -- mac-arm64`, or `mac-x64` for an
  Intel Mac); a Windows app is built on Windows, with Developer Mode on (the build warns when it is
  off).

- **For an Android phone**:

  ```sh
  npm run android
  ```

  builds an APK, `out/android/Tekken-3-<version>.apk` (some 750 MB). Install it with
  `adb install -r out/android/Tekken-3-<version>.apk`, or copy it to the phone and open it there
  (the phone asks you to allow installing apps from where you opened it).

- **For an iPhone**, on a Mac with Xcode: `npm run ios` writes the app's Xcode project and an
  unsigned `.ipa` into `out/ios/`; open the project in Xcode, choose your Apple ID's team, and run it
  on your iPhone. Not yet built or played.

The first build fetches DriftEngine's packager and what it builds with (Electron for a computer; a
JDK, the Android SDK and Gradle for an Android phone, accepting the Android SDK's licence for you;
XcodeGen for an iPhone) into your user cache. A build needs some 4 GB of free disk space while it
runs.

### 5. In a phone's browser (optional)

```sh
npm run dev:lan
```

serves the game over HTTPS to your devices on your home network and prints the addresses to open
(`https://<this machine's address>:5190`). The phone asks once to accept the certificate, made on
your machine the first time; HTTPS is what gives the page WebGPU there.

On a touch screen the game shows a pad over the picture: a stick where your left thumb lands, the
four buttons on the right in a diamond as on the pad (2 above, 1 and 4 either side, 3 below; a
thumb between two holds both), Select and Start between the thumbs. A phone draws the
picture without the ambient occlusion and the bloom, at fewer pixels while its frames run slow.

Every app carries your disc's converted data, and the home network's page serves it: all of them
are for your own devices. Never share or upload an app built from your disc.

## Playing

The game starts as the console does: the logo, the opening movie, the title (Enter), the mode menu.

| | Move | Left punch | Right punch | Left kick | Right kick | Sidestep | Start |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Player 1 | W A S D | U | I | J | K | Q, E | Enter |
| Player 2 | arrows | numpad 4 | numpad 5 | numpad 1 | numpad 2 | numpad 7, 9 | numpad Enter |

A gamepad drives the player of its index, and on a touch screen the pad over the picture drives
the first. Alt+Enter takes the game to full screen and back. `?quick` in the address skips the menus for a match at
once; [docs/USAGE.md](docs/USAGE.md) lists every option (fighters, stage, the computer's sides,
the endings, the original textures, the viewer) and every command.

### Kazuya (optional)

Kazuya joins the roster from Tekken 4 when you have that disc too (PlayStation 2, USA,
SLUS-20328): make an `.iso` image of it (ImgBurn on Windows, Disk Utility's *New Image* on macOS,
`dd` on Linux), then

```sh
npm run t4 -- "path/to/tekken4.iso"
npm run extract
```

He brings his Tekken 4 model, moves and voice, and meets Jin first in Arcade.

## Where It Stands

The game plays from power-on through a whole Arcade run, its fight the original's on every
field. What is done and what is not yet:

| Part | Status | Notes |
| --- | --- | --- |
| **The game's flow** | | |
| Power-on: the logo, the opening movie, the title | Done | |
| The attract cycle: the in-engine intros, the demo fights, the other movie | Done | |
| The mode menu | Done | Only Arcade starts a game yet |
| The character select | Done | Kazuya in a cell of his own when his files are built |
| The versus screen | Done | |
| Arcade: its ten opponents, the continue, game over | Done | |
| The endings: each character's movie and captions, the credits | Done | |
| The records screens and the name entry | Done | A new record's name comes from Time Attack and Survival, not yet in; `?record` enters one |
| A quick match without the menus (`?quick`) | Done | |
| **The modes** | | |
| Versus (two players) | Not yet | |
| Team Battle | Not yet | |
| Time Attack | Not yet | |
| Survival | Not yet | |
| Practice | Not yet | |
| Tekken Force | Not yet | |
| Tekken Ball | Not yet | |
| The Theater's menu | Not yet | The endings play from Arcade |
| The options | Not yet | |
| **The fight** | | |
| Input, moves, throws, hits, the camera, the rounds, the replay | Done | The original's on every field, checked against it frame by frame |
| The computer opponent | Done | |
| The HUD, the round calls, the pause menu and the command lists | Done | |
| The fighters | Partly | Every fighter but Mokujin and True Ogre |
| Hit sparks, dust, bursts, the charged glow, breath and fire | Done | |
| Hair and accessories swinging | Done | On the original's springs, checked against it frame by frame |
| Hands opening and clenching, eyes blinking | Done | Each hand's shapes from the model, rounded alike; the costume's closed eyes over its face. Gon's face colours not yet |
| **The picture and the sound** | | |
| The fighters rounded into curved surfaces | Done | `?models=psx` draws the console's meshes |
| The textures enlarged and smoothed | Done | `?textures=psx` draws the originals |
| The 2D (HUD, calls, menus) drawn at the display's resolution | Done | |
| The movies | Done | Converted from the disc when FFmpeg is installed |
| The voices, effects, music and the audio track | Done | Played from the game's own banks and songs |
| **Around the game** | | |
| Keyboard and gamepads | Done | |
| Touch controls | Done | A stick where the left thumb lands, the four buttons, Select and Start |
| Phones and tablets, in the browser | Done | Over your home network, `npm run dev:lan` |
| An app for Windows, macOS or Linux built from your disc | Done | `npm run desktop`; the Linux app is the one played so far |
| An Android app built from your disc | Done | `npm run android`, for your own phone |
| An iPhone app built from your disc | Partly | `npm run ios`, on a Mac with Xcode; not yet built or played |
| Windows, macOS, Linux | Done | Developed and tested on Linux |
| Kazuya from Tekken 4 | Done | Optional, from your own Tekken 4 disc |
| Discs of other regions (PAL, Japanese) | Not yet | The USA disc (SLUS-00402) alone is read |

## Repository Layout

| Path | What |
| --- | --- |
| `scripts/` | Reading the disc image and importing its data, the only code that knows the disc's formats; and building the apps (`app.mjs`) |
| `src/sim/` | The game: a typed, deterministic simulation, with no engine, browser or I/O in it |
| `src/assets/` | The imported assets' types and validating loaders |
| `src/present/` | The presentation on DriftEngine: the 3D, the 2D, the effects, the sound |
| `src/app/` | The page, the input and the 60 Hz loop |
| `src/mod/kazuya/` | Kazuya, added through the game's extension points |
| `drift.package.json` | The apps, as DriftEngine's packager builds them (`npm run desktop`, `npm run android`, `npm run ios`) |
| `tests/` | The tests (`npm test`); those that need the disc's data skip without it |
| `docs/USAGE.md` | Commands and the page's options |
| `docs/ENGINE.md` | What the game needs from DriftEngine |

## Contributions

By submitting a contribution, you represent that you have the right to submit the contributed
material and that it does not contain proprietary game code, game assets, confidential
information, unlawfully obtained material, or other third-party content that cannot legally be
redistributed.

Contributors must not submit disc images, executables, files from the discs, anything converted
from them, screenshots or recordings of game content, or decompiled code.

Acceptance of a contribution does not change ownership of third-party intellectual property.

See `CONTRIBUTING.md`.

## Source Code License

The independently authored source code in this repository is source-visible but is not released
under an open-source license.

Copyright © 2026 Drift Technologies. All rights reserved.

No permission is granted to redistribute, modify, sublicense, sell, commercially exploit,
repackage, or incorporate this source code into another product except with prior written
permission from the applicable copyright holder.

This restriction applies only to material whose rights are owned by Drift Technologies and/or the
repository authors.

Nothing in this repository grants any rights to Tekken, Tekken 3, Tekken 4, Bandai Namco
Entertainment, Sony Interactive Entertainment, or other third-party intellectual property.

See `LICENSE` for the complete notice, and `THIRD_PARTY_NOTICES.md` for third-party material.

---

Tekken, Tekken 3 and Tekken 4 are trademarks and/or intellectual property of their respective
rights holders. PlayStation is a trademark of Sony Interactive Entertainment.

This project is unofficial and independently developed. It is not affiliated with, endorsed by,
sponsored by, authorized by, or approved by Bandai Namco Entertainment or Sony Interactive
Entertainment.

No Tekken 3 or Tekken 4 game files are distributed with this repository.
