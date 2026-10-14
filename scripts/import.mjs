/**
 * The remake's importer: reads the disc's files (`npm run disc`) and writes the typed assets the
 * remake loads under public/assets/, never committed; the only code that knows where the original
 * keeps its data.
 *
 *   manifest.json      the format and which movesets were written
 *   tables/math.json   the sine, arctangent and square-root tables
 *   tables/motion.json the weights of the motions' cubic
 *   tables/input.json  the pad's directions as numpad directions, per side
 *   tables/skeleton.json the skeleton's joints, offsets and inverse roots
 *   tables/roster.json the per-character tables
 *   tables/hits.json   the hit records every moveset shares
 *   tables/reactions.json the reactions, knockback and launches
 *   tables/cancels.json the shared cancel lists and the motion kinds
 *   tables/camera.json the camera's shots, scenes, opening sweeps and knockout placings
 *   tables/ball.json   Tekken Ball's balls, the ball's mesh and colours, its select's names
 *   tables/force.json  Tekken Force's waves, enemies, bosses, stages' scripts and backdrops
 *   tables/computer.json the computer player's tuning, scripts, pads and choices
 *   tables/sound.json  the effects' codes, the characters' voices, the hit sounds and sound scripts
 *   tables/effects.json the breath, glow, dust, sparks, camera shakes, fire, and the Mishimas'
 *                       lightning sheet traced into strokes
 *   tables/banks.json  the sound banks' tones and waveforms' block flags, for timing voices
 *   sound/banks.json   the banks for playing: what the sound library keys a voice by, and each
 *                      waveform's place in its bank's PCM (sound/banks/*.pcm, decoded from ADPCM)
 *   sound/music.json   each song's picks (its XA song, volume, loop) and the music's options
 *   tables/commands.json each model pack's command list, as text and tokens
 *   tables/scenes.json the values the scenes' state starts with
 *   tables/intro-models.json the attract intros' models, by the pack each stands for
 *   pictures/*.png     the original pictures shown as they are: the title's, the select's
 *   textures/{fighters,stages}/NN.png the texture atlases enlarged, for the smooth textures
 *                      (and textures/arcade/{stages,fighters}/NN.png, the arcade's)
 *   models/{fighters,intro}/*.ftr the fighters' meshes rounded, for the smooth models (Kazuya's copied),
 *                      and models/arcade/fighters/NN.ftr the arcade's
 *   movesets/NN.json   each moveset by id, and common.json
 *   motions/NN.json    each moveset's motions as curves, and common.json
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSET_FORMAT } from '../src/assets/manifest.ts';
import { openExecutable } from './import/executable.mjs';
import { inputTables } from './import/input.mjs';
import { mathTables } from './import/math.mjs';
import { hitTables } from './import/hits.mjs';
import { cameraTables } from './import/camera.mjs';
import { ballTables } from './import/ball.mjs';
import { forceTables } from './import/force.mjs';
import { cancelTables } from './import/cancels.mjs';
import { computerTables } from './import/computer.mjs';
import { soundTables } from './import/sound.mjs';
import { effectTables } from './import/effects.mjs';
import { lightningFrames } from './import/lightning.mjs';
import { playableBanks, soundBanks } from './import/banks.mjs';
import { musicTables } from './import/music.mjs';
import { reactionTables } from './import/reactions.mjs';
import { rosterTables } from './import/roster.mjs';
import { skeletonTables } from './import/skeleton.mjs';
import { fighterModels, introModels } from './import/fighters.mjs';
import { arenaTables } from './import/arena.mjs';
import { commandTables } from './import/commands.mjs';
import { sceneTables } from './import/scenes.mjs';
import { originalPictures } from './import/pictures.mjs';
import { upscaleTextures } from './import/textures.mjs';
import { roundModels } from './import/models.mjs';
import { curveTables, importMotions } from './import/motion.mjs';
import { importMoveset, INTRO_ID, movesetFiles, numberMotions } from './import/moveset.mjs';
import { createOutput } from './import/output.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/assets');
const manifestPath = path.join(out, 'manifest.json');
/* Up to date: this format, and written after the data it was made from. */
const dataManifest = path.join(root, 'public/data/manifest.json');
const current =
  existsSync(manifestPath) &&
  JSON.parse(readFileSync(manifestPath, 'utf8')).format === ASSET_FORMAT &&
  (!existsSync(dataManifest) || statSync(dataManifest).mtimeMs <= statSync(manifestPath).mtimeMs);
