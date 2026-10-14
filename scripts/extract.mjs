/**
 * Turns the disc's files into what the player loads, under public/data/ (never committed).
 * Needs `npm run disc` first.
 *
 *   exe.bin          the executable's image, loaded at 0x80010000, which the fight runs against
 *   tables.json      the executable's motion constants and part table
 *   fighters/NN.*    per character pack: the mesh (.ftr, with its hands' shapes and its closed
 *                    eyes, scripts/lib/fighter.mjs), its skeleton (.json) and atlas (.png),
 *                    the model file itself (.3dmk), which the fight hangs its skeleton on, its
 *                    archive's spark frames (.spark, member 1), which the fight puts in VRAM, and
 *                    its sound bank, the header (.vh, the pack's second file) and the waveforms
 *                    (.vb, the archive's member 2), and its pause menu command list (.cmd,
 *                    member 4)
 *   textures.arc     the boot's texture archive, which the title overlay (BNS 10) carries at
 *                    0x1330 and its start puts in VRAM: the HUD, the generic sparks
 *   moves/MM.bin     per moveset id: the moveset the fight loads (BNS 280 + id, logical 0x4a + id)
 *   moves/common.bin the moveset every character shares motions from (BNS 279, logical 0x49)
 *   intro/I-PP.*     per attract intro and model pair in its archive: the mesh, skeleton, atlas and
 *                    model file, as a fighter's
 *   stages/NN.*      per stage: its scenery (.stg) and atlas (.png), its ground's cells (.gnd),
 *                    and the ground map itself (.map), which the fight reads; Tekken Force's
 *                    stages (15 to 18) and Tekken Ball's beach (19) with no scenery
 *   arcade/stages/NN.* with the arcade board's data (`npm run arcade`, optional), per stage the
 *                    arcade has: its scenery (.stg) and atlas (.png), drawn in place of the disc's,
 *                    and the panorama behind it (.sky.png) where it has one, and its moving
 *                    pieces from the board's program (NN-K.stg and .png)
 *   bns/NNN.bin      every file of TEKKEN3.BNS as it is, which the game's own loader reads by
 *                    logical id (the overlays, the menus' textures), their count in the manifest
 *   music/NN.xa      each XA song's own sectors (scripts/lib/xa.mjs)
 *   music/trackNN.pcm each audio track's samples that is not silent, every track's length in the
 *                    manifest (by the cue sheet `npm run disc` keeps)
 *   movies/NN.mp4    each movie file of TEKKEN3.XAS made a web video by ffmpeg (scripts/lib/str.mjs),
 *                    when ffmpeg is there; one made before at the same conversion is kept
 *   movies/streams.json each movie file's stream as the drive reads it (its sectors, frames a
 *                    second, and the sector each frame's data ends on), which times its frames
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { arcMembers } from './lib/bns.mjs';
import { parseChrtk4, parseUploads } from './lib/t4/chrtk4.mjs';
import { exportKazuya, skeletonOf, withOffsets } from './lib/t4/kazuya.mjs';
import { buildKazuyaMoveset } from './lib/t4/kazuya-moves.mjs';
import { kazuyaName, withName } from './lib/t4/kazuya-name.mjs';
import { kazuyaArt } from './lib/t4/kazuya-select.mjs';
import { kazuyaVoice } from './lib/t4/kazuya-voice.mjs';
import { parseBank } from './lib/t4/motion.mjs';
import { readMoveset } from './lib/t4/moveset.mjs';
import { exportFighter, partTable } from './lib/fighter.mjs';
import { parseModel } from './lib/model.mjs';
import { exportStage } from './lib/stage.mjs';
import { ACCESSORY_TABLES, archiveAt, BACKGROUND_RULES, BACKGROUND_TABLES, PROGRAM_CODE, PROGRAM_STAGES, STAGE_ARCHIVES, STAGE_LEFT_OUT, STAGE_OBJECTS } from './lib/arcade/board.mjs';
import { exportArcadeBackground, exportArcadeObject, exportArcadeStage } from './lib/arcade/stage.mjs';
import { arcadeFighters, boardAccessories, exportArcadeFighter } from './lib/arcade/fighter.mjs';
import { decompress } from './lib/lz.mjs';
import { readTimChain } from './lib/texture.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { openDisc } from './lib/iso.mjs';
import { readXaSongs, xaSongTable } from './lib/xa.mjs';
import { audioTracks, parseCue } from './lib/cue.mjs';
import { convertMovie, haveFfmpeg, movieTables, rawSectors, streamOf } from './lib/str.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bns = path.join(root, '.cache/bns');
const out = path.join(root, 'public/data');
const exePath = path.join(root, '.cache/disc/SLUS_004.02');
if (!existsSync(exePath)) throw new Error('no disc data: run npm run disc first');
/** The format of what this writes, in its manifest: raised when the output changes, so `npm run dev` extracts again. */
const DATA_FORMAT = 14;
/** The arcade board's data, when `npm run arcade` has read it. */
const arcadePath = path.join(root, '.cache/arcade/data.bin');
/* Extracted already: at this format, and with the arcade's stages exactly when its data is there. */
const extracted = (() => {
  try {
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    return manifest.format === DATA_FORMAT && existsSync(path.join(out, 'movies/streams.json')) && existsSync(arcadePath) === (manifest.arcadeStages?.length > 0);
  } catch {
    return false;
  }
})();
if (process.argv.includes('--if-missing') && extracted) process.exit(0);

