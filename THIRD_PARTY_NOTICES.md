# Third-Party Notices

This repository's own notice (`LICENSE`) covers only material authored by Drift Technologies
and/or the repository authors. Everything listed here remains under its own license and belongs
to its own authors.

## Dependencies

Fetched by npm at install time; no dependency source is vendored into this repository.

| Package | License |
| --- | --- |
| `@driftengine/core`, `@driftengine/audio`, `@driftengine/ui2d` (and `@driftengine/physics`, `@driftengine/drft`, which core uses) | Apache-2.0 (see below) |
| `@fontsource/russo-one` (Russo One) | SIL Open Font License 1.1 |
| `@fontsource/saira-extra-condensed` (Saira Extra Condensed) | SIL Open Font License 1.1 |
| `gl-matrix` | MIT |
| `vite` | MIT |
| `typescript` | Apache-2.0 |
| `@types/node` | MIT |
| `@webgpu/types` | BSD-3-Clause |
| Other transitive packages (see `package-lock.json`) | as each declares |

The two typefaces are bundled into a build (`npm run build`) as the Open Font License allows; their
license travels with their packages.

## Tools run on the user's machine

Not part of this repository and never distributed with it: the commands below are run, when the
user has installed them, on the user's own files.

- **FFmpeg** (<https://ffmpeg.org>), LGPL-2.1 or GPL-2.0 as built: converts the disc's movies to
  web video (`scripts/lib/str.mjs`). Without it the movies are left out.
- **7-Zip** (<https://www.7-zip.org>), LGPL-2.1 with unRAR restriction: unpacks a disc image the
  user keeps as a `.7z` archive (`scripts/lib/sevenzip.mjs`).
- **DriftEngine's packager** (`@driftengine/package`), Apache-2.0: fetched by `npm run desktop`,
  `npm run android` and `npm run ios` at the engine's version, it wraps the built page in an app
  (`scripts/app.mjs`), building a computer's with electron-builder (MIT). A computer's app carries
  its shell's code (Apache-2.0) and Electron (MIT), with Chromium's and Node.js's licences in
  the files beside it; an Android app carries its host's code (Apache-2.0) and AndroidX WebKit
  (Apache-2.0); an iPhone app carries its host's code (Apache-2.0).
- **What the packager builds with**, fetched into the user's cache: Electron's runtime (MIT) for a
  computer's app, and `rcodesign` (MPL-2.0) to sign a Mac's app built on Linux; for an Android
  app, Eclipse Temurin (GPL-2.0 with the Classpath Exception), the Android SDK's command-line
  tools, platform and build tools (the Android Software Development Kit License Agreement), and
  Gradle (Apache-2.0); for an iPhone app, XcodeGen (MIT).

## Game content

Tekken 3 (the PlayStation release and the arcade release on Namco System 12 hardware) and Tekken 4,
their characters, artwork, audiovisual assets, game software and other proprietary data remain
the property of their respective rights holders. Drift Technologies does not own or license them,
and this repository grants no rights in them. Nothing in this repository contains or distributes
them: they are read on the user's machine from the user's own disc or board.

## DriftEngine

DriftEngine is a separate, independently developed engine with its own license, declared in its
own packages. That license covers DriftEngine only. It grants nothing in this repository, and no
rights in Tekken, Tekken 3, Tekken 4 or any other third-party content pass through it.

## Super-xBR

`scripts/lib/upscale.mjs` enlarges pictures by edge-directed interpolation after Hyllian's
Super-xBR, with its filter weights.

> Copyright (c) 2015 Hyllian - sergiogdb@gmail.com
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Tek3Ex

The layout of the disc's `TEKKEN3.BNS` archive and its index (`scripts/lib/bns.mjs`) was checked
against Tek3Ex (<https://github.com/xan1242/Tek3Ex>), MIT License, copyright its author. No source
code from it is included in this repository.

## TekkenMovesetExtractor

The field layout of Tekken 4's movesets read for Kazuya (`scripts/lib/t4/moveset.mjs`) follows
TekkenMovesetExtractor's description of that game's moveset
(<https://github.com/Kiloutre/TekkenMovesetExtractor>, GNU General Public License v3.0, copyright
its contributors), checked against the data.

## Public documentation

- **The PlayStation's hardware documentation** (psx-spx, <https://psx-spx.consoledev.net>): the
  CD-ROM sector and XA audio formats, the sound processor's ADPCM, envelopes and pitch, and the
  reverb presets it lists, as the sound player and the decoders follow them.
- **ECMA-130** (the CD-ROM format) and the cue sheet format: the disc reader and the image join.
- **MAME's Namco System 12 driver** (<https://github.com/mamedev/mame>, `src/mame/namco/namcos12.cpp`,
  BSD-3-Clause, copyright its holders): which of the board's chips hold its program and its data,
  and that each pair holds the even and the odd bytes of a 16-bit bus, as `npm run arcade` joins
  them (`scripts/lib/arcade/board.mjs`). No code from it is included.
- **ISO 9660**: the disc's file system.
