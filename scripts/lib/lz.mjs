/**
 * The game's LZ compression, decoded over byte arrays: a flag byte's bits, low
 * first, read 1 as a literal byte and 0 as a big-endian pair (eleven bits back, five bits of count,
 * 0 meaning 0x800 and 0x20); the flag's last set bit marks its end, and a zero flag the stream's.
 */
export function decompress(bytes, from) {
  const out = [];
  let src = from;
  let flags = bytes[src];
  for (;;) {
    src += 1;
    if (flags === 0) break;
    for (let f = flags; 1 < f; f >>= 1) {
      if ((f & 1) === 0) {
        const pair = bytes[src] * 0x100 + bytes[src + 1];
        src += 2;
        const back = (pair & 0x7ff) || 0x800;
        const count = pair >> 11 || 0x20;
        for (let k = 0; k < count; k += 1) out.push(out[out.length - back]);
      } else {
        out.push(bytes[src]);
        src += 1;
      }
    }
    flags = bytes[src];
  }
  return Uint8Array.from(out);
}