const exe = readFileSync(exePath);
const at = (address) => address - 0x80010000 + 0x800;
const file = (index) => new Uint8Array(readFileSync(path.join(bns, String(index).padStart(3, '0'))));
/** `length` bytes of a file from `offset`. */
function readImage(file, offset, length) {
  const bytes = new Uint8Array(length);
  const fd = openSync(file, 'r');
  readSync(fd, bytes, 0, length, offset);
  closeSync(fd);
  return bytes;
}
/* Every file written this run; what else is under public/data afterwards is stale and removed. */
const written = new Set();
const put = (relative, bytes) => {
  const target = path.join(out, relative);
  written.add(target);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};

/* The executable's image: its header says where it loads and how long it is. */
put('exe.bin', exe.subarray(0x800, 0x800 + exe.readUInt32LE(0x1c)));

/* The motion constants, as plain arrays. */
const words = (address, count, read, size) => Array.from({ length: count }, (_, i) => read.call(exe, at(address) + i * size));
put(
  'tables.json',
  JSON.stringify({
    sine: words(0x8001e8c4, 5120, Buffer.prototype.readInt16LE, 2),
    curve: Array.from(exe.subarray(at(0x800966f8), at(0x80096c40))),
    channelShift: Array.from(exe.subarray(at(0x80096c24), at(0x80096c24) + 49)),
    fixup: words(0x80096eac, 9, Buffer.prototype.readInt16LE, 2),
    offsets: words(0x80096ecc, 24, Buffer.prototype.readInt32LE, 4),
  }),
);

/* Movesets by id; id 15 (Mokujin) is empty, as he plays another's. */
const movesets = new Map();
for (let id = 0; 280 + id <= 300; id += 1) {
  const bytes = file(280 + id);
  if (bytes.length === 0) continue;
  movesets.set(id, bytes);
  put(`moves/${String(id).padStart(2, '0')}.bin`, bytes);
}
put('moves/common.bin', file(279));

/*
 * Where a costume's closed eyes go: per pack (below 0x37) four bytes at 0x800959cc, the face's
 * place, its size, the open eyes' place and the closed eyes' (-1 for none), places from the table
 * at 0x8009579c (VRAM x and y, x 384 the slot's first page) and sizes from 0x8009586c (halfwords
 * across, lines down).
 */
function eyesOf(pack) {
  if (pack >= 0x37) return null;
  const row = [0, 1, 2, 3].map((k) => exe.readInt8(at(0x800959cc + pack * 4 + k)));
  if (row[0] < 0 || row[1] < 0 || row[3] < 0) return null;
  const place = (i) => ({ x: exe.readUInt16LE(at(0x8009579c + i * 4)) - 384, y: exe.readUInt16LE(at(0x8009579c + i * 4 + 2)) });
  return { to: place(row[0]), from: place(row[3]), w: exe.readUInt16LE(at(0x8009586c + row[1] * 4)), h: exe.readUInt16LE(at(0x8009586c + row[1] * 4 + 2)) };
}

