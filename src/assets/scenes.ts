/**
 * The scenes' tables (`tables/scenes.json`), validated: the values the game's state starts with,
 * the title's lines and the mode menu's entries.
 */
import type { CreditsTables, IntroTables, MovieRecord, MovieStream, MovieTables, NameTables, OgreChangeTables, RecordsTables, SceneTables, SelectTables, StartLine, SurvivalRecord, TimeRecord, VersusPlace, VersusTables, VsSelectQuad, VsSelectTables } from '../sim/data/scenes.ts';
import { AssetError, expectArray, expectBoolean, expectInt, expectObject, expectString } from './validate.ts';

const int = (value: unknown, where: string): number => expectInt(value, where, -0x80000000, 0xffffffff);
const pairs = (value: unknown, where: string): [number, number][] =>
  expectArray(value, where, 8).map((pair, i) => {
    const [a, b] = expectArray(pair, `${where}[${i}]`, 2).map((v, k) => expectInt(v, `${where}[${i}][${k}]`, 0, 0xff));
    return [a!, b!];
  });
const lines = (value: unknown, where: string): StartLine[] =>
  expectArray(value, where).map((v, i) => {
    const line = expectObject(v, `${where}[${i}]`);
    return { text: expectString(line.text, `${where}[${i}].text`), half: expectInt(line.half, `${where}[${i}].half`, 0, 0xffff) };
  });

function parseSelect(json: unknown, where: string): SelectTables {
  const o = expectObject(json, where);
  const record = <K extends string>(value: unknown, at: string, keys: readonly K[]): Record<K, number> => {
    const r = expectObject(value, at);
    return Object.fromEntries(keys.map((k) => [k, int(r[k], `${at}.${k}`)])) as Record<K, number>;
  };
  return {
    grid: expectArray(o.grid, `${where}.grid`, 22).map((v, i) => expectInt(v, `${where}.grid[${i}]`, 0, 0xff)),
    sides: expectArray(o.sides, `${where}.sides`, 2).map((v, i) => record(v, `${where}.sides[${i}]`, ['portraitX', 'nameCentre', 'mirror', 'firstCell', 'cursorOffset'] as const)),
    kinds: pairs(o.kinds, `${where}.kinds`),
    apart: pairs(o.apart, `${where}.apart`),
    layouts: expectArray(o.layouts, `${where}.layouts`, 2).map((v, i) => record(v, `${where}.layouts[${i}]`, ['portraitTop', 'nameY', 'bandY', 'gridDown', 'cursorHeight', 'cursorTop', 'tagY', 'timerY', 'coinColour'] as const)),
    looks: expectArray(o.looks, `${where}.looks`).map((v, i) => expectInt(v, `${where}.looks[${i}]`, 0, 0xffffffff)),
    wall: expectArray(o.wall, `${where}.wall`, 8).map((row, r) => expectArray(row, `${where}.wall[${r}]`, 8).map((v, k) => expectInt(v, `${where}.wall[${r}][${k}]`, 0, 8))),
    coinLines: lines(o.coinLines, `${where}.coinLines`),
    creditLines: lines(o.creditLines, `${where}.creditLines`),
    added: expectArray(o.added, `${where}.added`).map((v, i) => record(v, `${where}.added[${i}]`, ['roster', 'cell', 'look', 'firstOpponent'] as const)),
  };
}

