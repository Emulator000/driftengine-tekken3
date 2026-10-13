/**
 * The whole game, from power-on: the logo, the title, the menus and their fights, stepped from the
 * pads and each scene drawn from the game's state. A match's movesets are fetched as soon as its
 * characters are known; the game waits for them (its fields do not move on) if they are not in by
 * the time the match is set up, and holds the versus screen until the match's drawing is ready, as
 * the console held it while it read the fight from the disc (the attract intro and the records'
 * stage likewise, before their first frame).
 */
import { loadFightTables, loadIntroModels, loadMoveset } from '../assets/load.ts';
import { bindMoveIds, bossMoveset, drawnMovesets, fightDataFor, matchMovesets, type MatchSetup } from '../sim/fight/match.ts';
import type { FightData, LoadedMoveset } from '../sim/fight/state.ts';
import { Game } from '../sim/game/game.ts';
import { Scene } from '../sim/game/state.ts';
import { FightStep, matchSetup } from '../sim/game/fight-scene.ts';
import { MenuMode, startMode } from '../sim/game/menu.ts';
import { OgreChangeShows } from '../sim/game/ogre-change.ts';
import { displayShift } from '../sim/game/options.ts';
import { applySchedule, checkSurvivalRecord, checkTimeRecord, earnMode, recordStageTime } from '../sim/game/records.ts';
import { survivorRank } from '../sim/game/arcade.ts';
import { bossCode } from '../sim/fight/force-stage.ts';
import { lookOf } from '../sim/game/select.ts';
import { progressOf, restoreProgress } from '../sim/game/save.ts';
import { FightView } from '../present/3d/fight-view.ts';
import { Hud } from '../present/hud/hud.ts';
import { PauseScreen } from '../present/hud/pause.ts';
import { loadTypefaces } from '../present/2d/typefaces.ts';
import { ScenePresenter } from '../present/scenes/scenes.ts';
import { SCREEN } from '../present/scenes/screen.ts';
import { assetImage, canvas, controllers, dataUrl, json, pageRenderer, params, play, status, two } from './page.ts';
import { controlWords } from '../present/2d/controls.ts';
import { drawingFiles, introFiles } from './quick.ts';
import { readProgress, writeProgress } from './save.ts';
import { startSound } from './sound.ts';
import { Rumble } from './rumble.ts';
import { MoviePicture } from '../present/scenes/movie.ts';

/** The frames each of the ten stages takes in the time record `?record=time` sets. */
const RECORD_STAGE_FRAMES = 30 * 60;
/** `?record=force`'s run: its score, the soldiers beaten, and its flags by default (a copper key). */
const FORCE_RECORD = { score: 1234560, kills: 42, flags: 1 } as const;
/** The page's shortcuts: a page started with one never saves the progress. */
const SHORTCUTS = ['arcade', 'versus', 'ball', 'force', 'ending', 'record', 'unlock'] as const;
/** The unlock schedule's steps, its last earning everything. */
const UNLOCK_STEPS = 14;
/** Arcade's stages; the last roster id `?arcade` takes, Kazuya's with his files. */
const ARCADE_STAGES = 10;
/** Tekken Force's stages, the final one the fifth. */
const FORCE_STAGES = 5;
const KAZUYA = 22;