/** True Ogre's roster id: his model's second record on the chest has its shapes past the first in his moveset. */
const TRUE_OGRE = 0x14;
const WINGS_RECORD = 2;
/** The hands' joints, whose parts have shapes. */
const HANDS = [6, 10];

/**
 * Where a pack's model keeps shapes outside itself: for True Ogre's, his moveset (by the roster
 * record's byte 9) from its header's word at 0x30 (an even roster code) or 0x34 (an odd one).
 */
function shapesFromOf(pack) {
  for (let code = TRUE_OGRE * 4; code < TRUE_OGRE * 4 + 4; code += 1) {
    if (exe.readInt8(at(0x800958c4) + code) !== pack) continue;
    const moveset = movesets.get(exe[at(exe.readUInt32LE(at(0x80097d40 + code * 4))) + 9]);
    if (moveset === undefined) throw new Error(`pack ${pack}'s moveset is not on the disc`);
    return { record: WINGS_RECORD, bytes: moveset, base: Buffer.from(moveset).readUInt32LE((code & 1) !== 0 ? 0x34 : 0x30) };
  }
  return null;
}

/** A pack's costume: the low bits of the first roster code that takes it. */
function costumeOf(pack) {
  for (let code = 0; code < 0x5c; code += 1) if (exe.readInt8(at(0x800958c4) + code) === pack) return code & 3;
  return 0;
}

/**
 * A pack's archive with its textures as one TIM chain: as it is, or where its first member is
 * itself an archive of TIMs, one a costume (the soldiers', which their four packs share), the
 * pack's costume's own.
 */
function texturesOf(pack, members) {
  const first = members[0];
  if (first === undefined || first.length < 4 || first.readUInt32LE(0) === 0x10) return members;
  const tims = arcMembers(first);
  return [tims[costumeOf(pack)] ?? tims[0], ...members.slice(1)];
}

/* Character packs: four files each from BNS 71; the model, a sound bank, the archive, a copy of a moveset. */
const fighters = [];
const skeletons = new Map();
for (let pack = 0; 71 + pack * 4 + 3 <= 278; pack += 1) {
  const first = 71 + pack * 4;
  const id = String(pack).padStart(2, '0');
  const parts = partTable(exe, pack);
  const result = exportFighter(file(first), texturesOf(pack, arcMembers(Buffer.from(file(first + 2)))), parts, parseModel, encodePng, { eyes: eyesOf(pack), shapesFrom: shapesFromOf(pack) });
  put(`fighters/${id}.ftr`, result.mesh);
  put(`fighters/${id}.json`, JSON.stringify({ skeleton: result.skeleton }));
  skeletons.set(pack, result.skeleton);
  put(`fighters/${id}.png`, result.atlas);
  put(`fighters/${id}.3dmk`, file(first));
  put(`fighters/${id}.tim`, arcMembers(Buffer.from(file(first + 2)))[0]);
  put(`fighters/${id}.spark`, arcMembers(Buffer.from(file(first + 2)))[1]);
  put(`fighters/${id}.vh`, file(first + 1));
  put(`fighters/${id}.vb`, arcMembers(Buffer.from(file(first + 2)))[2] ?? new Uint8Array(0));
  put(`fighters/${id}.cmd`, arcMembers(Buffer.from(file(first + 2)))[4] ?? new Uint8Array(0));
  const own = file(first + 3);
  const moveset = [...movesets].find(([, bytes]) => Buffer.compare(bytes, own) === 0)?.[0] ?? -1;
  fighters.push({ pack, moveset, ...result.stats });
}