function parseVersus(json: unknown, where: string): VersusTables {
  const o = expectObject(json, where);
  const place = (value: unknown, at: string): VersusPlace => {
    const p = expectObject(value, at);
    const word = (key: string): number => expectInt(p[key], `${at}.${key}`, -0x8000, 0x7fff);
    return { x: word('x'), y: word('y'), slideX: word('slideX'), slideY: word('slideY') };
  };
  return {
    portraits: expectArray(o.portraits, `${where}.portraits`, 2).map((v, i) => place(v, `${where}.portraits[${i}]`)),
    names: expectArray(o.names, `${where}.names`, 2).map((v, i) => place(v, `${where}.names[${i}]`)),
    versus: expectString(o.versus, `${where}.versus`),
    stage: expectString(o.stage, `${where}.stage`),
    fight: expectString(o.fight, `${where}.fight`),
    demoStage: expectString(o.demoStage, `${where}.demoStage`),
    bands: expectArray(o.bands, `${where}.bands`, 2).map((v, i) => {
      const band = expectObject(v, `${where}.bands[${i}]`);
      return { colour: expectInt(band.colour, `${where}.bands[${i}].colour`, 0, 0xffffff), width: expectInt(band.width, `${where}.bands[${i}].width`, 0, 0xffff) };
    }),
    backgrounds: expectArray(o.backgrounds, `${where}.backgrounds`, 2).map((v, i) => expectInt(v, `${where}.backgrounds[${i}]`, 0, 0xffff)),
  };
}

function parseVsSelect(json: unknown, where: string): VsSelectTables {
  const o = expectObject(json, where);
  const half = (value: unknown, at: string): number => expectInt(value, at, -0x8000, 0x7fff);
  const point = (value: unknown, at: string): { x: number; y: number } => {
    const p = expectObject(value, at);
    return { x: half(p.x, `${at}.x`), y: half(p.y, `${at}.y`) };
  };
  const bytes = (value: unknown, at: string, length: number): number[] => expectArray(value, at, length).map((v, i) => expectInt(v, `${at}[${i}]`, 0, 0xff));
  const text = (value: unknown, at: string): string => expectString(value, at);
  const quads = (value: unknown, at: string, count: number): VsSelectQuad[] =>
    expectArray(value, at, count).map((v, q) => {
      const quad = expectObject(v, `${at}[${q}]`);
      return {
        corners: expectArray(quad.corners, `${at}[${q}].corners`, 4).map((c, k) => point(c, `${at}[${q}].corners[${k}]`)),
        colours: expectArray(quad.colours, `${at}[${q}].colours`, 4).map((c, k) => expectInt(c, `${at}[${q}].colours[${k}]`, 0, 0xffffffff)),
      };
    });
  return {
    grid: expectArray(o.grid, `${where}.grid`, 21).map((v, i) => {
      const cell = expectObject(v, `${where}.grid[${i}]`);
      return { x: half(cell.x, `${where}.grid[${i}].x`), y: half(cell.y, `${where}.grid[${i}].y`), code: expectInt(cell.code, `${where}.grid[${i}].code`, 0, 0x57) };
    }),
    kinds: expectArray(o.kinds, `${where}.kinds`, 16).map((v, i) => bytes(v, `${where}.kinds[${i}]`, 3) as [number, number, number]),
    apart: expectArray(o.apart, `${where}.apart`, 16).map((v, i) => bytes(v, `${where}.apart[${i}]`, 2) as [number, number]),
    sides: expectArray(o.sides, `${where}.sides`, 2).map((v, n) => {
      const at = `${where}.sides[${n}]`;
      const side = expectObject(v, at);
      const gauge = expectObject(side.gauge, `${at}.gauge`);
      const tags = expectArray(side.tags, `${at}.tags`, 2).map((t, k) => half(t, `${at}.tags[${k}]`));
      const slots = expectArray(side.slots, `${at}.slots`, 3).map((s, k) => point(s, `${at}.slots[${k}]`));
      return {
        cursor: expectInt(side.cursor, `${at}.cursor`, 0, 0xff),
        firstCode: expectInt(side.firstCode, `${at}.firstCode`, 0, 0x57),
        tags: [tags[0]!, tags[1]!],
        name: point(side.name, `${at}.name`),
        slots: [slots[0]!, slots[1]!, slots[2]!],
        gauge: {
          mirrored: expectInt(gauge.mirrored, `${at}.gauge.mirrored`, 0, 1),
          raised: half(gauge.raised, `${at}.gauge.raised`),
          x: half(gauge.x, `${at}.gauge.x`),
          y: half(gauge.y, `${at}.gauge.y`),
          life: point(gauge.life, `${at}.gauge.life`),
          percent: point(gauge.percent, `${at}.gauge.percent`),
        },
      };
    }),
    titles: expectArray(o.titles, `${where}.titles`, 9).map((v, i) => text(v, `${where}.titles[${i}]`)),
    hint: text(o.hint, `${where}.hint`),
    tournament: text(o.tournament, `${where}.tournament`),
    modeColours: expectArray(o.modeColours, `${where}.modeColours`, 9).map((v, i) => {
      const [a, b] = expectArray(v, `${where}.modeColours[${i}]`, 2).map((c, k) => expectInt(c, `${where}.modeColours[${i}][${k}]`, 0, 0xffffff));
      return [a!, b!] as const;
    }),
    opaque: quads(o.opaque, `${where}.opaque`, 4),
    added: quads(o.added, `${where}.added`, 2),
    winColours: bytes(o.winColours, `${where}.winColours`, 4),
    drawColours: bytes(o.drawColours, `${where}.drawColours`, 4),
    segments: bytes(o.segments, `${where}.segments`, 8),
    life: text(o.life, `${where}.life`),
    percents: expectArray(o.percents, `${where}.percents`, 8).map((v, i) => text(v, `${where}.percents[${i}]`)),
  };
}

