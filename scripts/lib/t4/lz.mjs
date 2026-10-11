/**
 * Tekken 4's LZ, which packs its IOP module bundle and its movesets: a flag byte
 * read low bit first until only its marker bit is left, a set bit a literal byte, a clear bit a
 * big-endian pair of 5 bits of length (0 meaning 32) and 11 of distance back (0 meaning 2048). A
 * flag byte of 0 ends the stream.
 */
export function unpackLz(bytes, start = 0) {
  const out = [];
  let at = start;
  let flags = bytes[at++];
  while (flags !== 0) {
    if (flags < 2) {
      flags = bytes[at++];
      continue;
    }
    while (flags > 1) {
      const literal = flags & 1;
      flags >>= 1;
      if (literal) out.push(bytes[at++]);
      else {
        const pair = (bytes[at] << 8) | bytes[at + 1];
        at += 2;
        const distance = pair & 0x7ff || 0x800;
        const length = pair >> 11 || 0x20;
        for (let i = 0; i < length; i += 1) out.push(out[out.length - distance]);
      }
    }
    flags = bytes[at++];
  }
  return Uint8Array.from(out);
}