/*
 * The attract intros' models: each intro's archive (logical 0x45 on, by the executable's logical
 * table at 0x80098574) holds a model and its textures for each pair its overlay's table names a pack
 * (BNS 0 at 0x800b9384, a signed byte a pack); each exported as a fighter is, with the part table of
 * the first pack naming it: `intro/I-PP.*` (the mesh, skeleton, atlas and the model file itself).
 */
{
  const attract = file(0);
  const logical = (n) => exe.readUInt16LE(at(0x80098574 + n * 2));
  for (let intro = 0; intro < 3; intro += 1) {
    const members = arcMembers(Buffer.from(file(logical(0x45 + intro))));
    const packOf = new Map();
    for (let pack = 0; pack < 0x2d; pack += 1) {
      const pair = (attract[0x800b9384 - 0x800b8d58 + intro * 0x2d + pack] << 24) >> 24;
      if (pair >= 0 && !packOf.has(pair)) packOf.set(pair, pack);
    }
    for (const [pair, pack] of packOf) {
      const name = `intro/${intro}-${String(pair).padStart(2, '0')}`;
      const model = new Uint8Array(members[pair * 2]);
      const result = exportFighter(model, [members[pair * 2 + 1]], partTable(exe, pack), parseModel, encodePng);
      put(`${name}.ftr`, result.mesh);
      put(`${name}.json`, JSON.stringify({ skeleton: result.skeleton }));
      put(`${name}.png`, result.atlas);
      put(`${name}.3dmk`, model);
    }
  }
}

/*
 * Kazuya (src/mod/kazuya), when Tekken 4's files are unpacked (npm run t4): his mesh, skeleton and
 * atlas from his Tekken 4 model, as pack 52 on Heihachi's model file (his own joint offsets in it),
 * textures and sparks, his Tekken 4 moves as moveset 15 (scripts/lib/t4/kazuya-moves.mjs), and his
 * select and versus pictures from Tekken 4's (scripts/lib/t4/kazuya-select.mjs).
 */
const t4Files = path.join(root, '.cache/t4/files');
/** His fight name's width in pixels, as the roster's name record gives it. */
const KAZUYA_NAME_WIDTH = 52;
const kazuya = existsSync(path.join(t4Files, '0658.bin'));
if (kazuya) {
  const container = new Uint8Array(readFileSync(path.join(t4Files, '0658.bin')));
  const containerView = new DataView(container.buffer);
  const part = (k) => container.subarray(containerView.getUint32(4 + k * 8, true), containerView.getUint32(4 + k * 8, true) + containerView.getUint32(8 + k * 8, true));
  const tables = {
    sine: Int16Array.from(words(0x8001e8c4, 5120, Buffer.prototype.readInt16LE, 2)),
    fixup: Int16Array.from(words(0x80096eac, 9, Buffer.prototype.readInt16LE, 2)),
    offsets: Int32Array.from(words(0x80096ecc, 24, Buffer.prototype.readInt32LE, 4)),
  };
  const model = parseChrtk4(part(3));
  const result = exportKazuya(model, parseUploads(part(0)), tables, encodePng);
  const heihachi = 26;
  const first = 71 + heihachi * 4;
  put('fighters/52.ftr', result.mesh);
  put('fighters/52.json', JSON.stringify({ skeleton: result.skeleton }));
  put('fighters/52.png', result.atlas);
  put('fighters/52.3dmk', withOffsets(file(first), partTable(exe, heihachi), result.skeleton));
  /* Heihachi's textures (his model's go unused: Kazuya's mesh carries its own), his name picture made KAZUYA. */
  const chain = (pack) => new Uint8Array(arcMembers(Buffer.from(file(71 + pack * 4 + 2)))[0]);
  const name = kazuyaName(chain(22), chain(8));
  if (name.width !== KAZUYA_NAME_WIDTH) throw new Error(`KAZUYA's name is ${name.width} pixels, the game expects ${KAZUYA_NAME_WIDTH}`);
  put('fighters/52.tim', withName(chain(heihachi), name));
  put('fighters/52.spark', arcMembers(Buffer.from(file(first + 2)))[1]);
  put('fighters/52.cmd', arcMembers(Buffer.from(file(first + 2)))[4]);
  const t4File = (n) => new Uint8Array(readFileSync(path.join(t4Files, `${n}.bin`)));
  /* His voice: Tekken 4's lines and samples as a Tekken 3 bank and voice record (scripts/lib/t4/kazuya-voice.mjs). */
  const voice = kazuyaVoice({ t4Exe: new Uint8Array(readFileSync(path.join(root, '.cache/t4/SLUS_203.28'))), bank: t4File('0660'), heihachiVh: file(first + 1) });
  put('fighters/52.vh', voice.vh);
  put('fighters/52.vb', voice.vb);
  put('fighters/52.voice', voice.voice);
  const motions = t4File('0657');
  const motionsView = new DataView(motions.buffer, motions.byteOffset);
  const ownBank = parseBank(motions.subarray(motionsView.getUint32(4, true), motionsView.getUint32(4, true) + motionsView.getUint32(8, true)));
  /* His select and versus pictures: Tekken 4's render of him when it is there (kept with the disc data, never committed), else its select picture. */
  const renderPath = path.join(root, '.cache/art/kazuya-portrait.png');
  put(
    'fighters/52.art',
    kazuyaArt({
      render: existsSync(renderPath) ? decodePng(readFileSync(renderPath)) : undefined,
      portraits: t4File('0118'),
      name,
    }),
  );
  const moves = buildKazuyaMoveset({
    heihachiBytes: movesets.get(13),
    commonBytes: file(279),
    movesets: [...movesets.values()],
    exe: new Uint8Array(exe.subarray(0x800, 0x800 + exe.readUInt32LE(0x1c))),
    t4: readMoveset(t4File('0656')),
    ownBank,
    commonBank: parseBank(t4File('0019')),
    nodes: model.nodes,
    tables: { ...tables, curve: Uint8Array.from(exe.subarray(at(0x800966f8), at(0x80096c40))), channelShift: Uint8Array.from(exe.subarray(at(0x80096c24), at(0x80096c24) + 49)) },
    skeleton: skeletonOf(model.nodes),
  });
  put('moves/15.bin', moves.bytes);
  fighters.push({ pack: 52, moveset: 15, ...result.stats });
}

