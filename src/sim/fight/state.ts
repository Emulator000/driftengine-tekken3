/**
 * The fight's state: the fighters and everything the fight keeps between frames, named for what it
 * means. Each phase of the frame reads and changes it.
 */
import type { MusicState, MusicTables } from '../sound/music.ts';
import type { CameraTables } from '../data/camera.ts';
import type { CharacterAnswer, ComputerTables } from '../data/computer.ts';
import type { SoundTables } from '../data/sound.ts';
import type { EffectTables } from '../data/effects.ts';
import type { SoundBanks } from '../data/banks.ts';
import type { SoundCommand } from './voices.ts';
import type { VibrationCommand } from './vibration.ts';
import type { HudPrint } from './hud.ts';
import type { StartLine } from '../data/scenes.ts';
import type { InputTables } from '../data/input.ts';
import type { CancelTables } from '../data/cancels.ts';
import type { HitTables } from '../data/hits.ts';
import type { ReactionRef, ReactionTables, StepRef } from '../data/reactions.ts';
import type { RosterRows } from '../data/roster.ts';
import type { RandomState } from '../math/random.ts';
import type { Motion, CurveTables } from '../data/motion.ts';
import type { HitData, Moveset } from '../data/moveset.ts';
import type { SkeletonTables } from '../data/skeleton.ts';
import type { FighterModels } from '../data/models.ts';
import type { MathTables } from '../data/tables.ts';
import type { Matrix } from '../math/matrix.ts';
import type { Screen } from '../math/projection.ts';

/** The game's modes the fight tells apart. */
export const Mode = { ARCADE: 0, VERSUS: 1, TEAM_BATTLE: 2, TIME_ATTACK: 3, SURVIVAL: 4, PRACTICE: 5, DEMO: 6, TEKKEN_BALL: 7, TEKKEN_FORCE: 8 } as const;

/** Where a player's input comes from: nothing (cleared each frame), the pad (or the computer), a replay. */
export const InputSource = { NONE: 0, PAD: 1, REPLAY: 2 } as const;

/** A move as a fighter holds it: the moveset slot it lies in (0 and 1 the fighters' slots, 2 the common moveset) and its index there. */
export interface MoveRef {
  readonly set: number;
  readonly index: number;
}

/** A moveset as loaded for a fight, with its motions. */
export interface LoadedMoveset {
  readonly moveset: Moveset;
  readonly motions: readonly Motion[];
}

/** What the fight reads and never changes: the tables and the movesets in their slots (the second empty when both fighters share one). */
export interface FightData {
  readonly math: MathTables;
  readonly curves: CurveTables;
  readonly input: InputTables;
  readonly skeleton: SkeletonTables;
  readonly roster: RosterRows;
  /** The 13 hit records every moveset shares. */
  readonly sharedHits: readonly HitData[];
  readonly reactions: ReactionTables;
  readonly cancels: CancelTables;
  readonly hitTables: HitTables;
  readonly camera: CameraTables;
  readonly computer: ComputerTables;
  readonly sound: SoundTables;
  /** The music driver's tables (the songs' picks, the XA songs' and the audio tracks' extents, the options). */
  readonly music: MusicTables;
  readonly effects: EffectTables;
  readonly banks: SoundBanks;
  /** What the fight reads from each model pack's model. */
  readonly models: FighterModels;
  /** The lines under a side not in, as the select shows them: who should press start, and the credits. */
  readonly lines: { readonly coin: readonly StartLine[]; readonly credit: readonly StartLine[] };
  readonly sets: readonly [LoadedMoveset | null, LoadedMoveset | null, LoadedMoveset];
  /** Per moveset slot, the move ids as bound for the fight: an id the character lacks takes the opponent's move, else the default. */
  readonly moveIds: readonly [readonly (MoveRef | null)[], readonly (MoveRef | null)[]];
}

/** A joint: its world matrix, its matrix in the camera's space, and its parent joint (-1 the root). */
export interface Joint {
  readonly world: Matrix;
  readonly view: Matrix;
  parent: number | null;
}

/**
 * A fighter's skeleton. `base` is the root's matrix (its translation where the motion's travel has
 * put the root) and `root` the copy the joints hang from this frame; `locals` the 22 joints' local
 * matrices (each translation its joint's offset from its parent); `blended` the locals 1 to 17 as
 * last posed, and `deltas` the rotations a blend moves them by.
 */
export interface Skeleton {
  readonly base: Matrix;
  readonly root: Matrix;
  readonly locals: readonly Matrix[];
  readonly joints: readonly Joint[];
  readonly blended: readonly Matrix[];
  readonly deltas: readonly number[][];
}

/** The blend between two moves' poses as a move starts or ends. */
export interface MoveBlend {
  /** None, out of the last move, toward the next, toward the move that follows (`Blend` in pose.ts). */
  kind: number;
  length: number;
  position: number;
  /** Its weight this frame, 4.12. */
  weight: number;
  /** Set on the frame a blend starts. */
  started: number;
  from: MoveRef | null;
  to: MoveRef | null;
  fromFrame: number;
  toFrame: number;
  /** The root's offset as last posed, and how far the blend moves it. */
  readonly root: number[];
  readonly rootDelta: number[];
  /** The move and frame posed last frame. */
  lastMove: MoveRef | null;
  lastFrame: number;
}

/**
 * A hit taken: where (and the attack's direction there), which sphere it met, the raw and the dealt
 * damage, the attacker's slot, whether the record is in use, and the hit's kind.
 */
export interface HitRecord {
  readonly point: number[];
  readonly direction: number[];
  part: number;
  raw: number;
  dealt: number;
  attacker: number;
  used: number;
  blocked: number;
  chip: number;
  clean: number;
  counter: number;
  glancing: number;
  juggled: number;
  harmless: number;
}