function parseRecords(json: unknown, where: string): RecordsTables {
  const o = expectObject(json, where);
  const c = expectObject(o.colours, `${where}.colours`);
  const rows = (value: unknown, at: string, size: number): number[][] =>
    expectArray(value, at, 2).map((row, k) => expectArray(row, `${at}[${k}]`, size).map((v, i) => expectInt(v, `${at}[${k}][${i}]`, 0, 0xff)));
  return {
    skipped: expectArray(o.skipped, `${where}.skipped`, 4).map((v, i) => expectInt(v, `${where}.skipped[${i}]`, 0, 0x7fffffff)),
    suffixes: expectArray(o.suffixes, `${where}.suffixes`, 4).map((v, i) => expectString(v, `${where}.suffixes[${i}]`)),
    colours: { times: rows(c.times, `${where}.colours.times`, 5), survivors: rows(c.survivors, `${where}.colours.survivors`, 4), plays: rows(c.plays, `${where}.colours.plays`, 3) },
    bars: expectArray(o.bars, `${where}.bars`, 22).map((row, r) => expectArray(row, `${where}.bars[${r}]`, 5).map((v, k) => expectInt(v, `${where}.bars[${r}][${k}]`, 0, 0xffffffff))),
    naming: parseNaming(o.naming, `${where}.naming`),
  };
}

function parseNaming(json: unknown, where: string): NameTables {
  const o = expectObject(json, where);
  const name = (value: unknown, at: string): string => {
    const text = expectString(value, at);
    if (3 < text.length) throw new Error(`${at} is longer than three letters: ${text}`);
    return text;
  };
  const letters = expectString(o.letters, `${where}.letters`);
  if (letters.length !== 40) throw new Error(`${where}.letters has ${letters.length} letters, not 40`);
  const blank = name(o.blank, `${where}.blank`);
  if (blank.length !== 3) throw new Error(`${where}.blank is not three letters: ${blank}`);
  return {
    letters,
    blank,
    refused: expectArray(o.refused, `${where}.refused`, 5).map((v, i) => name(v, `${where}.refused[${i}]`)),
    secret: name(o.secret, `${where}.secret`),
    fresh: name(o.fresh, `${where}.fresh`),
  };
}

