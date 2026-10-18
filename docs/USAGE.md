# Usage

## Commands

| Command | What it does |
| --- | --- |
| `npm run disc -- "<image>"` | Reads your disc image (a `.cue` with its `.bin` files, a single `.bin`, or a `.7z` holding them) into `.cache/` |
| `npm run extract` | Turns the disc's files into what the page loads, under `public/data/`; converts the movies when FFmpeg is installed |
| `npm run import` | Writes the game's typed assets, under `public/assets/` |
| `npm run t4 -- "<image>"` | Reads your Tekken 4 disc image (`.iso`, or a `.7z` holding one) for Kazuya; then run `npm run extract` again |
| `npm run arcade -- "<folder>"` | Reads the dump of your own Tekken 3 arcade board (its chips' files, in one folder) for the arcade's stages, into `.cache/arcade/`; then run `npm run extract` again ([Tekken 3 Arcade assets](../README.md#tekken-3-arcade-assets-optional)) |
| `npm run remaster` | Makes the remaster's assets on this machine (an x64 PC with Linux or Windows, or a Mac with Apple silicon on macOS 26 or later), on its GPU where it has one (`-- --cpu`, `-- --rocm`, `-- --cuda`, `-- --mps` to choose; job names after it make those parts alone), into `public/assets/remaster/`; then REMASTER in REMAKE OPTION draws with them ([The remaster](../README.md#the-remaster-optional)) |
| `npm run dev` | Serves the game on `localhost:5190` (or the next free port), running `extract` and `import` first when their output is missing |
| `npm run dev:lan` | Serves the game to your own devices on your home network, over HTTPS and over plain HTTP at the next port ([Over your home network](#over-your-home-network)) |
| `npm run desktop` | Builds the game as an app for this computer (Windows, macOS or Linux), with your disc's data in it (and the remaster's assets, once `npm run remaster` has made them), into `out/<target>/`; `-- mac-arm64` or `-- mac-x64` builds a Mac's on Linux ([As an app](#as-an-app)) |
| `npm run android` | Builds the game as an Android app for your own phone, with your disc's data in it, into `out/android/` ([As an app](#as-an-app)) |
| `npm run ios` | On a Mac with Xcode, builds the game as an iPhone app, with your disc's data in it, into `out/ios/` ([As an app](#as-an-app)) |
| `npm run relay` | Runs the online server on its own, on port 8790 (`-- --help` lists its settings; [Online](#online)) |
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
| `T3_RELAY=0` | `npm run dev` and `npm run dev:lan` leave out the online server they run beside the page |
| `T3_LAN_HTTP=0` | `npm run dev:lan` serves over HTTPS alone, without the plain HTTP beside it |
| `T3_RELAY_*` | The online server's settings, wherever it runs ([server/README.md](../server/README.md)) |

## The page's options

Add them to the address, for example `http://localhost:5190/?quick&p1=9&p2=13&stage=3`. The
textures, the models, the stages, the fighters, the cloth, the picture and the touch pad are also
set in the game ([REMAKE OPTION](#remake-option)); a page started with one of them in its address takes the
address's.

| Option | Effect |
| --- | --- |
| `quick` | A versus match at once, without the menus. Any of `p1`, `p2`, `stage` or `cpu` alone means a quick match too |
| `p1`, `p2` | The quick match's fighters, by roster id (below) |
| `stage` | The quick match's stage, from 0 |
| `cpu` | Which sides the computer plays: `2` (the default), `1`, `12` to watch it play itself, `0` for two players |
| `walls=on` | The quick match with reachable walls (see REACHABLE WALLS below) |
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
| `stages=psx` | Draws the disc's stages where the arcade board's data has the arcade's (by default the arcade's, once `npm run arcade` has read it) |
| `fighters=psx` | Draws the disc's fighters where the arcade board's data has the arcade's models (by default the arcade's, once `npm run arcade` has read it) |
| `cloth=original` | Draws the fighters' cloth as the board and the console do, a leg passing through a coat's panel or a tail where it swings into it (by default each is kept clear of the legs, the disc's models' tails too, in the attract intros as well) |
| `models=psx`, `models=rounded` | Draws the fighters with the console's meshes, or the rounded ones (by default the rounded ones, but at `quality=verylow`) |
| `quality=high` | The whole picture: ambient occlusion and bloom over the multisampled HDR scene; the default but on a phone |
| `quality=low` | Leaves out the ambient occlusion and the bloom; a phone's default |
| `quality=verylow` | The picture for an entry-level phone: the scene drawn straight to the screen with no pass after it, one pixel to the CSS pixel and no more pixels than a 640 by 480 picture, thirty pictures a second (the game still runs sixty fields), and the fighters with the console's meshes. It is the default on a phone whose GPU the browser names as an entry-level part (a Mali-G31, G51, G52 or G57, an Adreno 5xx or 600s to 610s, or a PowerVR) |
| `budget=N` | The frame time, in milliseconds, the picture's density is held to (20 by default): while most of a fight's frames take longer, the picture steps down toward half its pixels each way, and back up as the frames allow; `0` holds it still |
| `touch=1`, `touch=0` | The touch pad over the picture anywhere and always, or hidden (as TOUCH PAD in REMAKE OPTION; by default on a touch screen or a phone while no gamepad is connected). A phone shows it while no gamepad is connected even with `touch=0` |
| `remaster=on`, `remaster=off` | The fight remastered or not (as REMASTER in REMAKE OPTION), once `npm run remaster` has made its assets |
| `look=light`, `look=normal`, `look=strong` | The remaster's look (as LOOK in REMAKE OPTION) |
| `brightness=low`, `brightness=normal`, `brightness=high` | The remaster's brightness (as BRIGHTNESS in REMAKE OPTION) |
| `floorfade=on`, `floorfade=off` | Whether the remaster's floors fade into the dark (as FLOOR FADE in REMAKE OPTION) |
| `crt=on`, `crt=off` | The CRT filter over the picture (as CRT FILTER in REMAKE OPTION) |
| `netlag=MS` | Online, each of the other side's presses held that many milliseconds more ([Online](#online)) |
| `server=ADDRESS` | The online server ONLINE MODE connects to (`host:port`, `ws://…`, `wss://…`), over SERVER on its page; by default the one beside the page (`/relay`) |
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

## The free camera

`P` holds the fight and flies a free camera through it, from the shot it was in, for looking at a
stage or a frame up close: a drag with the left mouse button turns it, with the right or middle
slides it across the view; the wheel moves it along its view; W A S D fly it, Q and E sink and lift
it; Shift goes four times as fast, Alt a quarter. `P` again gives the camera back to the fight,
which goes on from the field it stopped at.

## The frame rate

`F` shows and hides the frame rate in the top right corner: the frames shown over the last second,
their mean time and the longest of them. Whether it shows is kept with REMAKE OPTION's settings
(its FRAME RATE) for next time.

## REMAKE OPTION

The Options' first page lists REMAKE OPTION before its EXIT: the remake's own settings, changed as
GAME OPTION's are (up and down to pick, left and right to change), kept on the device (the browser,
or the app) for every start after.

| Setting | Values |
| --- | --- |
| TEXTURES | SMOOTH (enlarged and smoothed), ORIGINAL (each texel sharp, as `textures=psx`) |
| MODELS | AUTO (rounded, but on an entry-level phone), ROUNDED, ORIGINAL (the console's meshes) |
| STAGES | ARCADE (the arcade board's, where `npm run arcade` has read them), CONSOLE |
| FIGHTERS | ARCADE (the arcade board's models, where it has read them), CONSOLE |
| CLOTH | CLEAR OF LEGS (a board's fighter's coat panels and the tails a fighter hangs from the hips, a board's model's or the disc's, kept clear of the legs: a panel carried over a raised thigh, a tail put out where a leg swings into it), ORIGINAL (as the board and the console draw them, as `cloth=original`) |
| PICTURE | AUTO (by the device), HIGH, LOW, VERY LOW (as `quality=`) |
| FRAME RATE | OFF, ON (as `F`) |
| TOUCH PAD | AUTO (on a touch screen or a phone, hidden while a gamepad is connected), ON (always), OFF (hidden; a phone still shows it while no gamepad is connected, so it can always be played) |
| REMASTER | OFF, ON (the fight drawn with the engine's lighting, the stage's own sky, light and 3D floor, and the assets `npm run remaster` made; until it has, the page says RUN NPM RUN REMASTER FIRST; off at the lowest picture quality) |
| LOOK | LIGHT, NORMAL, STRONG (listed while REMASTER is on: how strongly the remastered picture is graded, its shadows toward teal and its lights toward magenta, its corners darkened and its edges fringed; changed at once) |
| BRIGHTNESS | LOW, NORMAL, HIGH (listed while REMASTER is on: how brightly the remastered picture is exposed, LOW as it was first drawn; changed at once) |
| FLOOR FADE | ON, OFF (listed while REMASTER is on: the floors darkened by depth, or away from the stage's lights, as the game darkens its own, an arcade stage's own floors with them; or lit evenly; changed at once) |
| REACHABLE WALLS | ONLINE ONLY (the default: walls in online matches and the waiting room, none offline), ON (in every ordinary mode offline too: Arcade, Versus, Team Battle, Time Attack, Survival, Practice), OFF (none offline; online, a match you host has none). With walls, the stage stands still, unturned, its walls 9.6 m from its middle, the stage drawn up to half as large again so its own nearest walls meet them; where a stage is open or its walls stand farther, the walls there are unseen. Nobody walks or is knocked through a wall: backed against one, a fighter is pinned there, and a push into it moves the one pushing. A hit that would knock a fighter a long way back, caught by the wall, splats it: on its feet it crumples against the wall, then slides to the ground; in the air it drops straight down the wall. Once a combo; the third clean hit after a splat makes the fighter fall. The camera, where the game would put it past a wall, comes in along its line to the fighters; where that would bring it too near them (the fighters along the wall), or where it looks down from high over them, the stage between is left out. Never in Tekken Ball, Tekken Force or the attract demo; taken at the next match |
| CRT FILTER | OFF (the default), ON: the picture as a tape played on a television showed it. It is softened, a little across, and its colour much more, smeared to the right of the edges it belongs to. Over it lie soft scanlines (240 down the picture), a faint aperture grille of red, green and blue columns and darkened corners, the picture under them a little brighter. A fine grain crawls over it, a faint band rolls slowly down and the picture flickers a little; all three hold still where the system asks for less motion. Laid over the picture, so the same with any renderer and quality; changed at once |

The frame rate and the CRT filter show or hide at once, and REACHABLE WALLS is taken at the next match. The others change what the game loads: while one differs
from the start's, the page says LEAVING RESTARTS THE GAME, and leaving it starts the game again
(with auto save on, the progress is saved first).

## Online

ONLINE MODE, after VS MODE in the mode menu, lists:

| Line | What it does |
| --- | --- |
| QUICK MATCH | Waits for the next player of the same game, who is offered to you |
| CREATE ROOM | Opens a room and shows its code, to give the other player; with ROOM set to LISTED it shows in the server's room list too |
| JOIN ROOM | The room with the code you enter |
| ROOM LIST | The rooms the server lists; those you cannot join (another version, or a host playing a fighter you lack) greyed, CANNOT JOIN |
| INPUT DELAY | The fields your presses wait before they count, 0 to 6 (2 by default): the larger of both players' is the match's |
| ROOM | PRIVATE (by its code alone) or LISTED |
| SIDE | The side your fighter is seen on in the match, LEFT (the default) or RIGHT, whichever the server seats you on |
| NAME | Your name, as the other player sees it |
| SERVER | The server's address; empty, the one beside the page. A bare `host:port` is tried as `wss://` and as `ws://`, the page's own way first |

The page connects to the server as it opens, and shows under its title the players on it and those
searching in the quick match; the waiting room shows them in its corner. A browser opened on the
server's own address shows its page: the same numbers, the fights on now, the rooms, the versions it
serves and how to play on it ([server/README.md](../server/README.md#its-page)).

Select goes back. The code, the name and the address are entered with the pad (up and down
through the letters, left and right along them) or with a keyboard and a mouse as a text box is:
typed, the arrows, Home and End (with Shift, selecting), Backspace and Delete, Ctrl+A, Ctrl+C,
Ctrl+X and Ctrl+V, the mouse placing the caret, dragging a selection and selecting all with a
double click.

**The waiting room.** A quick match, a room created or a room joined starts with Practice's select:
you choose your fighter (L1 and R1 choose your side, as SIDE does); your partner is drawn at
random. Then you fight it, as Practice's 1P FREESTYLE with its training dummy standing and the attack
data shown, while what is waited for shows in the corner (a room's code with it); start opens
Practice's menus as ever, and RESET (in them, or Select with Start held) leaves the waiting room for
ONLINE MODE's page. The free camera is off in online play.

**An opponent found.** Every pairing asks both of you: the quick match's, and a room's host with
the player joining it. The fight holds under a card with their name and a bar running down the
seconds the server gives (10 by default): start says yes, select no, the two buttons the waiting
fight does not fight with (a press counts once the card has settled, half a second, as the two
answers show). Both yes, a card names the other player a moment and the match starts. In the
quick match a no puts both of you back in the queue, kept apart from each other a while, and a card
not answered in time puts both back to look again; at a room, the guest is sent away (saying why)
and the room waits on.

**The match.** Versus, your fighters as chosen, on a stage drawn at random, no handicap, three
rounds to win, with reachable walls unless the host's REACHABLE WALLS is OFF, from the state the
game powers on with: the host's options and earned characters, each player's own buttons. Your progress and records are left as they were. Where the server seats
you on the other side than SIDE asks, the fight is drawn mirrored: your fighter and its plate on
your side, the stick's left and right with the picture. Each player's name shows under their
fighter's, on a dark tag of its own, with their streak of wins (WINS 3) where the server counts
one. The versus screen counts the matches on your pairing: FIGHT 1, then FIGHT 2 at the first rematch
and so on (a 0.6.5 game shows FIGHT 1 at each). Both of you stay on the versus screen until both
games have the fight loaded and ready, and go into it together; the one ready first shows WAITING FOR
the other, or that it IS LOADING (with a 0.6.5 or 0.6.6 game, which does not say when it is ready,
the one ready first goes on as before; with one that says nothing of loading or of being ready for
three seconds, it goes in after it). A round's end (its replay, the win poses) is cut short only
once both of you have pressed to skip it; until then it plays on, for both.

What the other player presses is guessed until it arrives, and a guess put right rolls the game
back and plays it again (see below). So that nothing wrong is heard or seen: a field's sound is
played once both players' presses for it are in, so a hit a guess missed is still heard and a voice
is never cut by one a guess played (over a long link the sound comes a little after the picture);
and a knockout is shown once both players' presses for its field are in, the picture holding a
moment until then, so a knockout a late press takes back is never seen.

**After the match.** The fight's last picture holds until the match is over, then the waiting room
comes back under a card with its result: who won, whether you did, and the score since you were
paired. Start asks for a rematch, select goes back to the waiting room, within 30 seconds. Both of
you asking, the same two fighters fight again on a stage drawn anew; a no from either, or no answer
in time, puts both back in the waiting room, waiting again (a quick match's two kept apart from
each other a while; a room joined goes back to ONLINE MODE's page). A reset by either player ends
the match too, the one who reset going back to the page.

**Your streak of wins.** The server counts the matches each player wins without a loss: one more for
each match won, back to none at a match lost or left while it was under way (the player left behind
gains nothing), a draw changing nothing. The waiting room shows yours in its corner as WINS and the
number, over the server's counts, and a match each player's by their name. The server keeps it in
its memory by an id your game makes once and keeps (it shows it to no one), so it holds while you
come and go, until the server stops or a day passes without you. A 0.6.5 game, which keeps no id,
has no streak counted, and the player it plays is counted on their own game's word.

Each side plays its own pad at once and the other's as it arrives, guessing it held until then; a
press that comes late rolls the game back to its field and plays on again within the frame (eight
fields at most: one later waits for it, and five seconds of waiting ends the match, the other's
page answering or not, unless the other side is loading). A press made while a side waits is played with its next field. Both sides compare a
fingerprint of the game's state every eight fields; a difference ends the match and the console
names the field. The line over the picture shows the opponent, the round trip, the input delay,
the rollbacks and whether the presses go straight between the two machines (DIRECT) or through the
server; and says so while the other side loads or is waited for. Should the direct connection
close, or a wait over it last half a second, the presses go through the server as well for the rest
of the match. `?netlag=MS` holds each of the
other side's presses that many milliseconds more, to try a match over a slower link.

Two players are paired, and a room is joined, only where they can play each other: a version both
games play a match as, and each one's fighter one whose data the other has. 0.7.1 plays its own
matches with the 0.7.0 and later players, and those of 0.6.5, 0.6.6 and 0.6.7 with theirs, without
the walls (whatever REACHABLE WALLS says; the line over the picture says AS 0.6.5, NO WALLS); the
server pairs them so from its 0.7.1 on. A player without Kazuya, say, is
paired with one who has him unless either of you chose him, and a room whose host plays him shows
greyed in the room list. ONLINE MODE says why a pairing cannot be made (THE OTHER PLAYER HAS
VERSION 0.6.0, YOU LACK KAZUYA, THE OTHER PLAYER LACKS KAZUYA). The rest of the game's data may
differ between the two (a disc ripped without its cue sheet, an arcade board's models); should it
make the two games play differently, the match ends as they part (THE GAMES DIFFERED).

**A server to play over.** `npm run dev` runs one beside the page for players on the same machine,
`npm run dev:lan` for players on the same home network. Over the internet, one of you runs
`npm run relay` (or the `server/` folder on a machine of its own) and opens its one TCP port, 8790
by default, on the router and the firewall; everyone sets SERVER to its public address and port
(`203.0.113.7:8790`), the host `localhost:8790`. The players open nothing: where their games cannot
reach each other directly, the presses go through the server. [server/README.md](../server/README.md#opening-it-to-the-internet)
says more.

## The version

The mode menu shows the game's version at the screen's top right. To tell whether a newer one is
out, the page asks GitHub's public API for this repository's tags. It does so at most once every six
hours, keeps the newest on the device, and sends GitHub nothing but the request itself. Where a tag
`vX.Y.Z` is higher than the game's version, (NEW VERSION AVAILABLE!) follows it. Without the
network, or where GitHub does not answer, the version shows with what the device last kept, or alone.
A checkout ahead of the newest tag shows no notice.

## When the game stops

Should the game stop on an error, it says so in a window over the picture: what went wrong and
where, and what was playing (the version, the scene, the fighters, the stage, the renderer). A
screenshot of it, or its details (Copy details), is what an issue needs; Start again reloads the
page.

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

Should the packager end without these files, the build lays the game into the unpacked app it
made where the packager had not (as `resources/app/`, which Electron runs as it would its archive).
On Linux it then makes `tekken3-<version>.tar.gz` itself; elsewhere it keeps the unpacked app
(`out/<target>/…-unpacked/`, which runs as it is), says so, and stops with an error. Run it again with
`DEBUG=electron-builder` set to see where the packager stopped.

Each is some 900 MB. Once `npm run remaster` has made its assets, the app carries them too, and the
remaster with them (REMASTER in REMAKE OPTION): some 3 GB more, which the build says. A Windows
installer cannot hold more than 2 GB, so with the remaster made, play a Windows app from its zip,
or from the unpacked app the build keeps where the installer fails. A phone's app
(`npm run android`, `npm run ios`) leaves the remaster out.

`npm run desktop -- mac-arm64` (or `mac-x64`) builds a Mac's app on Linux, as a
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
the APK's own files, held in landscape either way up. It asks for one permission, the network, for
ONLINE MODE, and reaches a server with a certificate (`wss://`) or without one (`ws://`, as
`npm run relay` and the plain HTTP port of `npm run dev:lan` serve on a home network: a bare
address in SERVER tries `wss://` and then `ws://`). It writes `out/android/Tekken-3-<version>.apk`, some 750 MB; install it with
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

It serves the same page over plain HTTP too, at the port after the HTTPS one (`http://<address>:5191`,
printed with the others), for a device you would rather not ask to accept the certificate: there
the page draws with WebGL2 rather than WebGPU, and has no full screen (nor, in some browsers, the
gamepads), which a browser keeps for a secure page (on the machine itself, `http://localhost` is one). Its online
server is the same as the HTTPS page's, so players on either meet. `T3_LAN_HTTP=0` leaves it out.

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

A gamepad connected hides the touch pad (TOUCH PAD set to AUTO or OFF), and it comes back the moment
the gamepad goes, mid-fight too: a phone with no gamepad always shows it, whatever TOUCH PAD says.
A browser shows the page a gamepad once one of its buttons is pressed, so the touch pad stays until
the gamepad's first press.

A phone's page is `quality=low`, or `quality=verylow` on an entry-level phone, and its picture's
density is held to its frames (`budget`).

### A slow device

The picture's density steps down while a fight's frames run slow (`budget`), to half its pixels
each way, and back up as they allow. A frame after the game waited (an online match waiting for
the other side, a fight loading) or the page was hidden does not count: its time is the wait's.
Nothing is kept between starts: each starts at its full density and picks its picture afresh (the
address's, REMAKE OPTION's, or the device's own as above), so `quality=verylow` is drawn only where
it is chosen, or on an entry-level phone. A setting an earlier version kept, after a fight it found
too slow, is cleared at the first start.
