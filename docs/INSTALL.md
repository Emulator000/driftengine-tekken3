# Installing, step by step

The README's Getting Started, one step at a time, for Windows, with notes for macOS and Linux and
the problems people meet most. It takes some fifteen minutes, then a few more while the first start
converts the disc's data.

The game is made from an image of your own Tekken 3 disc, on your computer: nothing here downloads
it, and an image from anywhere else is not supported. Keep the image and what the game converts
from it to yourself.

## What you need

- Your Tekken 3 disc, the USA release (SLUS-00402), and a CD or DVD drive.
- A few gigabytes free on the disk.
- Chrome or Edge to play in.

## On Windows

Use **Command Prompt** for every command below (Start menu, type `cmd`). PowerShell's usual
settings refuse npm's own script (*npm.ps1 cannot be loaded because running scripts is disabled on
this system*); if you'd rather stay in PowerShell, type `npm.cmd` wherever this guide says `npm`.

### 1. Install Node.js

```bat
winget install OpenJS.NodeJS.LTS
```

or the LTS installer from <https://nodejs.org>. Then close Command Prompt, open a new one (the new
one finds `node`), and check its version:

```bat
node --version
```

It must say `v22.12` or newer. FFmpeg is optional: with it the disc's movies play
(`winget install Gyan.FFmpeg`); without it they are left out.

### 2. Get the game's code

Download **Source code (zip)** from the latest release,
<https://github.com/Emulator000/driftengine-tekken3/releases>, and extract it. Extracting often
makes a folder inside a folder of the same name: the right one has `package.json` in it. Go there,
for example:

```bat
cd /d "%USERPROFILE%\Desktop\driftengine-tekken3-0.7.17\driftengine-tekken3-0.7.17"
dir package.json
```

`dir` must list `package.json`. (With Git instead: `git clone
https://github.com/Emulator000/driftengine-tekken3.git`, then `cd driftengine-tekken3`.)

### 3. Make an image of your disc

Put the disc in the drive. In ImgBurn, choose **Create image file from disc** and save it, say as
`C:\Games\tekken3.bin`: ImgBurn writes `tekken3.bin` and `tekken3.cue` side by side. The game reads
this BIN/CUE pair; an `.iso` leaves out the disc's music and is not read.

### 4. Install and read the disc

```bat
npm install
npm run disc "C:\Games\tekken3.cue"
```

`npm install` may print warnings and notices (a newer npm, funding): they stop nothing. A problem
ends with lines starting `npm error`. `npm run disc` checks that the image is Tekken 3 (USA).

### 5. Play

```bat
npm run dev
```

The first time, it converts the disc's data first, a few minutes, and then prints the address to
open: <http://localhost:5190>, in Chrome or Edge. Leave the window open while you play; Ctrl+C in it
stops the game. Next time, open Command Prompt in
the same folder (step 2's `cd`) and run `npm run dev` again.

## On macOS and Linux

The same steps in a terminal: Node.js 22.12 or newer (`brew install node` on macOS, your
distribution's `nodejs` on Linux), the image made with `cdrdao` as the README shows, then
`npm install`, `npm run disc "path/to/tekken3.cue"` and `npm run dev`.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| `'node' is not recognized`, or `'npm' is not recognized` | Open a new Command Prompt after installing Node.js; if it stays, sign out of Windows and in again. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | That is PowerShell: use Command Prompt, or type `npm.cmd` for `npm`. |
| `Could not read package.json`, or `ENOENT` and `package.json` | The wrong folder: `cd` into the one that has `package.json` (step 2). |
| `node --version` older than `v22.12` | `winget upgrade OpenJS.NodeJS.LTS`, then a new Command Prompt. |
| `is it Tekken 3 USA (SLUS-00402)?` | Only the USA disc is read, as a BIN/CUE image (step 3). |
| `no such file` | The path to the `.cue` is wrong: put it in quotes, exactly as it is on the disk. |
| The page stays black, or says loading | Give the first load a minute, in an up-to-date Chrome or Edge, with the window still open. |

## Asking for help

An AI assistant (ChatGPT, Claude, Gemini, Copilot or another) is good at exactly this. Paste in the
command you ran and everything it printed, say which step of this guide you are on and which system
you use, and ask what went wrong: it can walk you through installing Node.js, finding the right
folder or reading an error, one command at a time. Leave out anything private, and know that no
assistant (nor anyone else) can give you the game: it is made from your own disc.

You can also open an issue on GitHub with the same output.