/* The boot's texture archive: a count, then an offset and size per member, the last one ending it. */
const title = file(10);
const TEXTURES = 0x1330;
const view = new DataView(title.buffer, title.byteOffset + TEXTURES);
const members = view.getUint32(0, true);
put('textures.arc', title.subarray(TEXTURES, TEXTURES + view.getUint32(4 + (members - 1) * 8, true) + view.getUint32(8 + (members - 1) * 8, true)));

/* Stages: textures from BNS 36 + s, models from BNS 56 + s, the fifteen with models. */
const stages = [];
for (let s = 0; s < 15; s += 1) {
  const id = String(s).padStart(2, '0');
  const result = exportStage(file(56 + s), arcMembers(Buffer.from(file(36 + s))), encodePng);
  put(`stages/${id}.stg`, result.mesh);
  put(`stages/${id}.gnd`, result.ground);
  put(`stages/${id}.map`, result.map);
  put(`stages/${id}.png`, result.atlas);
  stages.push({ stage: s, height: exe.readInt16LE(at(0x80025138) + s * 4), ...result.stats });
}
/* Tekken Force's four stages (15 to 18) and Tekken Ball's beach (19): no model, their textures an archive of TIMs in the first member. */
for (let s = 15; s < 20; s += 1) {
  const members = arcMembers(Buffer.from(file(36 + s)));
  const result = exportStage(null, members, encodePng, arcMembers(members[0]).flatMap((tim) => readTimChain(tim)));
  put(`stages/${s}.stg`, result.mesh);
  put(`stages/${s}.gnd`, result.ground);
  put(`stages/${s}.map`, result.map);
  put(`stages/${s}.png`, result.atlas);
  stages.push({ stage: s, height: exe.readInt16LE(at(0x80025138) + s * 4), ...result.stats });
}

/*
 * The arcade's stages, from the board's data, when it is there: drawn in place of the disc's, with
 * their backgrounds; and its fighters, each pack the board has a model of drawn with it (True
 * Ogre's, whose wings his moveset shapes, stays the disc's).
 */