/** A frame of a fighter as the replay keeps it. */
export interface ReplayFrame {
  move: MoveRef | null;
  blendFrom: MoveRef | null;
  blendTo: MoveRef | null;
  readonly root: number[];
  readonly position: number[];
  readonly angles: number[];
  blendFromFrame: number;
  blendToFrame: number;
  frame: number;
  blendLength: number;
  /** The fighter's charge, which its glow is worked out from. */
  charge: number;
  blendKind: number;
  blending: number;
  /** Each hand's model step as drawn. */
  readonly hands: number[];
}

/** A fighter's input: this frame's and the last 60 frames'. */
export interface FighterInput {
  /** `1 << (direction + 4)`, the direction in numpad notation with 6 toward the opponent. */
  direction: number;
  /** Buttons pressed this frame and held: 1 left punch, 2 right punch, 4 left kick, 8 right kick. */
  pressed: number;
  held: number;
  /** The pad word a replay plays back this frame. */
  replayHeld: number;
  /** Where in the history this frame went. */
  cursor: number;
  /** Per frame of the last 60, a ring: the buttons pressed (high nibble) and the direction (low). */
  history: number[];
  /** Per frame of the ring, the pad's own pressed bits, to count presses over it. */
  pressedHistory: number[];
  /** Presses of square, triangle, cross and circle within the ring. */
  pressCounts: number[];
  /** The follow-up buffer some moves read their next input from: closed at -1. */
  buffer: { count: number; read: number; timer: number; entries: number[] };
}

