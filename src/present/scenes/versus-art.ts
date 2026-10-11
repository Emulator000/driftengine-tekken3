/**
 * The versus screen's two backdrops, painted new on the original's pictures (logical files 10 and
 * 11): for one player dark pitted rock split by a red bolt, for two (and the attract demo) a violet
 * burst throwing lightning out of the dark. The bolts' centrelines (each with its glow's
 * half-width and how hot its core runs), the pits and the streaks were measured from the original's
 * pictures on its screen (368 units across, the picture from line 20 to 468); the rock's grain, the
 * glow and the bolts' fine jags are made here at the display's resolution. Past the screen's sides
 * the rock goes on with pits of its own, and a bolt that leaves the screen runs on to the window's
 * edge.
 *
 * The original adds a column of each portrait's colour over the picture, behind the portrait; it
 * is added here the same way, into the painted backdrop.
 */

type Context = OffscreenCanvasRenderingContext2D;

/** The picture's lines, and the original screen's width. */
export const BACKDROP = { top: 20, bottom: 468, width: 368 } as const;

/** Where a backdrop is painted: its device rectangle's top left, the units it spans across, and device pixels per unit across and per line. */
export interface BackdropPlace {
  readonly left: number;
  readonly top: number;
  readonly from: number;
  readonly to: number;
  readonly kx: number;
  readonly ky: number;
}

/** A portrait's column, added behind it: the portrait's place and its character's colour (0xBBGGRR). */
export interface Column {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
}

/** The column: across the portrait's picture, from its top to its fullest to its end, greyed at the foot. */
export const COLUMN = { left: 2, width: 0x7e, top: 6, full: 0x70, end: 0xda, grey: 0xc0 } as const;