const arcadeFighterPacks = [];
const arcadeStages = [];
const arcadePanoramas = [];
const arcadeObjects = [];
if (existsSync(arcadePath)) {
  const data = new Uint8Array(readFileSync(arcadePath));
  const program = new Uint8Array(readFileSync(path.join(root, '.cache/arcade/program.bin')));
  const code = decompress(program, PROGRAM_CODE.at);
  const archives = [...[...STAGE_ARCHIVES].map(([s, at]) => [s, archiveAt(data, at)]), ...[...PROGRAM_STAGES].map(([s, at]) => [s, archiveAt(program, at)])].sort(([a], [b]) => a - b);
  archives.forEach(([s, archive]) => {
    const id = String(s).padStart(2, '0');
    const pieces = STAGE_OBJECTS.get(s) ?? [];
    const result = exportArcadeStage(archive, encodePng, pieces.filter((p) => p.flipbook !== undefined).map((p) => p.flipbook), program, STAGE_LEFT_OUT.get(s) ?? []);
    put(`arcade/stages/${id}.stg`, result.mesh);
    put(`arcade/stages/${id}.png`, result.atlas);
    arcadeStages.push(s);
    let book = 0;
    pieces.forEach((object, k) => {
      const piece = object.flipbook !== undefined ? result.books[book++] : exportArcadeObject(program, object, encodePng);
      if (piece.stats.polygons === 0) throw new Error(`stage ${s}: its ${object.name} has no polygons`);
      put(`arcade/stages/${id}-${k}.stg`, piece.mesh);
      put(`arcade/stages/${id}-${k}.png`, piece.atlas);
      const frames = object.flipbook !== undefined ? readTimChain(program.subarray(...object.flipbook)).length : 1;
      arcadeObjects.push({
        stage: s,
        piece: k,
        at: object.at ?? [0, 0, 0],
        angles: object.angles ?? [0, 0, 0],
        spin: object.spin ?? 0,
        wrap: object.wrap ?? 0,
        sway: object.sway ?? [],
        parts: (object.parts ?? [{}]).map((part) => ({ at: part.at ?? [0, 0, 0], angles: part.angles ?? [0, 0, 0], spin: part.spin ?? { axis: 1, rate: 0 } })),
        frames,
        fields: object.fields ?? 1,
      });
    });
    if (!(s < BACKGROUND_TABLES.stages)) return;
    const { atlas, ...background } = exportArcadeBackground(code, s, archive, encodePng);
    put(`arcade/stages/${id}.sky.png`, atlas);
    arcadePanoramas.push({ stage: s, ...background, ...(BACKGROUND_RULES.get(s) ?? {}) });
  });
  arcadeFighters(data).forEach((board, pack) => {
    if (shapesFromOf(pack) !== null) return;
    const id = String(pack).padStart(2, '0');
    const first = 71 + pack * 4;
    const parts = partTable(exe, pack);
    const disc = { model: parseModel(file(first)), parts };
    const hands = new Map(parts.filter((p) => p.joint === HANDS[0] || p.joint === HANDS[1]).map((p) => [p.joint, p.index]));
    let result;
    try {
      result = exportArcadeFighter(board, boardAccessories(code, PROGRAM_CODE.base, ACCESSORY_TABLES, pack), disc, hands, encodePng);
    } catch (error) {
      console.warn(`the board's fighter ${id} is left out (the disc's is drawn): ${error.message}`);
      return;
    }
    put(`arcade/fighters/${id}.ftr`, result.mesh);
    put(`arcade/fighters/${id}.png`, result.atlas);
    put(`arcade/fighters/${id}.json`, JSON.stringify({ skeleton: skeletons.get(pack) }));
    arcadeFighterPacks.push(pack);
  });
}

/* Every BNS file as it is, for the game's own loader. */
let files = 0;
for (; existsSync(path.join(bns, String(files).padStart(3, '0'))); files += 1) put(`bns/${String(files).padStart(3, '0')}.bin`, file(files));

