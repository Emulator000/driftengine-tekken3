/**
 * The game's executable as the importer reads it: a PS-X EXE whose header gives the address its
 * image loads at (+0x18) and the image's length (+0x1c), the image from byte 0x800.
 */
export function openExecutable(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = view.getUint32(0x18, true);
  const length = view.getUint32(0x1c, true);
  const at = (address) => {
    const offset = address - base;
    if (offset < 0 || offset >= length) throw new Error(`0x${address.toString(16)} is outside the executable's image`);
    return 0x800 + offset;
  };
  return {
    u8: (address) => view.getUint8(at(address)),
    s8: (address) => view.getInt8(at(address)),
    s16: (address) => view.getInt16(at(address), true),
    u16: (address) => view.getUint16(at(address), true),
    u32: (address) => view.getUint32(at(address), true),
  };
}