/** Each bolt's centreline: its glow's half-width, its core's heat (0 none, 255 white), then its points. */
export const BOLTS_0: readonly (readonly number[])[] = [
  [9, 200, 342, 20, 337, 30, 336, 40, 334, 47, 331, 55, 329, 62, 323, 68, 316, 75, 307, 80, 298, 84],
  [13, 200, 298, 84, 290, 88, 283, 92, 276, 97, 268, 104, 258, 110, 251, 114, 246, 120, 242, 126, 238, 131, 234, 137, 231, 143, 227, 149, 223, 156, 221, 162, 218, 168, 212, 174, 211, 180, 212, 188, 213, 197, 215, 205, 216, 214, 215, 226, 214, 240, 213, 250, 211, 258, 208, 264, 205, 271, 203, 278],
  [14, 200, 203, 278, 200, 284, 196, 289, 192, 294, 188, 300, 184, 306, 180, 312, 172, 317, 165, 321, 157, 326, 140, 328, 120, 329, 110, 331, 100, 333],
  [12, 200, 100, 333, 88, 336, 78, 340, 68, 346, 59, 350, 53, 356, 50, 363, 48, 370, 46, 377, 44, 383, 40, 388, 34, 394, 30, 399, 25, 405, 21, 410, 19, 415, 17, 422, 15, 430, 15, 446, 17, 454, 14, 462, 13, 468],
  [8, 30, 294, 20, 303, 23, 315, 22, 323, 23, 327, 25, 336, 35, 333, 53],
  [5, 24, 218, 176, 235, 191, 236, 199, 247, 206, 251, 206, 253, 208, 258, 209, 261, 213, 261, 234, 258, 239, 258, 244, 260, 246, 260, 249],
  [9, 22, 12, 377, 19, 370, 32, 368, 39, 376, 38, 385, 36, 389],
  [5.5, 27, 284, 98, 293, 107, 293, 118, 290, 123, 290, 133, 297, 143, 297, 147, 300, 149, 300, 152],
  [3, 30, 82, 381, 89, 383, 91, 386, 90, 425, 88, 429, 88, 442, 86, 449, 86, 456, 84, 459, 84, 466],
  [9, 30, 65, 353, 75, 363, 77, 376],
  [2.5, 25, 260, 71, 255, 78, 249, 81, 234, 75, 229, 69, 226, 55, 224, 52, 224, 49, 221, 46, 221, 43],
  [2.5, 16, 50, 221, 58, 221, 61, 223, 64, 223, 66, 225, 66, 231, 69, 234, 69, 236, 73, 239, 83, 239, 94, 249, 98, 251, 105, 247],
  [4, 20, 28, 405, 37, 414, 39, 434, 42, 436, 42, 439],
  [4, 30, 192, 200, 183, 205, 175, 206, 172, 208, 160, 209],
  [3, 30, 282, 20, 280, 22, 279, 37, 276, 43, 274, 53, 271, 56, 270, 60],
  [2, 16, 200, 44, 200, 48, 204, 54, 213, 60, 214, 69, 216, 72, 221, 76, 229, 72],
  [8, 18, 355, 26, 346, 29],
  [2, 13, 305, 157, 310, 161, 311, 166, 314, 169, 319, 169, 321, 171, 328, 171, 331, 174],
  [2, 16, 115, 238, 117, 237, 124, 243, 132, 243, 139, 239],
  [2, 16, 19, 214, 25, 215, 28, 217, 32, 223, 32, 227, 35, 230],
  [1.5, 12, 261, 250, 272, 250, 281, 252, 285, 258, 285, 262],
  [2, 16, 9, 383, 6, 390, 5, 398],
  [2, 9, 152, 217, 148, 221, 146, 230],
  [1.5, 24, 280, 286, 284, 297, 283, 302],
  [1.5, 12, 204, 31, 206, 34, 209, 34, 211, 36, 218, 38],
  [2, 18, 184, 248, 175, 250],
  [1.5, 22, 46, 445, 47, 449, 46, 457],
  [1, 23, 197, 214, 196, 215, 196, 226],
  [1, 8, 188, 234, 187, 235, 187, 245],
  [1, 8, 359, 114, 364, 114, 366, 112, 367, 115],
];
export const BOLTS_1: readonly (readonly number[])[] = [
  [40, 162, 125, 199, 128, 212, 156, 240, 166, 241, 170, 245, 173, 253, 173, 292, 185, 304, 185, 311],
  [19.5, 101, 174, 252, 177, 252, 186, 247, 190, 247, 217, 273, 219, 273, 226, 278, 235, 280, 245, 292, 245, 296, 251, 299, 254, 303, 256, 307, 256, 316, 261, 326],
  [20, 54, 152, 157, 155, 164, 154, 173, 156, 176, 156, 182, 176, 202, 179, 207, 178, 211, 179, 222],
  [22.5, 48, 187, 316, 197, 326, 201, 328, 209, 329, 220, 338, 227, 341, 228, 346],
  [16, 53, 185, 317, 184, 318, 185, 322, 211, 348, 216, 361, 217, 372],
  [17.5, 49, 178, 328, 180, 344, 198, 362, 198, 364, 201, 367, 201, 370, 205, 375, 205, 378],
  [16.5, 42, 155, 308, 148, 308, 127, 316, 113, 303, 104, 304, 102, 301],
  [6, 81, 255, 382, 255, 384, 260, 387, 261, 393, 264, 396, 270, 397, 272, 399, 284, 400, 293, 405, 293, 417, 296, 428, 306, 436, 310, 447, 320, 452, 322, 462],
  [19, 69, 201, 240, 220, 240, 229, 249, 235, 249],
  [12, 42, 98, 158, 101, 160, 101, 164, 105, 171, 105, 175, 109, 180, 112, 195, 117, 198, 124, 198],
  [4.5, 56, 80, 282, 84, 283, 87, 286, 87, 298, 89, 303, 92, 305, 92, 313, 95, 319, 100, 320, 105, 318, 110, 321, 108, 335, 103, 345, 107, 353, 107, 359, 103, 363, 103, 368, 96, 370],
  [5.5, 22, 155, 124, 155, 134, 157, 136, 157, 140, 164, 142, 167, 155, 171, 160, 170, 167, 171, 177, 185, 191],
  [6.5, 56, 102, 346, 95, 346, 86, 349, 82, 356, 78, 360, 73, 361, 71, 363, 71, 366, 68, 368, 62, 367, 57, 362, 51, 364],
  [7, 58, 250, 130, 249, 131, 250, 142, 247, 150, 248, 155, 253, 160, 252, 169, 245, 179, 238, 179],
  [4, 79, 302, 65, 300, 71, 300, 74, 302, 76, 295, 82, 295, 90, 290, 103, 290, 113, 286, 120, 286, 124, 279, 127, 278, 134, 271, 147],
  [6, 58, 230, 157, 235, 163, 233, 175, 237, 181, 236, 189, 231, 194, 228, 202, 227, 212],
  [4, 38, 116, 88, 120, 89, 122, 92, 123, 103, 125, 106, 125, 110, 127, 112, 128, 119, 130, 121, 131, 126, 132, 145, 136, 149, 136, 153, 140, 158, 143, 165, 145, 165, 149, 169],
  [4, 40, 198, 85, 198, 89, 201, 94, 201, 101, 203, 103, 203, 116, 204, 117, 204, 120, 200, 129, 200, 145, 199, 146, 200, 153, 198, 161, 199, 171],
  [10.5, 113, 66, 121, 73, 136, 81, 143, 84, 143],
  [5, 27, 189, 133, 187, 140, 187, 163, 185, 167, 185, 172, 192, 179, 193, 181, 192, 184],
  [5.5, 28, 166, 358, 166, 362, 161, 367, 159, 373, 161, 375, 159, 379, 159, 392, 161, 394, 161, 398],
  [3, 36, 258, 398, 259, 409, 261, 413, 261, 417, 263, 419, 261, 424, 261, 429, 265, 435, 265, 444, 263, 448, 263, 453, 267, 465],
  [2.5, 44, 23, 201, 29, 204, 35, 205, 39, 202, 50, 201, 55, 197, 59, 197, 64, 199, 68, 203, 70, 203, 72, 206, 80, 208, 82, 210, 97, 212, 103, 218],
  [5.5, 83, 63, 369, 61, 383, 57, 388, 53, 390, 47, 396, 46, 399],
  [3, 38, 51, 264, 57, 264, 61, 266, 63, 278, 71, 287, 70, 292, 63, 299, 61, 313],
  [2, 33, 183, 369, 182, 370, 182, 382, 178, 395, 179, 410, 176, 413, 173, 420, 173, 424, 176, 426, 176, 430, 179, 433, 174, 442],
  [5.5, 38, 93, 253, 94, 255, 99, 257, 106, 254, 110, 254, 113, 257, 117, 257],
  [2.5, 34, 208, 383, 209, 385, 207, 392, 207, 401, 211, 406, 217, 418, 217, 422, 219, 424],
  [2.5, 32, 68, 186, 70, 187, 71, 191, 76, 196, 83, 199, 92, 199, 98, 207, 98, 211],
  [2, 48, 268, 324, 280, 321, 284, 325, 285, 336, 287, 338, 285, 341, 285, 344, 288, 346, 288, 348, 291, 351, 290, 359],
  [2.5, 40, 279, 400, 278, 407, 284, 413, 283, 417, 285, 420, 285, 424, 288, 429, 293, 433, 295, 433],
  [3.5, 32, 127, 352, 126, 359, 119, 363, 117, 366, 116, 376],
  [2.5, 36, 281, 274, 277, 272, 273, 272, 270, 275, 265, 275, 259, 272, 253, 272, 248, 275, 242, 276],
  [2, 56, 85, 274, 88, 271, 90, 271, 95, 284, 99, 285, 103, 281, 105, 281, 109, 287, 112, 287],
  [3.5, 92, 37, 111, 46, 112, 57, 117],
  [8, 125, 247, 368, 248, 373, 251, 376],
  [1.5, 50, 313, 350, 313, 352, 316, 354, 316, 362, 310, 363, 305, 358, 304, 349, 300, 346, 296, 346],
  [7, 42, 227, 213, 230, 216, 237, 216],
  [7, 19, 134, 332, 131, 342],
  [2, 39, 211, 63, 207, 71, 206, 84, 203, 88, 203, 91],
  [4, 42, 260, 404, 270, 415],
  [2.5, 42, 88, 376, 88, 381, 90, 383, 91, 389, 85, 395],
  [3.5, 17, 276, 112, 276, 124, 279, 127],
  [1, 21, 230, 111, 228, 113, 228, 130, 230, 132, 231, 141, 229, 146, 230, 151],
  [3.5, 17, 52, 106, 55, 107, 56, 114, 58, 116],
  [6, 117, 264, 154, 257, 156],
  [1, 29, 321, 376, 316, 376, 311, 380, 307, 387, 307, 390, 309, 392, 309, 399, 307, 403, 307, 407],
  [2, 22, 258, 101, 258, 107, 254, 114, 254, 123],
  [1.5, 25, 147, 385, 148, 393, 145, 400, 144, 410],
  [1.5, 24, 276, 186, 274, 193, 275, 196, 287, 205],
  [1.5, 24, 294, 369, 292, 376, 292, 384, 294, 387, 293, 401],
  [3, 42, 55, 290, 62, 289, 67, 294],
  [1.5, 34, 329, 436, 324, 436, 319, 432, 315, 431, 306, 434],
  [2.5, 22, 179, 155, 180, 161, 185, 166],
  [1, 36, 79, 400, 76, 409, 76, 419, 78, 422, 77, 426],
  [2.5, 50, 248, 239, 252, 239, 256, 243, 260, 242],
  [1, 30, 24, 261, 28, 266, 30, 267, 33, 266, 39, 270, 39, 279],
  [2, 61, 315, 348, 317, 345, 321, 345, 324, 351],
  [1, 17, 181, 101, 181, 108, 187, 115, 185, 119, 185, 127],
  [3, 12, 294, 413, 302, 417],
  [1.5, 27, 59, 315, 53, 314, 50, 317, 42, 314],
  [1.5, 38, 318, 57, 317, 64, 313, 67, 312, 70, 308, 71],
  [1.5, 28, 202, 410, 201, 412, 202, 419, 200, 421, 200, 426],
  [1.5, 32, 129, 414, 128, 419, 131, 432],
  [3, 53, 255, 263, 257, 265, 262, 265],
  [2, 22, 99, 258, 100, 259, 99, 268],
  [1.5, 57, 24, 95, 28, 100, 33, 101],
  [1, 19, 309, 137, 309, 152, 310, 153],
  [2, 16, 91, 127, 91, 136],
  [2, 16, 172, 148, 173, 157],
  [1.5, 27, 141, 390, 140, 402],
  [1.5, 14, 84, 186, 84, 194, 86, 197],
  [1, 45, 311, 153, 320, 152, 322, 154, 325, 154],
  [1, 35, 303, 269, 302, 272, 299, 272, 295, 268, 291, 268],
  [1.5, 22, 262, 202, 257, 212],
  [1, 26, 213, 177, 213, 192],
  [1.5, 30, 49, 188, 52, 190, 52, 194, 54, 196],
  [1.5, 21, 330, 144, 326, 153],
  [1.5, 23, 271, 275, 275, 276, 279, 280],
  [1, 16, 283, 95, 281, 97, 282, 99, 281, 104],
  [1, 26, 123, 435, 123, 439, 118, 444],
  [1.5, 37, 293, 158, 289, 158, 286, 160],
  [1, 16, 105, 95, 96, 96],
  [1, 24, 327, 407, 331, 410, 333, 414],
  [1, 24, 221, 458, 219, 466],
  [1, 28, 17, 244, 20, 242, 22, 246],
  [1, 24, 283, 167, 283, 175],
  [1, 24, 335, 387, 335, 395],
  [1, 31, 24, 445, 29, 450],
];
/** The rock's pits: centre, radii, angle and depth. */
export const PITS: readonly (readonly number[])[] = [
  [144.9, 74.4, 12.8, 9.1, 1, 14.4],
  [240.6, 331.6, 13.4, 8.4, 1, 12.8],
  [304.7, 428.3, 12.2, 8.7, 1, 10.7],
  [273.4, 271.9, 11.8, 8.2, 1.4, 14.5],
  [341.5, 270.4, 16.4, 8.5, 1.1, 11.3],
  [54.5, 46.9, 11.3, 8, 1.3, 15.2],
  [179, 234.8, 11.7, 7.4, -1.4, 13.1],
  [338.5, 175.1, 16.7, 6.3, 1.2, 10.5],
  [113, 140.8, 10.8, 6.9, 0.3, 12.9],
  [335.3, 367.9, 9.3, 6.2, -1, 10.8],
  [308.6, 113.8, 9.6, 3.7, -0.2, 10.2],
  [251.7, 273.2, 7.5, 4.1, -1, 10.3],
  [223.4, 308.6, 7.6, 5.2, -0.4, 12.1],
  [121.1, 71, 6.7, 5.6, 1.1, 9.7],
  [314.6, 33.8, 6.6, 5, 0, 13.8],
  [191.7, 88.5, 5.4, 4, 1.2, 15.4],
  [142, 49.5, 7, 3.4, 1.4, 12.5],
  [161.9, 218.8, 6.7, 4, -0.5, 13.2],
  [314.9, 368.2, 6.4, 3.2, -1.1, 9.8],
  [243.3, 90.9, 6.6, 3.5, -0.3, 15.9],
  [16.1, 386.1, 6.9, 3.9, -0.8, 15.1],
  [43.8, 23.5, 5, 3.9, 0, 11.3],
  [17.6, 93, 4.7, 4, 1.5, 15],
  [44.2, 92.5, 4.6, 3.8, 1.2, 16.1],
  [362.6, 88.8, 4.7, 3.6, -1.3, 11.4],
  [219.3, 87.8, 4.5, 3.2, 1.3, 14.7],
  [153.6, 227, 5.9, 3.9, -1.1, 11.5],
  [183.2, 78.9, 5.2, 2.6, 0, 13.9],
  [228.7, 45.4, 5.4, 2.5, -0.8, 10.1],
  [187.1, 136.7, 6.1, 2.3, -0.2, 10.3],
  [329, 178.5, 4.1, 2.7, 0.6, 11.7],
  [283.6, 415.3, 4.6, 3, 0.6, 9.5],
];
/** Its cracks and drips: centre, half-length, half-width, angle and depth. */
export const STREAKS: readonly (readonly number[])[] = [
  [61, 115.9, 56.5, 6.3, 0, 11.4],
  [170, 113.7, 58.6, 6.6, -0.1, 14.2],
  [30.1, 446.5, 27.5, 2.4, -1.5, 18.8],
  [3.5, 412.8, 14.7, 2.3, -1.3, 25.3],
  [240.6, 62.6, 8.3, 2.1, -0.9, 10.3],
  [61.7, 380.5, 9.2, 2, -1.2, 12.9],
  [265.2, 80.4, 8, 2.3, -0.9, 16],
];

