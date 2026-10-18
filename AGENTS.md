# Working on this repository

## What this is

Tekken 3 on DriftEngine: an unofficial, independently developed runtime that reads the data of a
user's own Tekken 3 disc (USA, SLUS-00402) and plays the game in the browser, rebuilt as a typed,
deterministic simulation (`src/sim`) with a DriftEngine presentation (`src/present`). Optionally
it draws the arcade release's stages and fighter models from a dump of the user's own arcade
board.

## Rules

This repository is public and source-visible. Everything committed, and every commit message,
issue and pull request, is public.

- **Nothing from the disc or the board in git.** No disc images, no arcade ROMs or board dumps,
  no executables, no files from the disc or the board, no extracted, decoded or converted content,
  no screenshots or recordings of game content. Converted output is still the game's content
  whatever its format. The disc's and the board's data live under `.cache/`, `public/data/` and
  `public/assets/`, all ignored.
- **The user's own disc.** Everything the game shows and plays comes from the image the user
  makes of their own disc (and, optionally, the dump the user makes of their own arcade board),
  read on their machine. Nothing converted is ever hosted, uploaded or
  served beyond the user's own machine and devices: `npm run dev` binds to localhost,
  `npm run dev:lan` serves the user's own home network, and `npm run desktop`, `npm run android`
  and `npm run ios` build an app on their machine for their own computer or phone. No release,
  issue or pull request carries an app or any other build holding the disc's data.
- **Write it plainly.** Code comments say what the code does, briefly; they do not narrate how a
  format or a behaviour was worked out. The repository carries no format documentation of the
  game's own files.
- **No copy protection work.** Nothing that bypasses a disc's copy protection, region lock, an
  arcade board's security hardware or any other technical measure.
- **Third-party code is credited.** Code that follows a published algorithm or an open-source
  project is credited in `THIRD_PARTY_NOTICES.md` under its licence; code from a project whose
  licence does not allow it is not used.
- **Facts, not legal conclusions.** Docs and messages state what the code does and what the
  repository contains. No personal names, local paths or machine details.
- **Tests use synthetic bytes** where they can. A test that needs the disc's data reads it
  locally and skips when it is absent.

## Shape

- `scripts/` (the importer, the disc tools and the arcade board's reader) is the only code that
  knows where the disc, its executable and the board keep their data; it writes typed assets into
  `public/assets/`.
- `src/sim/` is the game: deterministic, no DOM, no engine, no I/O. `src/assets/` validates the
  imported assets; `src/present/` draws and plays a frame's output on DriftEngine; `src/app/`
  is the page, the input and the 60 Hz loop. `tests/architecture.test.mjs` keeps these rules.
- `src/mod/kazuya/` adds Kazuya from the user's own Tekken 4 disc through named extension
  points.
- The apps are the built page in DriftEngine's packager (`scripts/app.mjs`, `drift.package.json`),
  fetched at the engine's version when `npm run desktop`, `npm run android` or `npm run ios` runs:
  Electron on a computer, a WebView on a phone. The touch pad (`src/app/touch.ts`) is the first player's pad on
  a touch screen.
- Online, two games are paired by `PLAYS_AS` (`src/net/online.ts`), not by the package's version:
  the oldest release whose matches this one plays exactly as. A release that changes the
  simulation, the match's setup or the words between the games sets it to its own version; one
  that only draws or sounds otherwise keeps it, so its players still meet those of earlier
  releases (`tests/net-online.test.mjs` compares the simulation with that release's tag).
- The engine comes from npm. A checkout at `../drftrun/driftengine` replaces it in development
  (`DRIFT_ENGINE_LOCAL=0` forces the npm packages).

## Commands

```sh
npm test               # the tests, then the typecheck
npm run dev            # the game on localhost
npm run dev:lan        # the game over HTTPS on the home network, for a phone
npm run desktop        # the game as an app for this computer (Windows, macOS, Linux)
npm run android        # an APK of the game, for the user's own phone
npm run ios            # on a Mac with Xcode, the game as an iPhone app (untried)
```