/* The music: each song's own XA sectors from TEKKEN3.XAS (scripts/lib/xa.mjs). */
const image = path.join(root, '.cache/disc/tekken3.bin');
const xas = openDisc(image).list().find((e) => e.path === '/TEKKEN3/TEKKEN3.XAS');
if (!xas) throw new Error('no TEKKEN3.XAS on the disc');
const songs = readXaSongs(image, xas.lba, xaSongTable(exe.subarray(0x800), 0x80010000));
songs.forEach((bytes, i) => put(`music/${String(i).padStart(2, '0')}.xa`, bytes));

/*
 * The disc's audio tracks, by the cue sheet: each one's length in sectors (588 stereo samples each),
 * and the samples of each that is not silent (16-bit, left and right interleaved, 44100 Hz).
 */
const tracks = [];
const cuePath = path.join(root, '.cache/disc/tekken3.cue');
if (existsSync(cuePath)) {
  const imageSectors = statSync(image).size / 2352;
  for (const { number, start, end } of audioTracks(parseCue(readFileSync(cuePath, 'latin1')), imageSectors)) {
    const pcm = readImage(image, start * 2352, (end - start) * 2352);
    const silent = pcm.every((b) => b === 0);
    if (!silent) put(`music/track${String(number).padStart(2, '0')}.pcm`, pcm);
    tracks.push({ track: number, sectors: end - start, silent });
  }
} else console.log('no .cache/disc/tekken3.cue (npm run disc keeps it): no audio tracks');

/*
 * The movies: each STR file of TEKKEN3.XAS made a web video by ffmpeg. Converting them all takes
 * minutes, so a movie made before at this conversion's version is kept (each is written under
 * another name and renamed once whole, and the version noted once all are). Without ffmpeg there
 * are none, and the game shows black for a movie's length.
 */
const MOVIE_VERSION = 1;
const movieFiles = movieTables(Buffer.from(file(10)), Buffer.from(file(301))).files;
const movieRaw = (i) => rawSectors(image, xas.lba + movieFiles[i].first, movieFiles[i].last - movieFiles[i].first + 1);
put(
  'movies/streams.json',
  JSON.stringify(
    movieFiles.map((_, i) => {
      if (i === 0) return null;
      const { ends, rate } = streamOf(movieRaw(i));
      return { sectors: movieFiles[i].last - movieFiles[i].first + 1, rate, ends };
    }),
  ),
);
const movieVersion = path.join(out, 'movies/version.json');
const keep = existsSync(movieVersion) && JSON.parse(readFileSync(movieVersion, 'utf8')).version === MOVIE_VERSION;
let movies = 0;
if (haveFfmpeg()) {
  mkdirSync(path.join(out, 'movies'), { recursive: true });
  for (let i = 1; i < movieFiles.length; i += 1) {
    const target = path.join(out, `movies/${String(i).padStart(2, '0')}.mp4`);
    written.add(target);
    movies += 1;
    if (keep && existsSync(target)) continue;
    const raw = movieRaw(i);
    console.log(`movie ${i} of ${movieFiles.length - 1}`);
    convertMovie(raw, streamOf(raw).rate, `${target}.part`);
    renameSync(`${target}.part`, target);
  }
  put('movies/version.json', JSON.stringify({ version: MOVIE_VERSION }));
} else console.log('no ffmpeg: no movies (the game shows black for their length)');

put('manifest.json', JSON.stringify({ format: DATA_FORMAT, fighters, stages, arcadeStages, arcadePanoramas, arcadeObjects, arcadeFighters: arcadeFighterPacks, files, kazuya, kazuyaVoice: kazuya, songs: songs.length, tracks, movies }, null, 2));

/*
 * Files are overwritten in place, never the directory removed and made again: a running dev server
 * keeps its list of public files from its watcher, and a directory taken away and put back while it
 * runs can leave it serving the page in place of every file.
 */
for (const entry of readdirSync(out, { recursive: true, withFileTypes: true })) {
  const full = path.join(entry.parentPath, entry.name);
  if (entry.isFile() && !written.has(full)) rmSync(full);
}
console.log(`${fighters.length} fighters; ${fighters.reduce((n, f) => n + f.triangles, 0)} triangles in all; ${stages.length} stages${arcadeStages.length > 0 ? `, ${arcadeStages.length} of them the arcade's` : ''}`);
