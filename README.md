# Tekken 3 on DriftEngine

Tekken 3, rebuilt as a modern browser game on [DriftEngine](https://driftengine.dev) from the data
of your own disc: the fighters, their moves, the stages, the music, the voices and the movies are
read from the image you make of your Tekken 3 disc, on your machine, and played in the browser at
the display's resolution. Optionally, a dump of your own Tekken 3 arcade board adds the arcade
release's stages and fighter models.

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

Optional Tekken 3 Arcade support operates on data supplied locally by the user from original
arcade hardware. No Tekken 3 Arcade ROMs, board dumps, extracted files or converted assets are
included or distributed by this repository. Users are responsible for ensuring that their
possession, dumping and use of arcade software is permitted under the laws applicable to them.

Nothing in this repository is legal advice.

Nothing in this repository grants any rights to Tekken, Tekken 3, Tekken 4, Bandai Namco
Entertainment, Sony Interactive Entertainment, or any third-party intellectual property.

## What This Repository Does Not Include

This repository intentionally does not contain or provide:

- disc images, or links to them
- Tekken 3 Arcade ROM images or Namco System 12 board dumps, or links to them or to arcade ROM sets
- files extracted from arcade ROMs, or arcade assets converted from them
- the game's executable or any of its files
- characters, models, textures or animations
- stages
- audio, music or voices
- movies
- converted, extracted or decoded game content
- builds of the game, apps for a computer or a phone: each is built on your machine, from your own disc
- copy protection, region lock or arcade security hardware bypasses
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
your machine the first time; HTTPS is what gives the page WebGPU there. The same page is served
over plain HTTP at the next port too (`http://<this machine's address>:5191`), drawn with WebGL2
there and without full screen (nor, in some browsers, the gamepads).

On a touch screen the game shows a pad over the picture: a stick where your left thumb lands, the
four buttons on the right in a diamond as on the pad (2 above, 1 and 4 either side, 3 below; a
thumb between two holds both), Select and Start between the thumbs. A phone draws the
picture without the ambient occlusion and the bloom, at fewer pixels while its frames run slow; an
entry-level phone (its GPU a small Mali, an older Adreno or a PowerVR) draws the very low
picture: fewer pixels, thirty pictures a second while the game runs at sixty, and the console's
meshes for the fighters. Each start picks its picture afresh: nothing measured on a start before
keeps a device on a lower one.

Every app carries your disc's converted data, and the home network's page serves it: all of them
are for your own devices. Never share or upload an app built from your disc.

## Playing

The game starts as the console does: the logo, the opening movie, the title (Enter), the mode menu.
Backspace (Select) during the opening movie plays an attract intro at once, and again during one,
the next of the three, earned or not.
The mode menu shows the game's version at the screen's top right, followed by (NEW VERSION
AVAILABLE!) once the repository has tagged a newer one ([docs/USAGE.md](docs/USAGE.md#the-version)).

| | Move | Left punch | Right punch | Left kick | Right kick | L2, L1 | R1, R2 | Start | Select |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Player 1 | W A S D | U | I | J | K | Q, E | R, T | Enter | Backspace |
| Player 2 | arrows | numpad 4 | numpad 5 | numpad 1 | numpad 2 | numpad 7, 9 | numpad 6, 3 | numpad Enter | numpad . |

A gamepad drives the player of its index, and on a touch screen the pad over the picture drives
the first, hidden while a gamepad is connected. Alt+Enter takes the game to full screen and back;
`F` shows and hides the frame rate; `P` holds a fight and flies a free camera through it ([docs/USAGE.md](docs/USAGE.md#the-free-camera)). `?quick` in the address skips the menus for a match at
once; [docs/USAGE.md](docs/USAGE.md) lists every option (fighters, stage, the computer's sides,
the endings, the original textures, the viewer) and every command.

### Reachable walls

The original's stages follow the fighters, so nobody ever reaches a wall. With REACHABLE WALLS (in
REMAKE OPTION; online matches have them unless the host turns them off) the stage stands still and
its walls can be reached: back a fighter into one and it is pinned there until it gets out (block,
duck, sidestep, a throw that swaps sides); knock it into one hard and it splats against it, open to
a short combo. Tekken Ball, Tekken Force and the attract demo keep the original's stages.
`?quick&walls=on` tries it at once.

### Online

ONLINE MODE, in the mode menu after VS MODE, plays a Versus fight against someone on another
machine, each of you from your own disc: a quick match with the next player waiting, a room you
create (its code to give the other player, or listed in the server's room list), or a room joined
by its code or from the list. You choose your fighter and your side once, then wait in a fight of
your own against a training dummy until an opponent is found, whom you accept or turn down; the
match then starts at once on a stage drawn at random, three rounds to win, and once it is over
you both choose a rematch or the waiting room. Only the pads' presses and the match's setup
go between the two games; each runs the whole match itself, at once from your own pad, the other's
put right as it arrives (rollback), straight between the two machines where they can reach each
other and through the server where not. Both of you need versions that play a match alike (a
release that changes only how the game is drawn or sounds plays the one before it: 0.6.5, 0.6.6 and
0.6.7 play each other; 0.7.0, whose walls change how a match plays, plays 0.7.0 to 0.7.3; 0.7.1
and later play 0.6.5 to 0.6.7 too, without the walls, on a server of 0.7.1 or later), and each the
data of the fighter the other chose: a player with Kazuya is paired with one without him as long
as neither of you plays him. The server counts each player's streak of wins (WINS:3 at the foot of
the screen under your side in a match, as Versus shows a streak, and in the waiting room's corner),
in its memory alone.

`npm run dev` and `npm run dev:lan` run the server beside the page, so two players on your home
network (`npm run dev:lan`) play with nothing else to run. Over the internet, one of you runs the
server where the other can reach it (`npm run relay`, or the `server/` folder on a machine of its
own, [server/README.md](server/README.md)), opening its one TCP port (8790 by default) on the
router and the firewall, and both set its address as SERVER on ONLINE MODE's page; nobody else
opens anything ([how to host it](server/README.md#opening-it-to-the-internet)). A browser opened
on the server's address shows [its page](server/README.md#its-page): whether it is up, how many
play on it, and how to join them. [docs/USAGE.md](docs/USAGE.md#online) says more.

### Kazuya (optional)

Kazuya joins the roster from Tekken 4 when you have that disc too (PlayStation 2, USA,
SLUS-20328): make an `.iso` image of it (ImgBurn on Windows, Disk Utility's *New Image* on macOS,
`dd` on Linux), then

```sh
npm run t4 -- "path/to/tekken4.iso"
npm run extract
```

He brings his Tekken 4 model, moves and voice, and meets Jin first in Arcade.

### Tekken 3 Arcade assets (optional)

The arcade release of Tekken 3 ran on Namco System 12 hardware, and its stages are full 3D
scenes: the buildings, temples and towers that the PlayStation draws as flat pictures are
modelled, with their own backgrounds and their moving pieces (the funfair's carousel, the
helicopter over the helipad, the temples' torches). Its fighters' models have more vertices than
the disc's, their joints blended by weights of their own, and their own accessories. When you own
an original Tekken 3 arcade board and have made a dump of it yourself, the game draws the arcade's
stages and fighters in place of the disc's.

- The arcade version is not needed: the PlayStation disc remains the game's source, and everything
  else (the fighters' moves, the sound, the menus) still comes from it.
- This repository contains no arcade ROMs, board dumps, or anything extracted or converted from
  them, and does not say where to obtain any.
- Everything happens on your machine: the importer reads your dump and converts the stages and
  the fighters locally, into ignored folders (`.cache/arcade/`, `public/data/arcade/`,
  `public/assets/textures/arcade/`, `public/assets/models/arcade/`).
- Never commit, upload or share the converted content, or an app built with it: like an app built
  from your disc, it is for your own devices.

Use this feature only with data dumped from original Tekken 3 arcade hardware that you lawfully
own and are permitted to use under the laws applicable to you.

1. Own an original Tekken 3 board (Namco System 12).
2. Dump its program and data chips yourself, with appropriate hardware and procedures, into one
   folder on your machine.
3. Read the dump and convert its stages and fighters:

   ```sh
   npm run arcade -- "path/to/your-own-tekken3-arcade-dump"
   npm run extract
   ```

   The importer recognises each chip by its SHA-256 checksum, whatever its file is called, and
   stops if one is missing or is not from the revision it supports. The checksums are in
   `scripts/lib/arcade/board.mjs`, for identification and validation only.
4. It joins the chips' data into `.cache/arcade/`; `npm run extract` converts the stages and the
   fighters the arcade has into `public/data/arcade/`.
5. Start or build the game as usual. STAGES and FIGHTERS in REMAKE OPTION (in the Options), or
   `?stages=psx` and `?fighters=psx` in the address, draw the disc's instead.

The importer parses the dump's data as it is stored: it does not run the board's program, and it
reads, bypasses and emulates no security hardware.

### The remaster (optional)

REMASTER in REMAKE OPTION draws the fights as a modern game would: the engine's lighting and
shadows, each stage's own sky and light, wet floors reflecting the fighters, floors and scenery
in 3D relief, grass that sways and is trampled, and the textures enlarged with their normal,
roughness and height maps, with a look of its own (LOOK: light, normal or strong; BRIGHTNESS: low,
normal or high), its floors fading into the dark as the game's do (FLOOR FADE). It is off by
default, and experimental: REMAKE OPTION asks you to run `npm run remaster` first until its assets
have been made on your machine, and the lowest picture quality leaves it off.

- **Made on your machine, from your data.** `npm run remaster` runs open models over what
  `npm run import` made from your disc (and your arcade dump, where you have one): PBRify's
  enlargement and material models, and Z-Image-Turbo through stable-diffusion.cpp for the floors'
  grain, the floors it draws anew and some stages' detail
  ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#the-remasters-tools) lists them and their
  licences). Nothing is downloaded but the tools and their weights, into `.cache/remaster/`.
- **What it needs.** An x64 PC with Linux or Windows, or a Mac with Apple silicon on macOS 26 or
  later (Windows and the Mac untried); uv (<https://docs.astral.sh/uv/>) for its Python; about 25 GB
  of disk; and a GPU to be quick. Z-Image runs through stable-diffusion.cpp's Vulkan build on Linux
  and Windows (a GPU's Vulkan driver, or on Linux Mesa's lavapipe on the CPU) and its Metal build on
  a Mac. PBRify's models run on an AMD GPU through ROCm (Linux), an NVIDIA one through CUDA (Linux
  or Windows, untried) or a Mac's through Metal, found by itself (`--cpu`, `--rocm`, `--cuda` or
  `--mps` names it); on the CPU they take many hours.

  | | uv | Also |
  | --- | --- | --- |
  | Windows | `winget install astral-sh.uv` | the latest Microsoft Visual C++ Redistributable (x64), which stable-diffusion.cpp's build and PyTorch need: `winget install Microsoft.VCRedist.2015+.x64` (it updates one installed before) |
  | macOS | `brew install uv` | |
  | Linux | `curl -LsSf https://astral.sh/uv/install.sh \| sh`, or your distribution's `uv` | |
- **Like everything converted from your disc and your board**, what it makes is in an ignored
  folder (`public/assets/remaster/`) and is for your own devices: never commit, upload or share it.
  An app built with `npm run desktop` after `npm run remaster` carries it (some 3 GB more); one
  built with `npm run android` or `npm run ios` leaves it out.

```sh
npm run remaster
```

A run that stops picks up where it was. Then turn REMASTER on (or open the game with
`?remaster=on`).

## Where It Stands

The game plays from power-on through a whole Arcade run, its fight the original's on every
field. What is done and what is not yet:

| Part | Status | Notes |
| --- | --- | --- |
| **The game's flow** | | |
| Power-on: the logo, the opening movie, the title | Done | |
| The attract cycle: the in-engine intros, the demo fights, the other movie | Done | |
| The mode menu | Done | Every mode starts |
| The character select | Done | Both its layouts: one row, and two once more characters are earned (`?unlock` earns them all); Kazuya in a cell of his own when his files are built |
| The versus select: both players at once, the handicaps, the record of wins and draws | Done | Also Arcade's, with start and both shoulders held as it is chosen; `?versus` starts Versus; Kazuya in a column of his own when his files are built |
| The versus screen | Done | |
| Arcade: its ten opponents, Ogre's change into True Ogre, the continue, game over | Done | `?arcade=ROSTER` starts it at Ogre's stage |
| The endings: each character's movie and captions, the credits | Done | |
| The records screens and the name entry | Done | A new record's name comes from Time Attack and Survival; `?record` enters one |
| The progress kept between plays: characters and costumes earned, the unlocks, the plays, the records, the options | Done | Saved on your device: the Options' SAVE DATA page (the memory card's), and the auto save |
| A quick match without the menus (`?quick`) | Done | |
| **The modes** | | |
| Versus (two players) | Done | |
| Versus online | Done | ONLINE MODE: a quick match, rooms by code or from the list; a waiting room to practise in, the opponent found accepted or turned down, the match on a stage drawn at random, three rounds to win, a rematch asked for, each player's side kept (the fight seen from the other side of the stage, nothing mirrored); rollback, the input delay asked for, the connection shown over the picture, the two games' states compared as they play; straight between the machines (WebRTC) or through the server (`npm run relay`, configurable) |
| Team Battle | Done | Its results too |
| Time Attack | Done | Its results too |
| Survival | Done | Its results too |
| Practice | Done | 1P FREESTYLE with its training dummy, VS CPU, COMBO TRAINING with each character's combos, ATTACK DATA, COUNTER ATTACKS, HIT ANALYSIS, COMBO REPLAY, the command lists |
| Tekken Force | Done | Its four stages' streets and the final stage, the soldiers brought on by each stage's script as the camera moves, the bosses each character meets, +LIFE items, the stage clear's tally, the keys and Dr. B to win, the run's results; `?force` starts it |
| Tekken Ball | Done | The ball chosen on the select (the first to choose a character chooses it), the beach and its court, the ball's touches, charges, strikes, points and burns, its glow in the side's spark, the charge gauges, the knockout's replays, the computer players, the rules page set in type |
| The Theater: its movies and its music player | Done | The movies open as their endings are seen; the music page once all are. The DISC button (for the Tekken and Tekken 2 discs) is left out |
| The Options: game options, key configuration, records, display adjust, save data | Done | The key configuration and the prompts show your controller's buttons |
| **The fight** | | |
| Input, moves, throws, hits, the camera, the rounds, the replay | Done | The original's on every field, checked against it frame by frame |
| The computer opponent | Done | |
| The HUD, the round calls, the pause menu and the command lists | Done | |
| The fighters | Done | Mokujin with a character's moves drawn each round |
| Hit sparks, dust, bursts, the charged glow, breath and fire | Done | |
| Hair and accessories swinging | Done | On the original's springs, checked against it frame by frame |
| Hands opening and clenching, eyes blinking | Done | Each hand's shapes from the model, rounded alike; the costume's closed eyes over its face. Gon's face colours not yet |
| **The picture and the sound** | | |
| The stages' floors, shaded by depth or lit around the fighters | Done | |
| The fighters rounded into curved surfaces | Done | Their sharp edges and small parts kept, their fingers round, a skirt's panel and what lies just under it kept flat; each face drawn from its front, or from both where the console draws both; `?models=psx` draws the console's meshes, as an entry-level phone does |
| The textures enlarged and smoothed | Done | `?textures=psx` draws the originals |
| The 2D (HUD, calls, menus) drawn at the display's resolution | Done | |
| The movies | Done | Converted from the disc when FFmpeg is installed |
| The voices, effects, music and the audio track | Done | Played from the game's own banks and songs |
| **Around the game** | | |
| Keyboard and gamepads | Done | The buttons shown are the controller's you play on: PlayStation, Xbox, Nintendo, keyboard, touch |
| The pads' vibration | Done | The original's patterns on a gamepad's two motors, where the browser drives them (Chromium, the desktop app); on to start, VIBRATION in the key configuration turns it off and on |
| Touch controls | Done | A stick where the left thumb lands, the four buttons, Select and Start |
| Phones and tablets, in the browser | Done | Over your home network, `npm run dev:lan` |
| An app for Windows, macOS or Linux built from your disc | Done | `npm run desktop`; the Linux app is the one played so far |
| An Android app built from your disc | Done | `npm run android`, for your own phone |
| An iPhone app built from your disc | Partly | `npm run ios`, on a Mac with Xcode; not yet built or played |
| Windows, macOS, Linux | Done | Developed and tested on Linux |
| Kazuya from Tekken 4 | Done | Optional, from your own Tekken 4 disc |
| The arcade release's stages | Done | Optional, from a dump of your own arcade board: the 14 stages it has, their backgrounds as the board lays them, their floors as far as the board's and drawn under the stage as it draws them, darkening toward their edges as the disc's do, the carousel, the helicopter and the torches; `?stages=psx` draws the disc's |
| The arcade release's fighters | Done | Optional, from the same dump: the 31 models it has (where it has a stand-in, Julia's second costume, the disc's is drawn), their seams' own weights, their accessories each on its own joint and swung on the board's own springs; `?fighters=psx` draws the disc's. Their coats' panels and the tails they hang from the hips are kept clear of the legs, as are the tails the disc's models hang from the hips (Hwoarang's belt, in the attract intros too) (`?cloth=original` draws them as the board and the console do). They do not close their eyes, as the board has no closed eyes to draw |
| The remake's settings in the game | Done | REMAKE OPTION in the Options: the textures, the models, the arcade's stages and fighters, the cloth, the picture, the frame rate, the touch pad, reachable walls (online only unless chosen) and a CRT filter (off unless chosen), kept on the device |
| Reachable walls | Done | The stage fixed in place with walls 9.6 m from its middle, the stage drawn larger to meet them; fighters pinned at a wall, a push into it moving the pusher, wall splats (a crumple against it on the ground, a drop down it in the air), once a combo, the third hit after making the fighter fall; the camera kept inside them, and the stage between left out where it stands past one (the fighters along it) or high over them (a knockout's shot from above). In online matches unless the host turns them off; offline where chosen |
| A stop shown as the game's own | Done | A window with what went wrong and what was playing, its details to copy into an issue |
| A free camera and a frame-rate meter | Done | `P` holds a fight and flies a camera through it; `F` shows the frame rate |
| Discs of other regions (PAL, Japanese) | Not yet | The USA disc (SLUS-00402) alone is read |

## Repository Layout

| Path | What |
| --- | --- |
| `scripts/` | Reading the disc image (and, optionally, an arcade board's dump) and importing their data, the only code that knows their formats; building the apps (`app.mjs`); and making the remaster's assets (`remaster.mjs`, `remaster/`) |
| `src/sim/` | The game: a typed, deterministic simulation, with no engine, browser or I/O in it |
| `src/assets/` | The imported assets' types and validating loaders |
| `src/present/` | The presentation on DriftEngine: the 3D, the 2D, the effects, the sound |
| `src/app/` | The page, the input and the 60 Hz loop |
| `src/net/` | Online play: the rollback session, the state saved and restored whole, the server's and the other player's messages, the direct connection |
| `server/` | The online server (`npm run relay`), which pairs players and passes their messages; it runs on its own ([server/README.md](server/README.md)) |
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

Contributors must not submit disc images, arcade ROMs or board dumps, executables, files from the
discs or the board, anything converted from them, screenshots or recordings of game content, or
decompiled code.

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

No Tekken 3 (PlayStation or arcade) or Tekken 4 game files are distributed with this repository.