/** The red bolt's and the violet lightning's colours: halo, body, hot edge, core. */
const RED = { halo: [200, 0, 0], body: [228, 24, 12], hot: [255, 92, 64], core: [255, 238, 228] } as const;
const VIOLET = { halo: [96, 18, 150], body: [140, 50, 196], hot: [196, 130, 238], core: [246, 226, 255] } as const;
type Palette = typeof RED | typeof VIOLET;

/**
 * The burst's centre and reach in units across and lines down; inside its white heart (`heart`)
 * the measured lines are its glow's edge and are left out, and a line that ends within `roots` of
 * it is rooted in it, its glow at most `most`. The dark oval behind it.
 */
const BURST = { x: 184, y: 267, rx: 56, ry: 112, heart: [24, 44], roots: [96, 180], most: 5 } as const;
const OVAL = { x: 185, y: 250, rx: 118, ry: 215, colour: [34, 4, 14] } as const;
/** The rock's grain: its scales (in units, finest last) with their weights, and its tone. */
const GRAIN = { scales: [9, 4, 1.6], weights: [0.32, 0.56, 0.12], floor: 0.08, gain: 34, most: 32 } as const;
/** Pits past the screen's sides: as many per area as the original's, their sizes' ranges. */
const PIT_DENSITY = 32 / (368 * 448);

