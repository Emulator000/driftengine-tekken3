/**
 * The fight's effect tables, from the executable: the two points of a fighter's head a breath
 * leaves from and heads to (0x80098830, eight bytes apart), at which of a breath puff's 21 frames
 * it still hurts (0x80025688), the joint a hit code's glow lights (0x800251c4, eight bytes a code:
 * codes 0 to 0x19 hold a joint or 0, past them the words that lie there, read the same way), the
 * charged glow's place on each roster's hands (0x80025334, sixteen bytes a roster: from joint 6,
 * then from joint 10; roster 21's row is the first sixteen bytes of the trail's model that follows)
 * and its flash's colour (0x80025330), the six puffs of a dust cloud around the landing (0x8001e818, eight bytes
 * apart), each character's spark (its frame count, then its flash colour; 0x80027950, six bytes
 * per roster row) and the four generic sparks (0x800279d4: a hit, two guards, dust), the three
 * camera shakes (pointers from 0x80097aa4 to signed bytes ending at -128), and the fire's: its flash
 * colour (0x8002517c), the two points a fire leaves the head from and heads to (Ogre's breath a pair
 * a side at 0x80098800, Gon's at 0x80098820, his flames' from his joint 11 at 0x80098840), the
 * joints a burning fighter's ten flames sit on (0x80025180, a word each), whether the breath still
 * feeds a puff by its last stage's frame (0x80025534) and whether Gon's puff still hurts by its
 * (0x800255e0), his flames' schedule (0x80025738: frame, speed, height, -1 ending it) and whether a
 * column hurts by its two frames (0x800257e8).
 */
const MOUTH = 0x80098830;
const BREATH_HURTS = 0x80025688;
const GLOW_JOINTS = 0x800251c4;
const GLOW_CODES = 0x100;
const GLOW_OFFSETS = 0x80025334;
const GLOW_COLOUR = 0x80025330;
const PUFFS = 0x8001e818;
const CHARACTER_SPARKS = 0x80027950;
const ROWS = 22;
/** The attract intro's sparks: the rows its two sides throw (the scene's own, `0x80027986` and `0x80027968`, whoever plays). */
const INTRO_SPARKS = [0x80027986, 0x80027968];
const GENERIC_SPARKS = 0x800279d4;
const SHAKES = 0x80097aa4;
const FIRE_COLOUR = 0x8002517c;
const FIRE_MOUTHS = 0x80098800;
const GON_MOUTH = 0x80098820;
const GON_FLAMES = 0x80098840;
const BURNING_JOINTS = 0x80025180;
const FIRE_GOING = 0x80025534;
const GON_HURTS = 0x800255e0;
const FLAME_SCHEDULE = 0x80025738;
const FLAME_HURTS = 0x800257e8;

const point = (exe, at) => [0, 1, 2].map((k) => exe.s16(at + k * 2));
const spark = (exe, at) => ({ frames: exe.u16(at), colour: [2, 3, 4].map((k) => exe.u8(at + k)) });

export function effectTables(exe) {
  return {
    mouth: [point(exe, MOUTH), point(exe, MOUTH + 8)],
    breathHurts: Array.from({ length: 21 }, (_, i) => exe.u8(BREATH_HURTS + i)),
    glowJoints: Array.from({ length: GLOW_CODES }, (_, i) => exe.u32(GLOW_JOINTS + i * 8)),
    glowOffsets: Array.from({ length: ROWS }, (_, row) => [point(exe, GLOW_OFFSETS + row * 16), point(exe, GLOW_OFFSETS + row * 16 + 8)]),
    glowColour: [0, 1, 2].map((k) => exe.u8(GLOW_COLOUR + k)),
    puffs: Array.from({ length: 6 }, (_, i) => point(exe, PUFFS + i * 8)),
    characterSparks: Array.from({ length: ROWS }, (_, row) => spark(exe, CHARACTER_SPARKS + row * 6)),
    introSparks: INTRO_SPARKS.map((at) => (at - CHARACTER_SPARKS) / 6),
    genericSparks: Array.from({ length: 4 }, (_, i) => spark(exe, GENERIC_SPARKS + i * 6)),
    fire: fireTables(exe),
    shakes: [0, 1, 2].map((k) => {
      const steps = [];
      for (let at = exe.u32(SHAKES + k * 4); ; at += 1) {
        const step = (exe.u8(at) << 24) >> 24;
        steps.push(step);
        if (step === -0x80) break;
        if (steps.length > 0x200) throw new Error(`shake ${k} has no end`);
      }
      return steps;
    }),
  };
}

/** The fire's tables (see above). */
function fireTables(exe) {
  const pair = (at) => [point(exe, at), point(exe, at + 8)];
  const schedule = [];
  for (let at = FLAME_SCHEDULE; exe.s16(at) !== -1; at += 6) {
    schedule.push({ frame: exe.s16(at), speed: exe.s16(at + 2), height: exe.s16(at + 4) });
    if (schedule.length > 0x40) throw new Error("Gon's flames' schedule has no end");
  }
  return {
    colour: [0, 1, 2].map((k) => exe.u8(FIRE_COLOUR + k)),
    mouths: [pair(FIRE_MOUTHS), pair(FIRE_MOUTHS + 0x10)],
    gonMouth: pair(GON_MOUTH),
    gonFlames: pair(GON_FLAMES),
    burningJoints: Array.from({ length: 10 }, (_, i) => exe.u32(BURNING_JOINTS + i * 4)),
    going: Array.from({ length: 8 }, (_, i) => exe.u8(FIRE_GOING + i)),
    gonHurts: Array.from({ length: 9 }, (_, i) => exe.u8(GON_HURTS + i)),
    schedule,
    columnHurts: Array.from({ length: 0x1b }, (_, i) => exe.u8(FLAME_HURTS + i)),
  };
}