/** A script of events, five halfwords each: its frame, what, and three arguments. */
function parseScript(json: unknown, where: string): (readonly [number, number, number, number, number])[] {
  const halfword = (v: unknown, at: string): number => expectInt(v, at, -0x8000, 0x7fff);
  return expectArray(json, where).map((event, k) => {
    const [frame, kind, a, b, c] = expectArray(event, `${where}[${k}]`, 5).map((v, j) => halfword(v, `${where}[${k}][${j}]`));
    return [frame!, kind!, a!, b!, c!] as const;
  });
}

/** Ogre's change's scripts, one by the human's side, each ending in its end (-1). */
function parseOgreChange(json: unknown, where: string): OgreChangeTables {
  const o = expectObject(json, where);
  const scripts = expectArray(o.scripts, `${where}.scripts`, 2).map((script, side) => {
    const events = parseScript(script, `${where}.scripts[${side}]`);
    if (events.findIndex((event) => event[1] === -1) !== events.length - 1) throw new AssetError(`${where}.scripts[${side}]`, 'does not end at its one end');
    return events;
  });
  return { scripts };
}

function parseIntro(json: unknown, where: string): IntroTables {
  const o = expectObject(json, where);
  return {
    script: parseScript(o.script, `${where}.script`),
    pairs: expectArray(o.pairs, `${where}.pairs`, 0x2d).map((v, i) => expectInt(v, `${where}.pairs[${i}]`, -0x80, 0x7f)),
    shadows: expectInt(o.shadows, `${where}.shadows`, 0, 0xff),
  };
}

const parseTime = (json: unknown, where: string): TimeRecord => {
  const o = expectObject(json, where);
  return { frames: expectInt(o.frames, `${where}.frames`, 0, 0xffffffff), initials: expectString(o.initials, `${where}.initials`) };
};

const parseSurvivor = (json: unknown, where: string): SurvivalRecord => {
  const o = expectObject(json, where);
  return { roster: expectInt(o.roster, `${where}.roster`, 0, 0xffff), wins: expectInt(o.wins, `${where}.wins`, 0, 0xffff), initials: expectString(o.initials, `${where}.initials`) };
};