/** A fighter. Its fields arrive phase by phase as the frame is remade. */
export interface Fighter {
  /** Which moveset slot the fighter reads (0 or 1), and with it whose opponent it is. */
  movesetSlot: number;
  /** The player slot: whose pad drives it and which per-player state is its own. */
  slot: number;
  /** The opponent's slot, and the slot it aims at. */
  opponent: number;
  target: number;
  /** Non-zero when the computer plays it. */
  computer: number;
  /** Which side of the opponent it stands on (0 left, 1 right), unless a move holds it (`sideHeld`) at `heldSide`. */
  side: number;
  sideHeld: number;
  heldSide: number;
  /** Non-zero while it throws. */
  throwing: number;
  /** The frame of its move it is on, from 1, and last frame's. */
  frame: number;
  lastFrame: number;
  health: number;
  /** Where its hips were on the screen when last posed, and how deep. */
  screenX: number;
  screenDepth: number;
  /** Position (y down), lean, facing and the heading the root is built with, 16-bit turns. */
  readonly position: number[];
  readonly tilt: { x: number; z: number };
  facing: number;
  heading: number;
  /** The roster id and its size (4.12), and the size posed with (a thrower's while thrown). */
  roster: number;
  size: number;
  currentSize: number;
  /** In the fight (posed and drawn). */
  present: number;
  /** Drawn without the stage's light. */
  unlit: number;
  /** The move whose motion places the root, and its frame. */
  rootMove: MoveRef | null;
  rootFrame: number;
  /** Named from the pose's readers: frames the root's motion lags the move's (below 1, the move's own frame). */
  rootLag: number;
  /** The motion's root offset this frame, scaled by the size. */
  readonly rootOffset: number[];
  /** Set when the last move ended where its motion left the root, which the pose then takes as the position. */
  rootCorrection: number;
  /** 0 on the ground (the root offset turned by the facing), 1 off it (none), 2 rising (only its height). */
  airborne: number;
  /** Named from the pose's readers: below zero while held in a throw, and the slot of the one holding it. */
  throwHold: number;
  partnerSlot: number;
  /** Named from the blend's readers: a hit's freeze, a throw's holds, blending out blocked, the stun count, whether off the ground (stunned, or inside the move's air frames), being hit, how the move was entered and whether it started this frame. */
  hitFreeze: number;
  readonly holds: number[];
  blendOutBlocked: number;
  stunned: number;
  inAir: number;
  beingHit: number;
  transition: number;
  moveStarted: number;
  /** The next move chosen: its id, the move, the frame it starts on and its transition type; `noBlend` set when its transition cuts. */
  readonly next: { id: number; move: MoveRef | null; startFrame: number; type: number; noBlend: number; turnAround: number };
  readonly blend: MoveBlend;
  readonly skeleton: Skeleton;
  /** The 22 drawn parts: drawn or not, and hung on a joint or not. */
  readonly parts: readonly { drawn: number; hung: number }[];
  /**
   * The four accessories' rest angles, and whether each has hung at rest: from the frame after, it
   * swings on its spring from where its joint was last placed (`skeleton.joints`).
   */
  readonly accessoryRest: readonly number[][];
  readonly accessoryHung: number[];
  /** Named from the readers: set when the move's attack has landed. */
  hitLanded: number;
  /** Read by the head's turn (not remade): set while the head keeps the motion's angle. */
  lookFixed: number;
  /** A count the skeleton's build clears each frame (the sword's trail, not remade). */
  trailCount: number;
  /** The angle toward the target (a 16-bit turn), its distance (and less 40 mm for each large body), its offsets, and the root as measured. */
  towardTarget: number;
  targetDistance: number;
  nearDistance: number;
  targetDx: number;
  targetDz: number;
  readonly measuredRoot: number[];
  /** Named from the readers: the slot of the one hitting it; set when it struck someone, and their slot. */
  struckBySlot: number;
  struck: number;
  struckSlot: number;
  /** The eight push spheres: where each is and its radius. */
  readonly pushSpheres: readonly { readonly position: number[]; radius: number }[];
  /** The push apart this frame, whether it was pushed and by whom, whether it is held from being pushed (in a throw) or immune. */
  readonly push: number[];
  pushed: number;
  readonly pushedBy: number[];
  unpushable: number;
  pushImmune: number;
  /** The root last frame, and its travel this frame. */
  readonly lastRoot: number[];
  readonly travel: number[];
  /** The attack's segments (from and to, each a point), and the first one's travel. */
  readonly segments: readonly { readonly from: number[]; readonly to: number[] }[];
  readonly handTravel: number[];
  /** The moveset id and the costume. */
  character: number;
  costume: number;
  /** Its place on the roster as roster × 4 + costume, which names it. */
  rosterCode: number;
  /** Rounds won this match, and this round's outcome (1 won, -1 lost or drawn). */
  wins: number;
  outcome: number;
  /** Its health as a share of 0x1000 at the round's end, and the health it carries into the next round. */
  healthShare: number;
  carriedHealth: number;
  /** Its part in the round's closing: its win pose (1 or 2), or none (0, or a loss by time). */
  closing: number;
  /**
   * Named from the readers of the angles between the fighters: how far its heading is off the line
   * to the target, that as a size and a quadrant, the heading it would settle on, the turn so far;
   * back from the target, the opponent's heading, and the same three for it.
   */
  facingOff: number;
  facingOffSize: number;
  facingQuadrant: number;
  faceTarget: number;
  spin: number;
  awayFromTarget: number;
  theirHeading: number;
  theirOff: number;
  theirOffSize: number;
  theirQuadrant: number;
  theirFaceTarget: number;
  /** Frames since the move started; its damage; its state flags (stance), level and guard; the move's kind and level's high byte. */
  framesShown: number;
  attackDamage: number;
  stance: number;
  level: number;
  guard: number;
  levelHigh: number;
  kind: number;
  /** A stretch of the move looping: how many times left, and its count when started. */
  loops: number;
  loopCount: number;
  /** The sound script its move started (-1 none), the last one started, and where the script is: its word and its frame. */
  soundScript: number;
  soundScriptStarted: number;
  soundScriptWord: number;
  soundScriptFrame: number;
  /** Frames the move is held on a hit. */
  frozen: number;
  /** A dash toward the opponent: its velocity and its state (1 waiting, 2 moving). */
  readonly dash: { x: number; z: number; state: number };
  /** Moves in a row held in a throw or a held state. */
  heldMoves: number;
  /** Per slot, whether this move has hit it. */
  readonly hitSlots: number[];
  beingThrown: number;
  /** A launch: whether launched, its kind, whether flying its arc, its height and weight, and the arc's velocity (x, rise, z). */
  launched: number;
  launchKind: number;
  inArc: number;
  launchHeight: number;
  launchWeight: number;
  readonly arc: number[];
  /** The move id playing, and the transition type it started with. */
  moveId: number;
  lastType: number;
  /** Named from the readers: where a slide pulls from (x, z), and where the opponent's root was as the move started. */
  readonly pullFrom: number[];
  readonly opponentAtStart: number[];
  /** How many of the attack's segments it has (0 to 2). */
  segmentCount: number;
  bufferOpen: number;
  /** Named from the readers: the guard's mode (1 and 2 by the transition), the damage's kind, how the heading turns this move, whether a hand shape was set, a throw's escape, a slide to make, the move turning the fighter, and whether a person plays it. */
  guardMode: number;
  damageKind: number;
  turnMode: number;
  handShaped: number;
  throwPlain: number;
  slideTo: number;
  turnByMove: number;
  human: number;
  /** Named from the hit's readers: reacting to a hit this frame, and the hit's crumple, downing, counter and from-behind flags. */
  hitReacting: number;
  guarded: number;
  hitClean: number;
  counterHit: number;
  fromBehind: number;
  /** The opponent's pressure on it, a reversal's damage, and the frames a hit holds it. */
  pressure: number;
  reversalDamage: number;
  freezeOnHit: number;
  untouchable: number;
  /** A push over some frames (its frames, speed and angle), and the knockback or arc steps it walks. */
  pushFrames: number;
  pushSpeed: number;
  stepFrames: number;
  pushAngle: number;
  steps: StepRef | null;
  /** A turn spread over frames. */
  turnFrames: number;
  turnStep: number;
  /** Named from the readers: stun to mash out of, its frames, a lock, recovery, repeated reactions and their window, and a hold. */
  mash: number;
  stunFrames: number;
  lockFrames: number;
  recovery: number;
  repeats: number;
  repeatWindow: number;
  hold: number;
  /** The frame and id the last move ended on, the next move's follower, the last reaction type. */
  prevFrame: number;
  prevId: number;
  nextOfNext: number;
  lastReactionType: number;
  /** The reaction a hit chose. */
  reaction: ReactionRef | null;
  /** The hand's travel of the attack that hit it. */
  readonly hitTravel: number[];
  /** Named from the readers: its attack's last active frame passed without landing; the counter-hit window (physics). */
  whiffed: number;
  counterWindow: number;
  /** The two hits it can take a frame, and which one counts. */
  readonly hitRecords: readonly HitRecord[];
  bestHit: number | null;
  /** The fourteen spheres it can be hit on: where, the radius and its square. */
  readonly hitSpheres: readonly { readonly position: number[]; radius: number; radiusSquared: number }[];
  /** Where the first hit sphere (the head's) is. */
  readonly headAt: number[];
  /** Named from the readers: its attack is an effect's (it hits a pushed computer player at once), and it was hit by one. */
  effectHit: number;
  hitByEffect: number;
  /** Knocked out this frame; the health its own move gave or took; the event that says so and how much. */
  knockedOut: number;
  ownDamage: number;
  eventHealth: number;
  eventAmount: number;
  maxHealth: number;
  /** How many of its attack's segments are live (0 outside the attack's active frames). */
  attackSegments: number;
  /** A cancel is watching for a punch pair (a throw's escape). */
  watchingPunchPairs: number;
  /** The punch buttons pressed apart or together since last frame. */
  punchPairs: { left: number; right: number; both: number };
  /** Which computer record plays it. */
  computerRecord: number;
  /** Its sound character. */
  sound: number;
  /** Landed this frame on its feet, or heavily (raising dust). */
  landedLightly: number;
  landedHeavily: number;
  /**
   * Its hands: each one's shape (0 open, 512 a fist and the weights between, 513 on the other hand
   * models), the shape it eases toward and by how much a frame, and the model step each is drawn
   * at (the replay's while one plays; `hands.ts`).
   */
  readonly hands: { readonly shape: number[]; readonly target: number[]; readonly rate: number[]; readonly drawn: number[] };
  /** Its eyes: frames to the blink's next step, whether shut, and the hurt face shown (4). */
  blinkWait: number;
  eyesShut: number;
  hurtFace: number;
  /** True Ogre's wings out: off the ground and not held. */
  wingsOut: number;
  /** True Ogre's wings' frame and state, and his arm's shape, target and rate (not remade beyond resting). */
  readonly trueOgre: { wingFrame: number; wingState: number; arm: number; armTarget: number; armRate: number };
  input: FighterInput;
  move: MoveRef | null;
}