if (process.argv.includes('--if-missing') && current) process.exit(0);
const exePath = path.join(root, '.cache/disc/SLUS_004.02');
if (!existsSync(exePath)) throw new Error('no disc data: run npm run disc first');

const exe = openExecutable(new Uint8Array(readFileSync(exePath)));
const output = createOutput(out);
output.json('tables/math.json', mathTables(exe));
output.json('tables/motion.json', curveTables(exe));
output.json('tables/input.json', inputTables(exe));
output.json('tables/skeleton.json', skeletonTables(exe));
const roster = rosterTables(exe, root);
output.json('tables/roster.json', roster);
output.json('tables/commands.json', commandTables(exe, root, [...new Set(roster.codes.map((code) => code.pack).filter((pack) => pack >= 0))]));
output.json('tables/hits.json', hitTables(exe));
output.json('tables/camera.json', cameraTables(exe));
output.json('tables/ball.json', ballTables(exe, root));
output.json('tables/force.json', forceTables(root));
output.json('tables/computer.json', computerTables(exe));
output.json('tables/sound.json', soundTables(exe, root));
/* The Mishimas' lightning sheet, which Jin, Heihachi, Gon, Doctor B. and the soldiers share: Jin's (roster 9) stands for them all. */
const lightningSheet = new Uint8Array(readFileSync(path.join(root, `public/data/fighters/${String(roster.codes[9 * 4].pack).padStart(2, '0')}.spark`)));
output.json('tables/effects.json', { ...effectTables(exe), lightning: lightningFrames(lightningSheet) });
output.json('tables/banks.json', soundBanks(exe, root));
playableBanks(exe, root, output);
output.json('sound/music.json', musicTables(exe, JSON.parse(readFileSync(path.join(root, 'public/data/manifest.json'), 'utf8')).tracks ?? []));
output.json('tables/fighters.json', fighterModels(root));
output.json('tables/arena.json', arenaTables(exe, root));
const scenes = sceneTables(exe, root);
output.json('tables/scenes.json', scenes);
output.json('tables/intro-models.json', introModels(root, scenes.intros));
for (const [name, png] of Object.entries(originalPictures(exe, root))) output.bytes(`pictures/${name}.png`, png);
const { files, kazuya } = movesetFiles(root);
const motions = numberMotions(files);
output.json('tables/reactions.json', reactionTables(exe, files));
output.json('tables/cancels.json', cancelTables(exe, files));
for (const file of files) {
  output.json(`movesets/${file.name}.json`, importMoveset(file, motions, files, exe));
  output.json(`motions/${file.name}.json`, importMotions(file, motions, exe));
}
const enlarged = await upscaleTextures(root, output);
if (enlarged > 0) console.log(`enlarged ${enlarged} texture atlases`);
console.log(`rounded ${roundModels(root, output)} fighter meshes`);
const { arcadeStages = [], arcadePanoramas = [], arcadeObjects = [], arcadeFighters = [] } = JSON.parse(readFileSync(dataManifest, 'utf8'));
output.finish({ format: ASSET_FORMAT, movesets: files.filter((f) => !f.common && f.id !== INTRO_ID).map((f) => f.id), kazuya, arcadeStages, arcadePanoramas, arcadeObjects, arcadeFighters });
console.log('imported to public/assets/');