export function parseSceneTables(json: unknown, where = 'tables/scenes.json'): SceneTables {
  const o = expectObject(json, where);
  const p = expectObject(o.powerOn, `${where}.powerOn`);
  const byte = (key: string): number => expectInt(p[key], `${where}.powerOn.${key}`, 0, 0xff);
  const bytes = (value: unknown, at: string, length: number): number[] => expectArray(value, at, length).map((v, i) => expectInt(v, `${at}[${i}]`, 0, 0xff));
  const words = (value: unknown, at: string, length: number): number[] => expectArray(value, at, length).map((v, i) => expectInt(v, `${at}[${i}]`, 0, 0xffff));
  const o2 = expectObject(p.options, `${where}.powerOn.options`);
  const option = (key: string): number => expectInt(o2[key], `${where}.powerOn.options.${key}`, 0, 0xff);
  const copyright = expectArray(o.copyright, `${where}.copyright`).map((line, i) => expectString(line, `${where}.copyright[${i}]`));
  if (copyright.length !== 2) throw new Error(`${where}.copyright has ${copyright.length} lines, not 2`);
  return {
    powerOn: {
      next: byte('next'),
      last: byte('last'),
      attractOverlay: byte('attractOverlay'),
      lastAttractOverlay: byte('lastAttractOverlay'),
      attractStep: byte('attractStep'),
      intro: byte('intro'),
      intros: byte('intros'),
      options: {
        difficulty: option('difficulty'),
        rounds: option('rounds'),
        roundTime: option('roundTime'),
        alwaysChip: option('alwaysChip'),
        continueChooses: option('continueChooses'),
        otherTitle: option('otherTitle'),
        vibration: bytes(o2.vibration, `${where}.powerOn.options.vibration`, 2),
        lastChoices: bytes(o2.lastChoices, `${where}.powerOn.options.lastChoices`, 2),
        keepChoices: option('keepChoices'),
        modeSetting: option('modeSetting'),
      },
      keys: expectArray(p.keys, `${where}.powerOn.keys`, 2).map((pad, i) => bytes(pad, `${where}.powerOn.keys[${i}]`, 8)),
      ball: byte('ball'),
      theater: byte('theater'),
      picked: byte('picked'),
      toOptions: byte('toOptions'),
      earnedRoster: expectInt(p.earnedRoster, `${where}.powerOn.earnedRoster`, 0, 0xffffffff),
      extraCostumes: expectInt(p.extraCostumes, `${where}.powerOn.extraCostumes`, 0, 0xffffffff),
      versusPortraits: bytes(p.versusPortraits, `${where}.powerOn.versusPortraits`, 2),
      versusBackground: expectInt(p.versusBackground, `${where}.powerOn.versusBackground`, -0x8000, 0x7fff),
      extraDrawn: byte('extraDrawn'),
      plays: expectArray(p.plays, `${where}.powerOn.plays`, 22).map((row, r) => words(row, `${where}.powerOn.plays[${r}]`, 4)),
      endings: expectArray(p.endings, `${where}.powerOn.endings`, 2).map((v, i) => expectInt(v, `${where}.powerOn.endings[${i}]`, 0, 0xffffffff)),
      newest: byte('newest'),
      playsSince: expectInt(p.playsSince, `${where}.powerOn.playsSince`, 0, 0xffff),
      scheduleStep: byte('scheduleStep'),
      scheduleStarted: byte('scheduleStarted'),
      times: expectArray(p.times, `${where}.powerOn.times`, 22).map((v, i) => parseTime(v, `${where}.powerOn.times[${i}]`)),
      timeSet: expectInt(p.timeSet, `${where}.powerOn.timeSet`, -1, 21),
      survivors: expectArray(p.survivors, `${where}.powerOn.survivors`, 10).map((v, i) => parseSurvivor(v, `${where}.powerOn.survivors[${i}]`)),
      survivorSet: expectInt(p.survivorSet, `${where}.powerOn.survivorSet`, -1, 9),
      list: byte('list'),
      stageTurn: byte('stageTurn'),
      naming: byte('naming'),
      holder: (() => {
        const h = expectObject(p.holder, `${where}.powerOn.holder`);
        return { side: expectInt(h.side, `${where}.powerOn.holder.side`, 0, 0xff), roster: expectInt(h.roster, `${where}.powerOn.holder.roster`, 0, 0xff) };
      })(),
      demoTurn: byte('demoTurn'),
    },
    copyright: [copyright[0]!, copyright[1]!],
    startLines: expectArray(o.startLines, `${where}.startLines`).map((value, i) => {
      const line = expectObject(value, `${where}.startLines[${i}]`);
      return { text: expectString(line.text, `${where}.startLines[${i}].text`), half: expectInt(line.half, `${where}.startLines[${i}].half`, 0, 0xffff) };
    }),
    menu: expectArray(o.menu, `${where}.menu`).map((value, i) => {
      const entry = expectObject(value, `${where}.menu[${i}]`);
      const at = `${where}.menu[${i}]`;
      return { name: expectString(entry.name, `${at}.name`), mode: expectInt(entry.mode, `${at}.mode`, 0, 0xff), twoPads: expectBoolean(entry.twoPads, `${at}.twoPads`), colour: expectInt(entry.colour, `${at}.colour`, 0, 0xff) };
    }),
    keyBits: words(o.keyBits, `${where}.keyBits`, 13),
    fixedKeys: words(o.fixedKeys, `${where}.fixedKeys`, 8),
    select: parseSelect(o.select, `${where}.select`),
    versus: parseVersus(o.versus, `${where}.versus`),
    vsSelect: parseVsSelect(o.vsSelect, `${where}.vsSelect`),
    records: parseRecords(o.records, `${where}.records`),
    demoFighters: bytes(o.demoFighters, `${where}.demoFighters`, 14),
    intros: expectArray(o.intros, `${where}.intros`, 3).map((v, i) => parseIntro(v, `${where}.intros[${i}]`)),
    ogreChange: parseOgreChange(o.ogreChange, `${where}.ogreChange`),
    schedule: expectArray(o.schedule, `${where}.schedule`, 14).map((step, i) => {
      const [kind, value] = bytes(step, `${where}.schedule[${i}]`, 2);
      return [kind!, value!] as const;
    }),
    endingSteps: expectInt(o.endingSteps, `${where}.endingSteps`, 0, 0xffffffff),
    movies: parseMovies(o.movies, `${where}.movies`),
    credits: parseCredits(o.credits, `${where}.credits`),
  };
}