/** A camera script as the camera holds one: the moveset slot it lies in and its index there. */
export interface ScriptRef {
  readonly set: number;
  readonly index: number;
}

/** The shot the camera plays: a built-in shot's number (below 30), -1 for none, another number naming nothing, or a script. */
export type ShotRef = number | ScriptRef;

/** A place for the camera: the eye, its pitch and yaw in 18-bit turns (0x40000 a turn), and the screen's distance. */
export interface CameraPlace {
  readonly eye: number[];
  pitch: number;
  yaw: number;
  screen: number;
}

/** A view: its pitch, yaw and roll (12-bit turns for the drawn camera, 18-bit for the knockout cameras), and the eye. */
export interface CameraView {
  pitch: number;
  yaw: number;
  roll: number;
  readonly eye: number[];
}

/**
 * How a slot's camera eases toward the fighters. Slot 0 swings toward square to their line once off
 * by an eighth of a turn (settled or swinging, frames off, the swing so far and its speed), and
 * tilts up when far off (eased only while the eye moved last frame). Every slot pulls back to keep
 * both heads in view and rises to keep both fighters across it.
 */
export interface CameraFollow {
  swinging: number;
  offFrames: number;
  swing: number;
  swingSpeed: number;
  moving: number;
  tilt: number;
  tiltTarget: number;
  tiltStep: number;
  pull: number;
  pullStep: number;
  rise: number;
}

/** Where the camera tracks a fighter: x, its head's height, z, and its hips across the screen. */
export interface Tracked {
  readonly at: number[];
  screenX: number;
}

/**
 * The fight's camera. Five slots it can be in, weighted into the view the frame draws: 0 follows
 * the fight, 1 plays shots and the replay, 2 scripts and the opening sweep, 3 the blend, 4 a view
 * held while a shot hands back. `state` steps through following, a shot starting, playing and
 * handing back, a script, and a scene.
 */
export interface FightCamera {
  readonly drawn: CameraView;
  readonly slots: readonly CameraPlace[];
  readonly follow: readonly CameraFollow[];
  /** Per fighter (three; the third only in Tekken Force), where it is tracked this frame and last. */
  readonly tracked: readonly Tracked[];
  readonly lastTracked: readonly Tracked[];
  state: number;
  /** Cleared when a knockout camera takes over. */
  following: number;
  /** Per slot, its weight in the view (4.12), and last frame's. */
  readonly weights: number[];
  readonly lastWeights: number[];
  /** Whether moves and scenes may play shots in this mode. */
  shotsAllowed: number;
  /** The fighter the shot is about, the side it plays from, a countdown before it shows, its frames left and its length, the fighter whose throw it watches. */
  focus: number;
  mirrored: number;
  countdown: number;
  left: number;
  length: number;
  watched: number;
  /** A built-in shot of one frame, or a throw's chained shot: it hands back only when the throw lets it. */
  shortShot: number;
  sceneLeft: number;
  sceneLength: number;
  shot: ShotRef;
  /** Above 0 a built-in shot (its table row plus one), below 0 a script, 0 nothing. */
  shotKind: number;
  /** Which of the camera byte's shots was picked, and the move it was picked for. */
  variant: number;
  shotMove: MoveRef | null;
  /** The shot's angles off the fighters' line, 18-bit. */
  shotPitch: number;
  shotYaw: number;
  /** The script playing (with its length and the frame it is on), whether mirrored, where it turns about, and whether it starts over. */
  script: ScriptRef | null;
  scriptFrames: number;
  scriptFrame: number;
  scriptMirror: number;
  readonly scriptOrigin: number[];
  scriptRestart: number;
  /** The script's camera this frame: the eye, what it looks at, its progress (to 0x140) and screen distance. */
  readonly scriptShot: { readonly eye: number[]; readonly target: number[]; progress: number; screen: number };
  /** The channel values the script's last frame gave (a frame past its end gives none and leaves them). */
  readonly scriptValues: number[];
  /** The screen's distance and the arena's range for it; whether scripts scale to it. */
  screen: number;
  screenMin: number;
  screenMax: number;
  scaleScripts: number;
  /** Set by an arena with a low ceiling or a near wall (2); none in the game sets it. */
  arenaKind: number;
  /** The fighter whose spinning sidestep holds the camera still on even frames, or -1. */
  lockedOn: number;
  /** A shot's lift to keep the heads in view (slot 1). */
  rise: number;
  /** The scene playing (by index), and the point it watches: where the fighter's counted hit landed. */
  scene: number | null;
  readonly sceneTarget: number[];
  /** The round's opening: the place it sweeps toward, its length, which sweep, the count of openings so far, the frames left. */
  readonly opening: { readonly from: CameraPlace; length: number; sweep: number; count: number; left: number };
  /** The replay's camera: its distance, alternate swings, whether it runs, a snap, its yaw and pitch, the swing and where it heads; the tracked points it keeps and a tick that slows them while a fighter spins. */
  readonly replay: {
    distance: number;
    alternate: number;
    active: number;
    snap: number;
    yaw: number;
    pitch: number;
    swing: number;
    swingTarget: number;
    tick: number;
    readonly points: { readonly x: number[]; readonly y: number[]; readonly z: number[] };
  };
  /** The knockout cameras: whose turn, the fighter they watch, the two views, and the second's drift. */
  readonly knockout: { turn: number; fighter: number; readonly first: CameraView; readonly second: CameraView; readonly drift: number[] };
  /** The round's finishing shot: the eye, what it looks at, its roll; the height and turn looking down. */
  readonly finish: { readonly eye: number[]; readonly target: number[]; roll: number; height: number; turn: number };
  /** The attract mode's shot and its step. */
  /**
   * The attract mode's camera: its shot (of four) and step, the frames the shot has left, its orbit
   * (pitch, yaw and speed, 18-bit) and its sweep (which, its frame, its angle).
   */
  readonly attract: {
    shot: number;
    step: number;
    timer: number;
    readonly orbit: { pitch: number; yaw: number; speed: number };
    readonly sweep: { which: number; t: number; angle: number };
  };
  /** Whether the attract mode's camera has started (0 starts it over next frame). */
  attractStarted: number;
  /** The attract intro's camera: its script set, the next script's index, and the frames its script has left. */
  readonly intro: { set: number; next: number; left: number };
}

