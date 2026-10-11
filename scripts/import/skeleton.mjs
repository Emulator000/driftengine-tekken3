/**
 * The skeleton's tables from the executable: the Euler joints (0x8001a330, ten bytes), the fix-up
 * matrix (0x80096eac), the generic skeleton's offsets (0x80096ecc on, three words each: the chest,
 * the two shoulders, the hips, the two hands, the two feet), the inverse roots (0x8001a194, 192
 * halfwords, and the 192 before them, which a zero or overflowing length reads), each drawn
 * part's joint (0x8001a074, 22 bytes), its record in the model (0x8001a05c) and whether it is drawn
 * (0x8001a08c, halfwords, below zero not), and by model pack the hands' fist and open shapes
 * (0x80095950 and 0x80095984, 55 bytes each; the first runs three bytes into the second) and which
 * of its four accessories are drawn (0x80095e10, six bytes a pack).
 *
 * And by model pack each accessory's spring: six pointers a pack (0x8009623c, the game's 0x34
 * packs), 0x80095f48 the spring that is none. A spring is shorts: +0 the row of the axes table
 * (0x80095d20, six words a row) its angles are taken with, +4 how much of its last direction it
 * keeps, +6 gravity's pull, +8 its reach, +0xa gravity's slant, +0xc its kind (1: held off a point
 * on another joint: +0xe the joint, +0x10 the point, +0x16 the row whose last two words, as
 * halfwords, weigh the point's aim against the swing). The swing's code adds its exceptions by
 * pack: True Ogre's first two (packs 0x20 and 0x21) do not swing; its yaw is held at zero for pack
 * 0xe's first, 0xf's second and third, 0x1b's third and 0x26's fourth; 0x26's first pitches at
 * least 0x800, and its points behind the pivot take row 8 and the swing then row 2; 0x1a's
 * accessories are held within 0x80095d10's two halfwords (the most, the least), 0x24's and 0x29's
 * within 0x80095d14's; and 0x24's and 0x29's first hangs toward a point between the knees. Its
 * arctangent is the geometry library's (0x80098e88), which holds the game's table's angles.
 */
const EULER_JOINTS = 0x8001a330;
const FIXUP = 0x80096eac;
const OFFSETS = 0x80096ecc;
const INVERSE_ROOTS = 0x8001a194;
const PART_JOINTS = 0x8001a074;
const PART_RECORDS = 0x8001a05c;
const PART_DRAWN = 0x8001a08c;
const ACCESSORIES_DRAWN = 0x80095e10;
const FISTS = 0x80095950;
const OPEN_HANDS = 0x80095984;
const PACKS = 0x37;
const SPRINGS = 0x8009623c;
const SPRING_PACKS = 0x34;
const NO_SPRING = 0x80095f48;
const AXES = 0x80095d20;
const LIBRARY_ATAN = 0x80098e88;
const GAME_ATAN = 0x800210c8;
const ACCESSORIES = 4;
/** The swing's exceptions by model pack (the accessories, from 0, each applies to). */
const STILL = { 0x20: [0, 1], 0x21: [0, 1] };
const YAW_HELD = { 0xe: [0], 0xf: [1, 2], 0x1b: [2], 0x26: [3] };
const PITCH_AT_LEAST = { 0x26: { 0: 0x800 } };
const BEHIND = { 0x26: { aimRow: 8, row: 2 } };
const LIMITS = { 0x1a: 0x80095d10, 0x24: 0x80095d14, 0x29: 0x80095d14 };
const KNEES = { 0x24: [0], 0x29: [0] };

/** Each accessory's spring by model pack, as the swing reads it with its exceptions; null where it does not swing. */
function springs(exe) {
  for (let i = 0; i <= 1024; i += 1) {
    if (exe.s16(LIBRARY_ATAN + i * 2) !== exe.u8(GAME_ATAN + i) + (i >> 1)) throw new Error(`the library's arctangent differs from the game's at ${i}`);
  }
  const axes = (row) => Array.from({ length: 6 }, (_, i) => exe.u32(AXES + row * 0x18 + i * 4) | 0);
  return Array.from({ length: SPRING_PACKS }, (_, pack) =>
    Array.from({ length: ACCESSORIES }, (_, k) => {
      const at = exe.u32(SPRINGS + (pack * 6 + k) * 4);
      if (at === NO_SPRING || STILL[pack]?.includes(k)) return null;
      const short = (i) => exe.s16(at + i * 2);
      const kind = exe.u16(at + 0xc);
      const knees = KNEES[pack]?.includes(k) ?? false;
      if (knees && kind === 1) throw new Error(`pack ${pack}'s accessory ${k} both aims at a point and hangs between the knees`);
      let aim = null;
      if (kind === 1) {
        const order = AXES + short(0xb) * 0x18;
        const behind = BEHIND[pack];
        aim = {
          joint: short(7),
          point: [short(8), short(9), short(10)],
          weights: [exe.s16(order + 0x14), exe.s16(order + 0x10)],
          behind: behind === undefined ? null : { aimAxes: axes(behind.aimRow), axes: axes(behind.row) },
        };
      }
      const limits = LIMITS[pack];
      return {
        reach: short(4),
        keep: short(2),
        pull: short(3),
        slant: short(5),
        axes: axes(short(0)),
        aim,
        knees,
        yawHeld: YAW_HELD[pack]?.includes(k) ?? false,
        pitchAtLeast: PITCH_AT_LEAST[pack]?.[k] ?? null,
        limits: limits === undefined ? null : [exe.s16(limits), exe.s16(limits + 2)],
      };
    }),
  );
}

export function skeletonTables(exe) {
  const vector = (k) => [0, 1, 2].map((i) => exe.u32(OFFSETS + k * 12 + i * 4) | 0);
  const halves = (address, count) => Array.from({ length: count }, (_, i) => exe.s16(address + i * 2));
  return {
    eulerJoints: Array.from({ length: 10 }, (_, i) => exe.u8(EULER_JOINTS + i)),
    fixup: halves(FIXUP, 9),
    offsets: { chest: vector(0), shoulders: [vector(1), vector(2)], hips: vector(3), hands: [vector(4), vector(5)], feet: [vector(6), vector(7)] },
    inverseRoots: halves(INVERSE_ROOTS, 192),
    inverseRootsBefore: halves(INVERSE_ROOTS - 384, 192),
    partJoints: Array.from({ length: 22 }, (_, i) => exe.u8(PART_JOINTS + i)),
    partRecords: Array.from({ length: 22 }, (_, i) => exe.u8(PART_RECORDS + i)),
    partDrawn: Array.from({ length: 22 }, (_, i) => (exe.s16(PART_DRAWN + i * 2) < 0 ? 0 : 1)),
    accessoriesDrawn: Array.from({ length: PACKS }, (_, pack) => Array.from({ length: 4 }, (_, k) => exe.u8(ACCESSORIES_DRAWN + pack * 6 + k))),
    springs: springs(exe),
    hands: {
      fists: Array.from({ length: PACKS }, (_, i) => exe.u8(FISTS + i)),
      open: Array.from({ length: PACKS }, (_, i) => exe.u8(OPEN_HANDS + i)),
    },
  };
}