function parseCredits(json: unknown, where: string): CreditsTables {
  const o = expectObject(json, where);
  const lines = (key: string): string[] => expectArray(o[key], `${where}.${key}`).map((v, i) => expectString(v, `${where}.${key}[${i}]`));
  const widths = (key: string): number[] => expectArray(o[key], `${where}.${key}`).map((v, i) => expectInt(v, `${where}.${key}[${i}]`, 0, 0xff));
  return { title: lines('title'), staff: lines('staff'), smallWidths: widths('smallWidths'), largeWidths: widths('largeWidths') };
}

function parseMovies(json: unknown, where: string): MovieTables {
  const o = expectObject(json, where);
  const files = expectArray(o.files, `${where}.files`).map((value, i): MovieStream | null => {
    if (value === null) return null;
    const f = expectObject(value, `${where}.files[${i}]`);
    const sectors = expectInt(f.sectors, `${where}.files[${i}].sectors`, 1, 0xffff);
    const ends = expectArray(f.ends, `${where}.files[${i}].ends`).map((v, k) => expectInt(v, `${where}.files[${i}].ends[${k}]`, 0, sectors - 1));
    const first = expectInt(f.first, `${where}.files[${i}].first`, 0, 0xfffffff);
    const last = expectInt(f.last, `${where}.files[${i}].last`, first, 0xfffffff);
    if (last - first + 1 !== sectors) throw new Error(`${where}.files[${i}] spans ${last - first + 1} sectors, not ${sectors}`);
    return { first, last, sectors, rate: expectInt(f.rate, `${where}.files[${i}].rate`, 1, 60), ends };
  });
  const movies = expectArray(o.movies, `${where}.movies`).map((value, i): MovieRecord => {
    const m = expectObject(value, `${where}.movies[${i}]`);
    const field = (key: string, max: number): number => expectInt(m[key], `${where}.movies[${i}].${key}`, 0, max);
    return { file: field('file', files.length - 1), width: field('width', 0xffff), height: field('height', 0xffff), frames: field('frames', 0xffff), volume: field('volume', 0xff), flags: field('flags', 0xffff) };
  });
  const endings = expectArray(o.endings, `${where}.endings`).map((row, r) => expectArray(row, `${where}.endings[${r}]`, 4).map((v, c) => expectInt(v, `${where}.endings[${r}][${c}]`, -1, movies.length - 1)));
  const cues = expectArray(o.cues, `${where}.cues`).map((v, i) => {
    const c = expectObject(v, `${where}.cues[${i}]`);
    return { frame: expectInt(c.frame, `${where}.cues[${i}].frame`, 0, 0xffff), caption: expectInt(c.caption, `${where}.cues[${i}].caption`, -1, 0x7fff) };
  });
  const captions = expectArray(o.captions, `${where}.captions`).map((v, i) => {
    const c = expectObject(v, `${where}.captions[${i}]`);
    const field = (key: string): number => expectInt(c[key], `${where}.captions[${i}].${key}`, 0, 0xffff);
    return { x: field('x'), y: field('y'), width: field('width'), height: field('height'), palette: field('palette') };
  });
  return { files, movies, titleMovies: expectInt(o.titleMovies, `${where}.titleMovies`, 1, movies.length), endings, cues, captions };
}
