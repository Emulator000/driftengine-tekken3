/**
 * Tekken 4's 2D pictures: TIM2 files (the select's portraits in file 118, its face icons in 112),
 * as the PS2 keeps them. A file is the magic, a version and format, a count, then each picture: its
 * sizes, palette size and colour count, the palette's and the image's kinds, width and height, GS
 * registers, the image and then its palette. Indexed images of 8 bits keep their palette in the GS's
 * CSM1 order, which swaps the third and second eight of every thirty-two; alpha runs to 0x80.
 */

/** Every picture of every TIM2 in `bytes`, as RGBA rows. */
export function readTim2Pictures(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pictures = [];
  for (let start = find(bytes, 0); start >= 0; start = find(bytes, start + 4)) {
    const count = view.getUint16(start + 6, true);
    let at = start + 16;
    for (let k = 0; k < count; k += 1) {
      const total = view.getUint32(at, true);
      const paletteBytes = view.getUint32(at + 4, true);
      const imageBytes = view.getUint32(at + 8, true);
      const header = view.getUint16(at + 12, true);
      const colours = view.getUint16(at + 14, true);
      const paletteKind = bytes[at + 18];
      const imageKind = bytes[at + 19];
      const width = view.getUint16(at + 20, true);
      const height = view.getUint16(at + 22, true);
      const image = bytes.subarray(at + header, at + header + imageBytes);
      const palette = readPalette(bytes.subarray(at + header + imageBytes, at + header + imageBytes + paletteBytes), colours, paletteKind, imageKind);
      pictures.push({ width, height, rgba: decode(image, palette, width, height, imageKind) });
      at += total;
    }
  }
  return pictures;
}

function find(bytes, from) {
  for (let i = from; i + 4 <= bytes.length; i += 1) if (bytes[i] === 0x54 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x4d && bytes[i + 3] === 0x32) return i;
  return -1;
}

const alpha = (a) => Math.min(255, a * 2);

function readPalette(bytes, count, kind, imageKind) {
  const palette = [];
  for (let i = 0; i < count; i += 1) {
    if ((kind & 0x1f) === 3) palette.push([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], alpha(bytes[i * 4 + 3])]);
    else if ((kind & 0x1f) === 2) palette.push([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2], 255]);
    else {
      const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
      palette.push([(v & 31) * 8, ((v >> 5) & 31) * 8, ((v >> 10) & 31) * 8, v & 0x8000 ? 255 : 0]);
    }
  }
  if (imageKind === 5 && (kind & 0x80) === 0) {
    for (let block = 0; block + 32 <= palette.length; block += 32) {
      for (let i = 0; i < 8; i += 1) [palette[block + 8 + i], palette[block + 16 + i]] = [palette[block + 16 + i], palette[block + 8 + i]];
    }
  }
  return palette;
}

function decode(image, palette, width, height, kind) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    let c;
    if (kind === 5) c = palette[image[i]];
    else if (kind === 4) c = palette[i & 1 ? image[i >> 1] >> 4 : image[i >> 1] & 15];
    else if (kind === 3) c = [image[i * 4], image[i * 4 + 1], image[i * 4 + 2], alpha(image[i * 4 + 3])];
    else if (kind === 2) c = [image[i * 3], image[i * 3 + 1], image[i * 3 + 2], 255];
    else {
      const v = image[i * 2] | (image[i * 2 + 1] << 8);
      c = [(v & 31) * 8, ((v >> 5) & 31) * 8, ((v >> 10) & 31) * 8, v & 0x8000 ? 255 : 0];
    }
    rgba.set(c ?? [255, 0, 255, 255], i * 4);
  }
  return rgba;
}