/** A cancel-list entry as one is held: in a moveset slot's lists (`set`), or in the shared lists (`set` -1). */
export interface CancelRef {
  readonly shared: boolean;
  readonly set: number;
  readonly index: number;
}

/** Where an input script plays on: a step among the computer's scripts or among the input sequences. */
export interface ScriptStep {
  readonly pool: 'scripts' | 'sequences';
  readonly at: number;
}

/** A move the computer could cancel into now: the move, the entry that leads there, and whether it is taken (1), free (0) or set aside (-1). */
export interface Candidate {
  move: MoveRef | null;
  entry: CancelRef | null;
  taken: number;
}

/**
 * A computer player's record: what it noticed this frame, what it plans, and its tuning. Most
 * fields are named from what reads them; counts run down by a frame unless said.
 */
export interface ComputerRecord {
  /** Its index (which record), frames its move moved on (its parity alternates some choices), the pad this frame and last, and the script playing on. */
  index: number;
  steps: number;
  pad: number;
  lastPad: number;
  script: ScriptStep | null;
  /** The fighter it plays against. */
  opponent: number;
  /** How far the opponent is: the distance, last frame's and the change; the band it falls in by the fighter's reach (`nearBand`, 0 to 5) and the opponent's (`farBand`, 1 to 5); frames spent far. */
  distance: number;
  lastDistance: number;
  closing: number;
  nearBand: number;
  farBand: number;
  farFrames: number;
  /** Its own move: changed this frame, frames in it, last frame's frame, as last seen; its flags and kind (and the kind's low half); active, and in a hold's window. */
  moveChanged: number;
  moveFrames: number;
  lastFrame: number;
  lastMoveFrame: number;
  move: MoveRef | null;
  ownFlags: number;
  ownKind: number;
  ownKindLow: number;
  attacking: number;
  holdWindow: number;
  /** The opponent's move: its flags, kind and the kind's low half; one never recorded, and its frame. */
  theirFlags: number;
  theirKind: number;
  theirKindLow: number;
  theirMoveSeen: MoveRef | null;
  theirLastFrame: number;
  /** How far turned from the opponent, the health it had last frame, and bits of where the opponent stands and what it does. */
  turned: number;
  lastHealth: number;
  around: number;
  /** The opponent's attack: coming, held (frames), frames until it lands, low, a special one, their travel frames, attacks counted (-1 none), high in the air, rolling; frames it has been coming, frames of the fighter's own attack. */
  coming: number;
  heldFrames: number;
  due: number;
  lowComing: number;
  special: number;
  theirTravel: number;
  theirAttacks: number;
  theyAreHigh: number;
  rolling: number;
  comingFrames: number;
  ownAttackFrames: number;
  /** Fire coming from the opponent, and fire on the ground. */
  fireComing: number;
  groundFire: number;
  /** The guard: whether it stops the attack coming, a countdown to it, its length left, held after a guard cancel, crouched in it, in a guard move. */
  guardStops: number;
  attackCountdown: number;
  guardLeft: number;
  guardHold: number;
  guarding: number;
  inGuard: number;
  /** Plans: calm frames, a walk (frames left and its kind, 2 a dash in), a direction held, waiting before attacking, an opener's wait, guard and travel plans, a reversal's window, the getting-up wait, holds after a downed choice and after an answer. */
  calm: number;
  walkLeft: number;
  walkKind: number;
  holdFrames: number;
  wait: number;
  openerWait: number;
  guardPlan: number;
  travelPlan: number;
  reversalWindow: number;
  escapeWait: number;
  downedHold: number;
  answerHold: number;
  /** Urges to press on: this frame's and the one carried from the last, and a second pair. */
  urgeNext: number;
  urge: number;
  pressNext: number;
  press: number;
  /** Why it crouches, the retreat plan, and attacks made against the limit. */
  crouch: number;
  retreat: number;
  attacks: number;
  attackLimit: number;
  /** The move a cancel played. */
  performed: MoveRef | null;
  /** The candidates gathered and taken; whether lows are set aside at the next gathering. */
  candidateCount: number;
  takenCount: number;
  dropLows: number;
  /** A throw: follow-ups played, the frame the chosen one plays, the move it was chosen in, the entry. */
  throwFollowUps: number;
  throwFollowUpFrame: number;
  throwMove: MoveRef | null;
  throwFollowUp: CancelRef | null;
  /** Follow-ups listed while a move plays: special ones, ones the band allows, and a string's next presses (with a skip and its latest frame); each wanted, its count and its entries. */
  specialsWanted: number;
  specials: (CancelRef | null)[];
  specialCount: number;
  specialsDropped: number;
  followUpsWanted: number;
  followUps: (CancelRef | null)[];
  followUpCount: number;
  stringWanted: number;
  string: (CancelRef | null)[];
  stringCount: number;
  stringSkip: number;
  stringLast: number;
  /** The opponent's moves that hurt it (the last eight, a ring), whether one hurt it twice, frames left re-tuned to the hardest. */
  readonly hurtBy: (MoveRef | null)[];
  hurtIndex: number;
  seenTwice: number;
  retune: number;
  /** How it plays: 0 holds nothing, 1 holds up when its move asks, otherwise it decides. */
  mode: number;
  /** The answers its character and the opponent's have. */
  againstAnswer: CharacterAnswer;
  ownAnswer: CharacterAnswer;
  /** Its tuning (55 halfwords, `Tune` names them), its own character's six and the opponent's. */
  readonly tuning: number[];
  readonly ownCharacter: number[];
  readonly theirCharacter: number[];
}