export async function playGame(): Promise<void> {
  const { renderer, backend } = await pageRenderer();
  status.textContent = 'loading';
  const picture = (name: string): Promise<ImageBitmap> => assetImage(`pictures/${name}.png`);
  const names = ['title', 'namco', 'portraits', 'select-icons-big', 'select-icons-small', 'captions', 'credits-mark', 'results', 'force-results', 'options', 'options-pads', 'options-labels', 'options-arrows', 'options-buttons', 'theater-thumbs', 'theater-cover', 'theater-caption', 'theater-disc'] as const;
  const [[{ tables, arena, commands, scenes }, common, , introSet, introModels], pictures, sound] = await Promise.all([
    Promise.all([loadFightTables(json), loadMoveset(json, 'common'), loadTypefaces(), loadMoveset(json, 'intro'), loadIntroModels(json)]),
    Promise.all(names.map(picture)),
    startSound(),
  ]);
  const got = Object.fromEntries(names.map((name, i) => [name, pictures[i]!])) as Record<(typeof names)[number], ImageBitmap>;
  const { title, namco, portraits, captions, results } = got;
  const [bigIcons, smallIcons, creditsMark] = [got['select-icons-big'], got['select-icons-small'], got['credits-mark']];

  /* The movesets by id, fetched once each. */
  const movesets = new Map<number, LoadedMoveset>();
  const fetching = new Set<number>();
  const want = (id: number): LoadedMoveset | null => {
    const found = movesets.get(id);
    if (found !== undefined) return found;
    if (!fetching.has(id)) {
      fetching.add(id);
      void loadMoveset(json, two(id)).then((set) => movesets.set(id, set));
    }
    return null;
  };
  const matches = new Map<string, FightData>();
  const fightData = (setup: MatchSetup): FightData | null => {
    const [a, b] = matchMovesets(tables, setup);
    const drawn = setup.draws === undefined ? [] : drawnMovesets(tables, setup.draws);
    const boss = bossMoveset(tables, setup);
    const key = `${a} ${b} ${setup.draws ?? 0} ${setup.force === undefined ? '' : boss}`;
    const known = matches.get(key);
    if (known !== undefined) return known;
    const needed = [a, ...(b < 0 ? [] : [b]), ...drawn, ...(boss < 0 ? [] : [boss])].map(want);
    if (needed.some((set) => set === null)) return null;
    const data = fightDataFor(tables, setup, (id) => movesets.get(id)!, common);
    matches.set(key, data);
    return data;
  };

  /* Each attract intro's data: its moveset in both slots, its models by pack. */
  const intros = new Map<number, FightData>();
  const introData = (intro: number): FightData => {
    let data = intros.get(intro);
    if (data === undefined) {
      const sets = [introSet, introSet, common] as const;
      data = { ...tables, models: introModels[intro]!, sets, moveIds: bindMoveIds(sets) };
      intros.set(intro, data);
    }
    return data;
  };

  const game = new Game({ tables, scenes, fightData, introData });
  /* The pads' vibration, felt on the gamepads. */
  const rumble = new Rumble(window);
  /*
   * The progress kept on this device, as the console reads its memory card at power-on (and the
   * card's load reads it again); a page started with a shortcut reads it and never writes it. With
   * nothing kept, auto save starts on, so the progress is kept from the first play, and both pads'
   * vibration on.
   */
  const saved = readProgress();
  if (saved === null) {
    game.state.options.autoSave = 1;
    game.state.options.vibration.fill(1);
  } else {
    try {
      restoreProgress(game.state, saved);
      game.state.kept = progressOf(game.state);
    } catch (error) {
      console.warn(`[tekken3 remake] the saved progress does not fit this game: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const saves = !SHORTCUTS.some((key) => params.has(key));
  /*
   * `?unlock` earns everything the game unlocks: every character, the costumes, Tekken Ball and the
   * Theater; `?unlock=ball` earns Tekken Ball alone and `?unlock=theater` the Theater alone, as the
   * game's own unlock earns them (new on the mode menu).
   */
  const unlock = params.get('unlock');
  if (unlock === 'ball' || unlock === 'theater') earnMode(game.state, unlock);
  else if (unlock !== null) applySchedule(game.state, scenes, UNLOCK_STEPS);
  /*
   * `?arcade=ROSTER[,COSTUME[,STAGE]]` starts Arcade at once with that character on the first pad,
   * at that stage (1 to 10; by default the tenth, Ogre's), as the menu and the character select
   * leave it.
   */
  const arcade = params.get('arcade');
  if (arcade !== null) {
    const [roster = 0, costume = 0, stage = ARCADE_STAGES] = arcade.split(',').map(Number);
    const manifest = (await json('manifest.json')) as { kazuya?: boolean };
    const playable = Number.isInteger(roster) && 0 <= roster && roster <= (manifest.kazuya === true ? KAZUYA : KAZUYA - 1);
    startMode(game.state, MenuMode.ARCADE, 1);
    const { entrants, world, run } = game.state;
    entrants.roster[0] = playable ? roster : 0;
    entrants.costume[0] = Number.isInteger(costume) ? costume & 3 : 0;
    entrants.chosen[0] = 1;
    entrants.computer[0] = 0;
    world.match.stage = Number.isInteger(stage) ? Math.max(1, Math.min(ARCADE_STAGES, stage)) - 1 : ARCADE_STAGES - 1;
    game.state.modeOverlay = run.overlay;
    Object.assign(game.state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
  }
  /* `?versus` starts Versus at once, both pads in, on to its select. */
  if (params.has('versus')) startMode(game.state, MenuMode.VERSUS, 1);
  /* `?ball` starts Tekken Ball at once, the first pad in, on to its select. */
  if (params.has('ball')) startMode(game.state, MenuMode.TEKKEN_BALL, 1);
  /*
   * `?force` starts Tekken Force at once, the first pad in, on to its select;
   * `?force=ROSTER[,COSTUME[,STAGE]]` with that character chosen, at that stage (1 to 4, 5 the
   * final stage; by default the first).
   */
  const force = params.get('force');
  if (force !== null) {
    startMode(game.state, MenuMode.TEKKEN_FORCE, 1);
    if (force !== '') {
      const [roster = 0, costume = 0, stage = 1] = force.split(',').map(Number);
      const manifest = (await json('manifest.json')) as { kazuya?: boolean };
      const playable = Number.isInteger(roster) && 0 <= roster && roster <= (manifest.kazuya === true ? KAZUYA : KAZUYA - 1);
      const { entrants, world, run } = game.state;
      entrants.roster[0] = playable ? roster : 0;
      entrants.costume[0] = Number.isInteger(costume) ? costume & 3 : 0;
      entrants.chosen[0] = 1;
      entrants.computer[0] = 0;
      world.match.stage = Number.isInteger(stage) ? Math.max(1, Math.min(FORCE_STAGES, stage)) - 1 : 0;
      /* A run started past the first stage has the first stage's time to go on with. */
      world.timer = (world.options.roundTime + 2) * 600;
      game.state.modeOverlay = run.overlay;
      Object.assign(game.state, { scene: Scene.FIGHT, step: FightStep.MODE_SETUP });
    }
  }
  /* `?ending=ROSTER[,COSTUME]` goes straight to that character's Arcade ending (the first side the one human). */
  const ending = params.get('ending');
  if (ending !== null) {
    const [roster, costume = 0] = ending.split(',').map(Number) as [number, number?];
    Object.assign(game.state, { scene: Scene.OVERLAY_LOADER, step: 0, next: Scene.MOVIE });
    game.state.world.humans = 1;
    game.state.world.fighters[0]!.rosterCode = roster * 4 + costume;
  }
  /*
   * `?record=time,ROSTER` goes to Time Attack's results and then the records with that character's
   * best time beaten on the first side (ten stages of 30 seconds against Paul, as a run leaves
   * them), its name to enter; `?record=survival,ROSTER,WINS` with a survival record of that many
   * wins (over the first ten characters in turn), through Survival's results;
   * `?record=force,ROSTER[,FLAGS]` to Tekken Force's results for that character on the first side,
   * a run cleared with a new best score, its stages' bosses beaten and the run's flags (1 a copper
   * key by default; 8 Dr. B saved, 0x10 the bosses shown).
   */
  const record = params.get('record');
  if (record !== null) {
    const [kind, roster = 0, wins = 0] = record.split(',').map((part, i) => (i === 0 ? part : Number(part))) as [string, number?, number?];
    if (kind === 'force') {
      const { world, entrants } = game.state;
      world.mode = MenuMode.TEKKEN_FORCE;
      entrants.roster[0] = roster;
      entrants.costume[0] = 0;
      game.state.versusPortraits[0] = lookOf(scenes, roster, 0) & 0x1f;
      Object.assign(world.match.force, { score: FORCE_RECORD.score, kills: FORCE_RECORD.kills, side: 0, newRecord: 1, flags: wins === 0 ? FORCE_RECORD.flags : wins });
      for (let stage = 0; stage < 4; stage += 1) world.match.force.bosses[stage] = bossCode(tables, roster * 4, stage);
      game.state.records.forceBest = FORCE_RECORD.score;
    } else if (kind === 'survival') {
      game.state.world.mode = MenuMode.SURVIVAL;
      for (let won = 0; won < wins; won += 1) game.state.run.survival.beaten[won % 10]! += 1;
      game.state.world.match.survivalRank = survivorRank(game.state, wins);
      checkSurvivalRecord(game.state, scenes, 0, roster, wins);
      Object.assign(game.state.run.ending, { side: 0, code: roster * 4 });
    } else {
      game.state.world.mode = MenuMode.TIME_ATTACK;
      for (let stage = 0; stage < 10; stage += 1) recordStageTime(game.state, stage, roster, 0, 0, RECORD_STAGE_FRAMES);
      checkTimeRecord(game.state, scenes);
      Object.assign(game.state.run.ending, { side: 0, code: roster * 4 });
    }
    Object.assign(game.state, { scene: Scene.OVERLAY_LOADER, step: 0, next: kind === 'force' ? Scene.FORCE_RESULTS : kind === 'survival' ? Scene.SURVIVAL_RESULTS : Scene.TIME_RESULTS });
  }
  const movie = new MoviePicture(renderer, scenes.movies, (file) => dataUrl(`movies/${two(file)}.mp4`), (video) => sound?.connectMovie(video));
  movie.setCaptions(captions);
  const presenter = new ScenePresenter(
    renderer,
    { scenes, roster: tables.roster, ball: tables.ball, math: tables.math },
    {
      title,
      namco,
      select: { portraits, bigIcons, smallIcons },
      creditsMark,
      results,
      forceResults: got['force-results'],
      optionsBackdrop: got.options,
      drawn: { buttons: got['options-buttons'], pads: got['options-pads'], labels: got['options-labels'], arrows: got['options-arrows'], thumbs: got['theater-thumbs'], cover: got['theater-cover'], caption: got['theater-caption'], disc: got['theater-disc'] },
    },
    movie,
  );
  presenter.prepare(canvas.width, canvas.height);
  /* The fight's drawing, made with the first match and given each new match's data. */
  let fight: { view: FightView; hud: Hud; pause: PauseScreen; data: FightData } | null = null;
  const fightFor = (data: FightData): NonNullable<typeof fight> => {
    if (fight === null) {
      const hud = new Hud(renderer, data, game.state.world);
      hud.words = (text) => controlWords(text, controllers());
      fight = { view: new FightView(renderer, data, arena, drawingFiles), hud, pause: new PauseScreen(renderer, data, commands), data };
    }
    else if (fight.data !== data) {
      fight.view.data = data;
      fight.pause.data = data;
      fight.data = data;
    }
    return fight;
  };
  /* Each attract intro's drawing, made the first time it plays. */
  const introViews = new Map<number, FightView>();
  const introView = (intro: number): FightView => {
    let view = introViews.get(intro);
    if (view === undefined) {
      view = new FightView(renderer, introData(intro), arena, introFiles(intro, scenes.intros[intro]!.pairs));
      introViews.set(intro, view);
    }
    return view;
  };
  /** Whether the attract intro is set up (its world holds the intro's fighters and stage). */
  const introSetUp = (state: typeof game.state): boolean => state.scene === Scene.ATTRACT && state.step === 2 && state.attractScreen.step !== 0;
  /**
   * Whether the game may step on to show its 3D, whose drawing is asked for while it is not ready
   * (its models loaded, its pipelines compiled): the fight's over the versus screen's wait, the
   * wait's end held until it is, so the screen shows for the wait or the load, whichever is
   * longer; the attract intro's once it is set up; the records' stage as their screen starts.
   */
  const drawingReady = (): boolean => {
    const state = game.state;
    const data = game.fightData;
    if (state.scene === Scene.FIGHT && data !== null && (state.step === FightStep.WAIT || state.step === FightStep.HOLD)) {
      const { view, hud } = fightFor(data);
      /* The HUD's pictures painted now too, not on the fight's first frame. */
      hud.newMatch(data, state.world);
      hud.prepare(state.world, canvas.width, canvas.height);
      const ready = view.prepare(state.world);
      return state.step === FightStep.WAIT || ready;
    }
    if (introSetUp(state)) return introView(state.attract.intro).prepare(state.world);
    if (state.scene === Scene.RECORDS && data !== null) return fightFor(data).view.prepare(state.world, true);
    return true;
  };
  /* The fighters the HUD's names were set for; what the last frame drawn showed. */
  let named = '';
  let shown: string | null = null;
  /*
   * The display's place (DISPLAY ADJUST): the whole picture moved as the console moves its
   * display, from where the place it powers on with leaves it (the canvas's 4:3 middle is 368
   * units across and 480 lines down).
   */
  let placed = '';
  const placeDisplay = (): void => {
    const { x, y } = game.state.options.display;
    const home = scenes.powerOn.options.display;
    const key = `${x} ${y} ${canvas.clientHeight}`;
    if (key === placed) return;
    placed = key;
    const across = ((displayShift(x) - displayShift(home.x)) * canvas.clientHeight * 4) / 3 / SCREEN.width;
    const down = ((y - home.y) * 2 * canvas.clientHeight) / SCREEN.lines;
    canvas.style.transform = across === 0 && down === 0 ? '' : `translate(${across}px, ${down}px)`;
  };

  play(
    {
      field(pads) {
        const next = game.upcoming();
        if (next !== null) fightData(next);
        if (game.blocked() || !drawingReady()) return false;
        game.field(pads);
        if (saves && game.state.saving !== 0 && game.state.kept !== null) writeProgress(game.state.kept);
        rumble.field(game.state.rumble.out, performance.now());
        sound?.field(game.state.world, game.state.vblanks);
        movie.audible = sound?.running ?? false;
        movie.field(game.state);
        return true;
      },
      render(width, height) {
        placeDisplay();
        presenter.controllers = controllers();
        const state = game.state;
        const now = performance.now() / 1000;
        const aspect = height > 0 ? width / height : 1;
        /* The records' stage is drawn by a fight's view: the last match's, or with none fought yet (`?ending`, `?record`) one for the entrants as they stand. */
        const data = game.fightData ?? (state.scene === Scene.RECORDS ? fightData(matchSetup(state)) : null);
        /* What this frame shows: the fight, the records over their stage, the attract intro, a scene's 2D; or nothing new (the picture held, drawn again only while a dissolve over it runs). */
        const records = state.scene === Scene.RECORDS && state.recordsScreen.draws !== 0 && data !== null && state.held === 0 && fightFor(data).view.prepare(state.world, true);
        const intro = introSetUp(state) && state.held === 0 && introView(state.attract.intro).prepare(state.world);
        const change = state.scene === Scene.FIGHT && state.ogreChange.shows !== OgreChangeShows.NONE && data !== null;
        const shows = change ? 'change' : state.scene === Scene.FIGHT ? (state.drewFight !== 0 && data !== null ? 'fight' : null) : records ? 'records' : intro ? 'intro' : state.held === 0 ? `scene ${state.scene}` : null;
        if (shows === null) {
          presenter.hold(width, height, now);
          return;
        }
        /* A cut: the frame before it dissolves into this one (from black after a 3D frame). */
        if (shown !== null && shows !== shown) presenter.cut(now, shown.startsWith('scene'));
        shown = shows;
        if (records) {
          fightFor(data!).view.render(state.world, aspect, undefined, () => presenter.render(state, width, height, true, now), true);
          return;
        }
        if (intro) {
          introView(state.attract.intro).render(state.world, aspect, undefined, () => presenter.render(state, width, height, true, now));
          return;
        }
        /* Ogre's change: black, white, or its scene under its fades, with no HUD and no effects. */
        if (change) {
          if (state.ogreChange.shows !== OgreChangeShows.SCENE) presenter.render(state, width, height, false, now);
          else fightFor(data!).view.render(state.world, aspect, undefined, () => presenter.render(state, width, height, true, now), false, { effects: false, scenery: state.ogreChange.sceneryOff === 0 });
          return;
        }
        if (state.scene !== Scene.FIGHT) {
          presenter.render(state, width, height, false, now);
          return;
        }
        const { view, hud, pause } = fightFor(data!);
        const world = state.world;
        const fighters = `${world.fighters[0]!.rosterCode} ${world.fighters[1]!.rosterCode}`;
        if (named !== fighters) {
          named = fighters;
          hud.newMatch(data!, world);
        }
        hud.prepare(world, width, height);
        pause.prepare(world, width, height);
        view.render(
          world,
          aspect,
          () => hud.drawBack(),
          () => {
            hud.drawFront();
            presenter.renderOverFight(state, width, height);
            pause.draw();
            presenter.renderDissolve(width, height, now);
          },
        );
      },
      moving: () => presenter.moving,
      fighting: () => shown === 'fight',
      probe: () => ({ scene: game.state.scene, sceneState: game.state.step, sound: sound?.probe() ?? null, movie: movie.probe() }),
    },
    renderer,
    backend,
  );
}
