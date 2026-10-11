# Usage

## Commands

| Command | What it does |
| --- | --- |
| `npm run disc -- "<image>"` | Reads your disc image (a `.cue` with its `.bin` files, a single `.bin`, or a `.7z` holding them) into `.cache/` |
| `npm run extract` | Turns the disc's files into what the page loads, under `public/data/`; converts the movies when FFmpeg is installed |
| `npm run import` | Writes the game's typed assets, under `public/assets/` |
| `npm run t4 -- "<image>"` | Reads your Tekken 4 disc image (`.iso`, or a `.7z` holding one) for Kazuya; then run `npm run extract` again |
| `npm run dev` | Serves the game on `localhost:5190` (or the next free port), running `extract` and `import` first when their output is missing |
| `npm run build` | Runs the tests, then builds the page into `dist/`. The build copies the disc's data from `public/` into `dist/`: it is for your own machine, never to host or share |
| `npm test` | The tests (those that need the disc's data skip without it), then the typecheck |

Every command runs alike on Windows, macOS and Linux.

### Environment

| Variable | Effect |
| --- | --- |
| `SEVEN_ZIP` | The 7-Zip program to run, when it is not on the path or in its usual folder |
| `DRIFT_ENGINE_LOCAL=0` | Uses the DriftEngine packages from npm even when an engine checkout sits at `../drftrun/driftengine` |

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
| `quality=low` | Leaves out the ambient occlusion and the bloom |
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
