/** Integers at the widths the game keeps them, and its division. */

export const s8 = (v: number): number => (v << 24) >> 24;
export const u8 = (v: number): number => v & 0xff;
export const s16 = (v: number): number => (v << 16) >> 16;
export const u16 = (v: number): number => v & 0xffff;
export const s32 = (v: number): number => v | 0;
export const u32 = (v: number): number => v >>> 0;

/** Signed division, truncating toward zero. */
export const div = (a: number, b: number): number => (a / b) | 0;

/** Unsigned 32-bit division. */
export const divu = (a: number, b: number): number => Math.trunc((a >>> 0) / (b >>> 0)) >>> 0;