/**
 * An object of the effect pool: its kind (as `pool.ts` lists them), flags (0x80 taken, 0x40 drawn,
 * 0x10 and 8 the first or second fighter's, 2 an attack), the state its kind steps through, a
 * direction (climb and heading, 4096ths), speed and velocity (16.16 mm a frame), where it is and
 * where it was, the look it is drawn with, and four words each kind reads its own way.
 */
export interface EffectObject {
  kind: number;
  flags: number;
  state: number;
  climb: number;
  heading: number;
  speed: number;
  readonly velocity: number[];
  readonly position: number[];
  readonly last: number[];
  look: EffectLook | null;
  readonly words: number[];
}

/**
 * A spark or a puff of dust playing: the sheet it plays (a row of the sheets' table, 0 and 1 the
 * fighters' own, 2 the generic ones, and a code in it), the frame it is on (0 none) and its last,
 * where it is (in 128ths of a millimetre) and its drift, mirrored to face the camera, and added
 * onto the picture (dust is averaged).
 */
export interface Spark {
  frame: number;
  last: number;
  sheet: { readonly row: number; readonly code: number } | null;
  readonly position: number[];
  readonly drift: number[];
  mirrored: number;
  added: number;
}

/** A spark or dust recorded for the replay: a spark's point, direction, kind and code, or dust's point. */
export interface EffectEvent {
  readonly point: number[];
  readonly direction: number[];
  dust: number;
  kind: number;
  code: number;
}

/** How an effect object is drawn: a plain or a charged burst spark, or a breath puff. */
export type EffectLook =
  | 'plain'
  | 'charged'
  | 'breath'
  | 'glow'
  | 'trail'
  | 'sparkle'
  | 'fire'
  | 'fire mirrored'
  | 'ember'
  | 'gon fire'
  | 'gon fire mirrored'
  | 'floor flame'
  | 'burning'
  | 'gon burning'
  | 'column'
  | 'column mirrored';