const rgba = ([r, g, b]: readonly number[], a: number): string => `rgba(${r}, ${g}, ${b}, ${a})`;

/** A seeded stream of numbers in [0, 1) (mulberry32). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise: a seeded lattice, smoothly interpolated, in [0, 1). */
function noise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const hash = (a: number, b: number): number => {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The rock's grain at half the display's resolution, the same rock wherever it is painted (it is computed in units). */
function paintGrain(g: Context, place: BackdropPlace, width: number, height: number): void {
  const [w, h] = [Math.ceil(width / 2), Math.ceil(height / 2)];
  const grain = new OffscreenCanvas(w, h);
  const gg = grain.getContext('2d');
  if (gg === null) return;
  const image = gg.createImageData(w, h);
  /* Round on the display: units across are wider than lines by kx / ky. */
  const across = Math.sqrt(place.kx / place.ky);
  for (let j = 0; j < h; j += 1) {
    const y = (BACKDROP.top + (j * 2 + 1) / place.ky) / across;
    for (let i = 0; i < w; i += 1) {
      const x = (place.from + (i * 2 + 1) / place.kx) * across;
      let n = 0;
      GRAIN.scales.forEach((scale, k) => {
        n += GRAIN.weights[k]! * noise(k * 7919 + 1, x / scale, y / scale);
      });
      const level = Math.max(0, Math.min(GRAIN.most, (n - GRAIN.floor) * GRAIN.gain));
      const o = (j * w + i) * 4;
      image.data[o] = level * 1.08;
      image.data[o + 1] = level;
      image.data[o + 2] = level * 0.96;
      image.data[o + 3] = 255;
    }
  }
  gg.putImageData(image, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(grain, 0, 0, w, h, place.left, place.top, w * 2, h * 2);
}

/** Drawing in the original's units and lines from here on (until the transform is restored). */
function inUnits(g: Context, place: BackdropPlace): void {
  g.setTransform(place.kx, 0, 0, place.ky, place.left - place.from * place.kx, place.top - BACKDROP.top * place.ky);
}

/** A pit: a dark hole fading at its edge, the rock's lip above and to its left catching the light. */
function paintPit(g: Context, x: number, y: number, rx: number, ry: number, angle: number, depth: number): void {
  const dark = Math.min(0.92, depth / 16);
  g.save();
  g.translate(x, y);
  g.save();
  g.translate(-0.6, -0.9);
  g.rotate(angle);
  g.scale(rx + 1.2, ry + 1.2);
  const lip = g.createRadialGradient(0, 0, 0.75, 0, 0, 1);
  lip.addColorStop(0, 'rgba(118, 110, 102, 0.22)');
  lip.addColorStop(1, 'rgba(118, 110, 102, 0)');
  g.fillStyle = lip;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.rotate(angle);
  g.scale(rx, ry);
  const hole = g.createRadialGradient(0.1, 0.15, 0, 0, 0, 1);
  hole.addColorStop(0, `rgba(0, 0, 0, ${dark})`);
  hole.addColorStop(0.7, `rgba(0, 0, 0, ${dark * 0.9})`);
  hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = hole;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A streak: a crack (long and narrow) drawn as a ragged dark seam, a drip as a soft dark run. */
function paintStreak(g: Context, x: number, y: number, half: number, wide: number, angle: number, depth: number, seed: number): void {
  const dark = Math.min(0.9, depth / 18);
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  if (half / wide > 6) {
    const next = stream(seed);
    g.beginPath();
    for (let u = -half; u <= half; u += 2.5) {
      const v = (next() - 0.5) * wide * 0.7;
      if (u === -half) g.moveTo(u, v);
      else g.lineTo(u, v);
    }
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = `rgba(0, 0, 0, ${dark * 0.55})`;
    g.lineWidth = wide * 1.5;
    g.stroke();
    g.strokeStyle = `rgba(0, 0, 0, ${dark})`;
    g.lineWidth = wide * 0.6;
    g.stroke();
  } else {
    g.scale(half, wide);
    const run = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    run.addColorStop(0, `rgba(0, 0, 0, ${dark})`);
    run.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = run;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** The rock: its grain, the original's pits and streaks, and pits of its own past the screen's sides. */
function paintRock(g: Context, place: BackdropPlace, width: number, height: number): void {
  paintGrain(g, place, width, height);
  inUnits(g, place);
  for (const [x, y, rx, ry, angle, depth] of PITS) paintPit(g, x!, y!, rx!, ry!, angle!, depth!);
  STREAKS.forEach(([x, y, half, wide, angle, depth], k) => paintStreak(g, x!, y!, half!, wide!, angle!, depth!, k + 1));
  for (const [from, to, seed] of [
    [place.from, 0, 11],
    [BACKDROP.width, place.to, 23],
  ] as const) {
    if (to <= from) continue;
    const next = stream(seed);
    const count = Math.round((to - from) * (BACKDROP.bottom - BACKDROP.top) * PIT_DENSITY);
    for (let k = 0; k < count; k += 1) {
      const x = seed === 11 ? to - next() * (to - from) : from + next() * (to - from);
      paintPit(g, x, BACKDROP.top + next() * (BACKDROP.bottom - BACKDROP.top), 4 + next() * 10, 3 + next() * 5, (next() - 0.5) * 3, 10 + next() * 6);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

type Point = readonly [number, number];

/**
 * A bolt that leaves the screen at its left or right side runs on toward the window's edge: on in
 * the way it left, wandering, its glow thinning a little each step.
 */
function runOn(points: readonly Point[], place: BackdropPlace, seed: number): Point[] {
  const [x, y] = points[points.length - 1]!;
  const outward = x <= 1.5 ? -1 : x >= BACKDROP.width - 1.5 ? 1 : 0;
  if (outward === 0 || (outward < 0 ? place.from >= 0 : place.to <= BACKDROP.width)) return [];
  const back = points[Math.max(0, points.length - 4)]!;
  let angle = Math.atan2(y - back[1], x - back[0]);
  const ahead = outward < 0 ? Math.PI : 0;
  const next = stream(seed);
  const run: Point[] = [];
  let [px, py] = [x, y];
  while (outward < 0 ? place.from - 4 < px : px < place.to + 4) {
    /* Pulled back toward straight out, so it never turns back in. */
    let turn = angle - ahead;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    angle = ahead + Math.max(-1.1, Math.min(1.1, turn * 0.7 + (next() - 0.5) * 1.1));
    const step = 4 + next() * 5;
    [px, py] = [px + Math.cos(angle) * step, Math.max(BACKDROP.top, Math.min(BACKDROP.bottom, py + Math.sin(angle) * step))];
    run.push([px, py]);
  }
  return run;
}

/** A centreline in device pixels, broken into short jagged steps across it. */
function jagged(points: readonly Point[], place: BackdropPlace, unit: number, seed: number): Point[] {
  const next = stream(seed);
  const device = points.map(([x, y]): Point => [place.left + (x - place.from) * place.kx, place.top + (y - BACKDROP.top) * place.ky]);
  const out: Point[] = [device[0]!];
  for (let i = 1; i < device.length; i += 1) {
    const [a, b] = [device[i - 1]!, device[i]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(length / (1.7 * unit)));
    const [nx, ny] = length > 0 ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0];
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const off = k < steps ? (next() - 0.5) * 0.9 * unit : 0;
      out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    }
  }
  return out;
}

/** Within the burst's ellipse of radii `r` (in units across and lines down) of its centre: how far, 1 on its edge. */
const fromBurst = ([x, y]: Point, [rx, ry]: readonly number[]): number => Math.hypot((x - BURST.x) / rx!, (y - BURST.y) / ry!);

/**
 * A line around the burst: what lies in its white heart left out (the measured glow's edge), and
 * when its nearer end is within reach a root from the heart to it, wandering out in a few steps.
 */
function rooted(line: readonly Point[], seed: number): Point[] {
  const outside = line.filter((p) => fromBurst(p, BURST.heart) > 1);
  if (outside.length < 2) return [];
  const [first, last] = [outside[0]!, outside[outside.length - 1]!];
  const out = fromBurst(first, BURST.heart) <= fromBurst(last, BURST.heart) ? outside : outside.slice().reverse();
  const end = out[0]!;
  if (fromBurst(end, BURST.roots) > 1) return out;
  const next = stream(seed);
  const root: Point[] = [];
  const steps = 5;
  const [dx, dy] = [end[0] - BURST.x, end[1] - BURST.y];
  const length = Math.hypot(dx, dy) || 1;
  for (let k = 1; k < steps; k += 1) {
    const t = k / steps;
    const off = (next() - 0.5) * 0.35 * length * Math.sin(t * Math.PI);
    root.push([BURST.x + dx * t - (dy / length) * off, BURST.y + dy * t + (dx / length) * off]);
  }
  return [[BURST.x, BURST.y], ...root, ...out];
}

/**
 * The bolts, glowing: drawn in passes into a layer of their own, widest first (a halo, blurred
 * soft; the body; its hot edge; where the original's runs white, the core), each pass opaque so
 * that where lines meet or overlap nothing builds up; the layer then added onto the picture.
 * Around the burst, each line is rooted in it.
 */
function paintBolts(g: Context, bolts: readonly (readonly number[])[], colours: Palette, place: BackdropPlace, burst = false): void {
  const unit = Math.sqrt(place.kx * place.ky);
  const lines: { glow: number; core: number; points: Point[] }[] = [];
  bolts.forEach((bolt, n) => {
    let centre: Point[] = [];
    for (let i = 2; i + 1 < bolt.length; i += 2) centre.push([bolt[i]!, bolt[i + 1]!]);
    if (burst) centre = rooted(centre, n + 307);
    if (centre.length < 2) return;
    /* Around the burst a wide glow is its heart's, not a line's. */
    const glow = burst ? Math.min(bolt[0]!, BURST.most) : bolt[0]!;
    lines.push({ glow, core: bolt[1]!, points: jagged([...centre, ...runOn(centre, place, n + 101)], place, unit, n + 1) });
  });
  const { width, height } = g.canvas;
  const layer = new OffscreenCanvas(width, height);
  const lg = layer.getContext('2d');
  const halo = new OffscreenCanvas(width, height);
  const hg = halo.getContext('2d');
  if (lg === null || hg === null) return;
  const pass = (target: Context, colour: readonly number[], width: (glow: number) => number, only: (core: number) => boolean = () => true): void => {
    target.lineJoin = 'round';
    target.lineCap = 'round';
    target.strokeStyle = rgba(colour, 1);
    for (const line of lines) {
      if (!only(line.core)) continue;
      target.lineWidth = width(line.glow) * unit;
      target.beginPath();
      line.points.forEach(([x, y], i) => (i === 0 ? target.moveTo(x, y) : target.lineTo(x, y)));
      target.stroke();
    }
  };
  pass(hg, colours.halo, (glow) => glow * 2.7);
  lg.filter = `blur(${Math.max(1, 3 * unit)}px)`;
  lg.globalAlpha = 0.55;
  lg.drawImage(halo, 0, 0);
  lg.filter = `blur(${Math.max(0.6, 0.5 * unit)}px)`;
  lg.globalAlpha = 1;
  hg.clearRect(0, 0, width, height);
  pass(hg, colours.body, (glow) => Math.max(1.4, glow * 1.05));
  lg.drawImage(halo, 0, 0);
  lg.filter = 'none';
  pass(lg, colours.hot, (glow) => Math.max(0.75, glow * 0.4));
  pass(lg, colours.core, (glow) => Math.max(0.5, glow * 0.18), (core) => core > 100);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.drawImage(layer, 0, 0);
  g.restore();
}

/** The violet burst's dark oval behind it, and its white-hot heart. */
function paintBurst(g: Context, place: BackdropPlace, heart: boolean): void {
  inUnits(g, place);
  g.save();
  if (heart) {
    g.globalCompositeOperation = 'lighter';
    g.translate(BURST.x, BURST.y);
    g.scale(BURST.rx, BURST.ry);
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.22, 'rgba(255, 250, 255, 0.95)');
    glow.addColorStop(0.36, 'rgba(236, 170, 250, 0.7)');
    glow.addColorStop(0.62, 'rgba(160, 60, 210, 0.28)');
    glow.addColorStop(1, 'rgba(90, 20, 140, 0)');
    g.fillStyle = glow;
  } else {
    g.translate(OVAL.x, OVAL.y);
    g.scale(OVAL.rx, OVAL.ry);
    const oval = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    oval.addColorStop(0, rgba(OVAL.colour, 1));
    oval.addColorStop(0.7, rgba(OVAL.colour, 0.6));
    oval.addColorStop(1, rgba(OVAL.colour, 0));
    g.fillStyle = oval;
  }
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** Each portrait's column added in: from nothing at its top to its colour, then to light grey at its foot. */
function paintColumns(g: Context, place: BackdropPlace, columns: readonly Column[]): void {
  inUnits(g, place);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const { x, y, colour } of columns) {
    const c = [colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff];
    const left = x + COLUMN.left;
    const upper = g.createLinearGradient(0, y + COLUMN.top, 0, y + COLUMN.full);
    upper.addColorStop(0, 'rgba(0, 0, 0, 1)');
    upper.addColorStop(1, rgba(c, 1));
    g.fillStyle = upper;
    g.fillRect(left, y + COLUMN.top, COLUMN.width, COLUMN.full - COLUMN.top);
    const lower = g.createLinearGradient(0, y + COLUMN.full, 0, y + COLUMN.end);
    lower.addColorStop(0, rgba(c, 1));
    lower.addColorStop(1, rgba([COLUMN.grey, COLUMN.grey, COLUMN.grey], 1));
    g.fillStyle = lower;
    g.fillRect(left, y + COLUMN.full, COLUMN.width, COLUMN.end - COLUMN.full);
  }
  g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** The span a backdrop covers: the units across it and the device pixels per unit, which with its picture name its painting. */
export type BackdropSpan = Pick<BackdropPlace, 'from' | 'to' | 'kx' | 'ky'>;

/**
 * Each backdrop without its columns, painted once for the span the window gives it: a canvas of
 * its own, its bolts' glow layers its size rather than the whole atlas's, and left on the GPU,
 * where the glows' blurs are quick. Only the window's current span is kept.
 */
const bases = new Map<string, OffscreenCanvas>();

function backdropBase(picture: number, span: BackdropSpan): OffscreenCanvas {
  const key = `${picture} ${span.from} ${span.to} ${span.kx} ${span.ky}`;
  const found = bases.get(key);
  if (found !== undefined) return found;
  for (const other of [...bases.keys()]) if (other.slice(other.indexOf(' ')) !== key.slice(key.indexOf(' '))) bases.delete(other);
  const width = (span.to - span.from) * span.kx;
  const height = (BACKDROP.bottom - BACKDROP.top) * span.ky;
  const canvas = new OffscreenCanvas(Math.ceil(width), Math.ceil(height));
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('no 2D context for a versus backdrop');
  const place = { ...span, left: 0, top: 0 };
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  if (picture === 0) {
    paintRock(g, place, width, height);
    paintBolts(g, BOLTS_0, RED, place);
  } else {
    paintBurst(g, place, false);
    paintBolts(g, BOLTS_1, VIOLET, place, true);
    paintBurst(g, place, true);
  }
  bases.set(key, canvas);
  return canvas;
}

/**
 * Both backdrops painted ahead for a span, so the versus screen's first full frame only adds its
 * columns: painted there, they held that frame 150 to 180 ms, which cut the character select's
 * dissolve short.
 */
export function paintBackdropsAhead(span: BackdropSpan): void {
  backdropBase(0, span);
  backdropBase(1, span);
}

/** Backdrop `picture` (0 the red bolt, 1 the violet burst) painted over `place`, the portraits' columns added in. */
export function paintBackdrop(g: Context, picture: number, place: BackdropPlace, columns: readonly Column[]): void {
  const width = (place.to - place.from) * place.kx;
  const height = (BACKDROP.bottom - BACKDROP.top) * place.ky;
  g.save();
  g.beginPath();
  g.rect(place.left, place.top, width, height);
  g.clip();
  g.drawImage(backdropBase(picture, place), place.left, place.top);
  paintColumns(g, place, columns);
  g.restore();
}
