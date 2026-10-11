/**
 * The 13 hit records every moveset shares, from the executable: a key and a pointer each (eight
 * bytes from 0x80017c10), the records themselves four bytes apiece and back to back (0x80017bdc
 * on). A record is only its four codes; where a move's swept points read a track from one, the
 * original reads the bytes that follow it (the next records, then the keys), so those are decoded
 * as its track, 64 points of them.
 *
 * Also the hits' own tables: damage in percent by the hit sphere met (0x8001deec), the joints the 14
 * hit spheres and the 8 push spheres sit on (words, 0x80096fb8 and 0x80096f40), and the points
 * Yoshimitsu's sword, True Ogre's and Gon's tails hold out from a joint (three halfwords each, eight
 * bytes apart, 0x8001dc28).
 */
const SHARED = 0x80017c10;
const TRACK_POINTS = 64;
const DAMAGE_BY_PART = 0x8001deec;
const HIT_SPHERE_JOINTS = 0x80096fb8;
const PUSH_SPHERE_JOINTS = 0x80096f40;
const HELD_POINTS = 0x8001dc28;

export function hitTables(exe) {
  return {
    shared: Array.from({ length: 13 }, (_, k) => {
      const at = exe.u32(SHARED + k * 8 + 4);
      const u8 = (i) => exe.u8(at + i);
      const points = [];
      for (let i = 0; i < TRACK_POINTS; i += 1) {
        const p = 6 + i * 5;
        const low = (u8(p) | (u8(p + 1) << 8) | (u8(p + 2) << 16) | (u8(p + 3) << 24)) >>> 0;
        const high = (u8(p + 1) | (u8(p + 2) << 8) | (u8(p + 3) << 16) | (u8(p + 4) << 24)) >>> 0;
        points.push((low & 0x1fff) - 0x1000, ((low >>> 13) & 0x1fff) - 0x1000, ((high >>> 18) & 0x3fff) - 0x2000);
      }
      return { codes: [0, 1, 2, 3].map(u8), track: { word: (u8(4) << 8) | u8(5), points } };
    }),
    damageByPart: Array.from({ length: 14 }, (_, i) => exe.s16(DAMAGE_BY_PART + i * 2)),
    hitSphereJoints: Array.from({ length: 14 }, (_, i) => exe.u32(HIT_SPHERE_JOINTS + i * 4)),
    pushSphereJoints: Array.from({ length: 8 }, (_, i) => exe.u32(PUSH_SPHERE_JOINTS + i * 4)),
    heldPoints: Array.from({ length: 6 }, (_, i) => [0, 1, 2].map((k) => exe.s16(HELD_POINTS + i * 8 + k * 2))),
  };
}