/** The fight's state: three fighter records (the third only in the modes with a third body) and the fight's own. */
export interface FightState {
  readonly fighters: readonly [Fighter, Fighter, Fighter];
  /** The game's random numbers. */
  readonly random: RandomState;
  /** Frames since the game started, and fields seen by the pads. */
  frameCount: number;
  vsyncSeen: number;
  /** Per slot, the frames a launch's arc lasts. */
  readonly arcFrames: number[];
  mode: number;
  /** Per slot, the opponent's attack as the guard tests read it this frame (0 not worked out yet, -1 none). */
  readonly attackClasses: number[];
  /** Named from the reader: with 0, a knocked-out fighter's falling move takes the hit reaction; otherwise the knockout's fall. */
  knockoutRule: number;
  /** Rules: a blocked hit always takes chip damage; health frozen (the round over, which the flow sets, and the mode's switch); a knockout has started the replay. */
  alwaysChip: number;
  freezeHealth: number;
  freezeHealthToo: number;
  knockoutReplay: number;
  /** Per side, an effect's attack segments and how many there are. */
  readonly effectSegments: readonly (readonly { readonly from: number[]; readonly to: number[] }[])[];
  readonly effectSegmentCounts: number[];
  /** Per slot, last frame's base and the two segments' ends, for the swept attack; which baked track it reads. */
  readonly sweepBases: readonly number[][];
  readonly sweepFirsts: readonly number[][];
  readonly sweepSeconds: readonly number[][];
  readonly tracks: number[];
  /** The swept attack's turn this frame: the heading's sine and cosine, the turn's, the turn, and what it turns about. */
  readonly sweepTurn: { sin: number; cos: number; turnSin: number; turnCos: number; turn: number; readonly origin: number[] };
  /** The match's status: 0 starting, 1 the opening, 2 fighting, 3 on the knockouts, 6 and 7 the closing shots. */
  status: number;
  /** Set in the attract mode's fights. */
  attract: number;
  readonly camera: FightCamera;
  /** A camera shake playing: which of the three, and how far along its list; or none. */
  shake: { kind: number; at: number } | null;
  /** A second random generator, stepped every frame and by the knockout cameras. */
  frameSeed: number;
  /**
   * The effect pool: eighty objects, the free ones and the running ones in their order; how many
   * ran this frame; whether it was cleared for the replay and for the knockout; per fighter the
   * joints that glow (a bit each, the top bit to trail); frames the glow has run; the replay echoes'
   * last voice; a flag the glow's kinds read, cleared with the pool for the replay.
   */
  readonly effects: {
    readonly objects: readonly EffectObject[];
    readonly free: number[];
    readonly active: number[];
    running: number;
    clearedForReplay: number;
    clearedForKnockout: number;
    readonly glow: number[];
    glowTicks: number;
    echoVoice: number;
    replayReset: number;
  };
  /** The three sparks (the next one taken in turn), and the three dust clouds (the next likewise), each six puffs started one every other frame around where it rose. */
  readonly sparks: { readonly slots: readonly Spark[]; next: number };
  readonly dust: { readonly clouds: readonly { age: number; readonly origin: number[]; readonly puffs: readonly Spark[] }[]; next: number };
  /**
   * The sparks and dust recorded for the replay: whether recording, the frame being written and the
   * one being played, the events this ring of frames, the next event's slot; per frame of the ring
   * its first event and count, and the 64 events.
   */
  readonly replayEffects: {
    recording: number;
    writeFrame: number;
    readFrame: number;
    frameEvents: number;
    writeEvent: number;
    readonly frames: readonly { first: number; count: number }[];
    readonly events: readonly EffectEvent[];
  };
  /**
   * The sounds asked for this frame, and which of the banks 2 and 3 holds each side's own sounds;
   * per side, frames before another grunt and another cry, whether an event quieted the move's own
   * sounds this frame, and Mokujin's switch for his own hit sounds.
   */
  readonly sound: {
    readonly commands: SoundCommand[];
    readonly fighterBanks: number[];
    /** Which sound bank each of the four bank numbers holds (the fighters' in 2 and 3; 0xff none). */
    readonly vabs: number[];
    /** Each voice as the last frame's start keyed it: keyed on or not, the frame it was, and what it plays. */
    readonly voices: readonly { keyed: number; keyedAt: number; bank: number; program: number; tone: number; note: number }[];
    readonly gruntWaits: number[];
    readonly cryWaits: number[];
    readonly quiet: number[];
    readonly mokujinHits: number[];
    /** The music driver's records (`src/sim/sound/music.ts`), and how many of this frame's commands it has taken. */
    readonly music: MusicState;
    musicSeen: number;
    /** The vertical blank this frame's commands are timed at so far (later than the frame's start once a movie's waits moved it on, an `at` command saying so). */
    stamp: number;
    /** Whether VAB 2 holds the Theater's own bank (its credits' sound), and whether the reverb is on (the Theater's, for voice 1). */
    theater: number;
    reverb: number;
  };
  /** The computer players: a record each, the moves the one deciding could cancel into, whether every other frame is skipped; the difficulty and the arcade's stage they are tuned by. */
  readonly computer: {
    readonly records: readonly ComputerRecord[];
    readonly candidates: readonly Candidate[];
    halfRate: number;
    difficulty: number;
    arcadeStage: number;
  };
  stage: number;
  /** The camera's view, and the skeletons' (the view, or levelled and lifted looking straight down). */
  readonly view: Matrix;
  /** Whether the ground shows (the view looks above the horizon), and how far past the fighters its shade reaches. */
  groundShown: number;
  groundFade: number;
  /**
   * The scenery's turn: frames counted, each fighter's root (x and z) over the last four frames (a
   * ring by the count), its yaw (4096ths), and the camera's look point and yaw last frame and the
   * frame before.
   */
  readonly scenery: { samples: number; readonly roots: readonly (readonly { x: number; z: number }[])[]; yaw: number; readonly look: number[]; lastYaw: number; yawBefore: number };
  readonly skeletonCamera: Matrix;
  overhead: number;
  /** Set while the attract's intro plays the fight: its fighters' eyes do not blink. */
  attractIntro: number;
  readonly screen: Screen;
  /** The pause: asked for, paused, the frame frozen; last frame's ask, and a release from outside. */
  readonly pause: { requested: number; paused: number; frozen: number; last: number; released: number };
  replaying: number;
  /** Set when this frame's pose is the frame's own, not a replay's step. */
  liveFrame: number;
  skipBlend: number;
  /** Frames during which moves cut without blending. */
  noBlendFrames: number;
  nothingDrawn: number;
  framesDrawn: number;
  /** Whether a frame of the game ran this field (none while a frame's waits, a movie's stream, spend the field). */
  frameRan: number;
  /** The fighters posed this field, a bit by slot: posing is what draws a fighter, so one the field leaves unposed is not on screen (the attract intro's sides between moves). */
  posed: number;
  /** Which of the picture's two buffers this field draws into, flipped each field the picture is not held: a fire breath attacks on every other one, its fighter's way. */
  drawBuffer: number;
  /** This frame's root channels and all channels of the last fighter posed. */
  readonly channels: { readonly root: number[]; readonly all: number[] };
  /** A flash's light: where it is, its strength counting down, its pull on the fighter posed, and its colour (a spark's, each part 16 times). */
  readonly flash: { readonly at: number[]; left: number; readonly pull: number[]; readonly colour: number[] };
  /** Per moveset slot, a hit's flash on the fighter's colour, counting to 32. */
  readonly hitFlash: number[];
  /** The blend's working poses, kept between blends: a limb whose target is too close keeps what was there. */
  readonly blendWork: { readonly from: readonly Matrix[]; readonly to: readonly Matrix[] };
  readonly replay: {
    state: number;
    index: number;
    recordFrame: number;
    playFrame: number;
    /** Where a knockout's replay starts on the ring. */
    knockoutStart: number;
    /** Frames recorded (to 0x70000000), whether a human cut the replay short, and an overlay's full-speed replay playing. */
    recorded: number;
    skip: number;
    overlayPlaying: number;
    /** The first replay's index, from each match's start. */
    first: number;
    /** The stage and each fighter's roster code, character and sound as the replay started. */
    stage: number;
    readonly cast: readonly { rosterCode: number; character: number; sound: number }[];
    /** The round's sounds as recorded for the replay, a slot a frame (shifted on by each sound), and the shift. */
    readonly sounds: readonly { code: number; kind: number; side: number }[];
    soundShift: number;
    readonly fighters: readonly { readonly frames: ReplayFrame[] }[];
    readonly held: readonly ReplayFrame[];
  };
  /** How many fighters are mid-throw; whether a held throw carries its partner, and last frame's count. */
  throwsUnderway: number;
  throwCarry: number;
  throwCarryLast: number;
  /** Per pair of slots, their distance, offsets and the angle between; the first two fighters' distance. */
  readonly pairs: readonly { distance: number; dx: number; dz: number; angle: number }[];
  distance: number;
  /** Per slot, where its root stood last frame. */
  readonly lastRoots: readonly number[][];
  /** Per slot, its weight in the push (100 from each round's start; the push skips a slot at 0). */
  readonly pushWeights: number[];
  /**
   * The match's options: the round's time (the timer starts at that plus two, in ten-second steps),
   * the rounds a win takes less one, and in versus each side's health handicap (a row of full health).
   */
  readonly options: { roundTime: number; rounds: number; readonly handicaps: number[] };
  /** The stage's song (its name record's, or the mode's), which each round starts. */
  stageSong: number;
  /** Per slot, a stepping move's travel left over, in 256ths (x and z). */
  readonly stepRemainders: { readonly x: number[]; readonly z: number[] };
  /** Per side, the second hand's model step as the last posed frame left it: Gon's blink moves his hand only from the open one. */
  readonly lastHandSteps: number[];
  /** The pads' vibration asked for this frame: a pattern on a pad (2 for both). */
  readonly vibrations: VibrationCommand[];
  /** Per slot, the bounds' pull and how fast it grows. */
  readonly pulls: number[];
  readonly pullSpeeds: number[];
  /**
   * The round: its frames, frames seen, its number, the step its flow is at (0 before it starts)
   * and the frames into that step; its result (bits: 0 time up, 1 a knockout, 2 a double
   * knockout, 3 a perfect, 4 a great, 5 a draw) and the match's last round (one sooner after each
   * draw).
   */
  round: {
    frames: number;
    framesSeen: number;
    number: number;
    flow: number;
    flowFrames: number;
    result: number;
    last: number;
    /** Frames the step may still last, whether it is done, the replay asked for, and each side's win pose done. */
    left: number;
    done: number;
    replayRequest: number;
    readonly posesDone: number[];
  };
  /**
   * The match: its winner (1 or 2 the side, 3 a draw), set when a new challenger stops the fight
   * (the announcer stays quiet), whether a match's end leaves the mode's run going on (its closing
   * is a round's, and the music fades even after a human loses), whether the win streak shows, and
   * the rounds a win takes.
   */
  readonly match: {
    winner: number;
    challenger: number;
    goesOn: number;
    showsStreak: number;
    roundsToWin: number;
    /** The mode's switches: whether the fight may pause, how a draw scores, whether the closing restores health. */
    canPause: number;
    drawRule: number;
    healthBackForPoses: number;
    /** The sides the match ended with as winner and loser; the humans' sides as bits and their count; the human's and the computer's side in a one-player mode; the streak's side. */
    winnerSide: number;
    loserSide: number;
    humanSides: number;
    humanCount: number;
    humanSide: number;
    computerSide: number;
    streakSide: number;
    /** The arcade's stage, whether a human lost the arcade's match, whether the continue was offered (and is being asked), the frames fought this stage and the run's before it. */
    stage: number;
    humanLost: number;
    continueOffered: number;
    continuing: number;
    fightFrames: number;
    totalTime: number;
    /** The wins in a row the streak counts, and which sides play True Ogre (bits). */
    streak: number;
    trueOgres: number;
  };
  /**
   * The pause menu: its cursor (0xff opening it), its choice (1 cancel, 2 the command list, 3 reset,
   * 4 rules), the frames its input waits, and per side the command list's place and its scroll's
   * offset easing to it.
   */
  readonly pauseMenu: { cursor: number; choice: number; wait: number; readonly scrolls: readonly { place: number; offset: number }[]; drawn: number };
  /** The round's timer in frames, and whether it is stopped (practice, or the mode's own). */
  timer: number;
  timerStopped: number;
  /** Which pads humans play (bits), and whether each pad has joined. */
  humans: number;
  readonly joined: number[];
  /** Set when the humans skipped the replay. */
  replaySkipped: number;
  /**
   * The HUD: whether it shows, and per side the health bar: the health last seen, the length (of
   * 152) it grows toward, the length shown (three a frame back up at a round's start) and the
   * damage just taken, draining a sixteenth a frame. Then what it shows this field, as its step
   * decides: the calls as the printer prints them, whether the back (the names, the round marks,
   * the timer and the bars) is drawn, the timer's seconds there (-1 the infinity sign), and each
   * side's round marks, 1 a lit one.
   */
  readonly hud: {
    shown: number;
    readonly marksShown: number[];
    streak: number;
    streakSide: number;
    readonly bars: readonly { seen: number; target: number; shown: number; damage: number }[];
    readonly prints: HudPrint[];
    back: number;
    timerShown: number;
    readonly marksLit: number[][];
  };
  input: {
    /** Per player slot, where its input comes from (`InputSource`). */
    sources: number[];
    /** Per pad, the buttons held and newly pressed this frame, after the button mapping. */
    pads: { held: number[]; pressed: number[] };
    /** Per pad, the sidestep shortcut: L2 taps up, L1 down, for a few frames. */
    sidesteps: { down: number; left: number }[];
    /** Per player slot, the pad word a replay played last frame. */
    replayPrevious: number[];
    /** Per player slot, last frame's history entry, for the punch pairs. */
    lastPunchBits: number[];
    /** Per pad, the raw buttons held (the round's start and the win pose read them). */
    rawPads: number[];
    /** Per pad, the raw buttons newly pressed (start pauses and skips). */
    fresh: number[];
  };
}
