/**
 * The music's tables for the driver the presentation runs: per song (32) its two picks, the
 * arrangement's and the arcade's (`0x80024fd0`, two bytes a pick: the XA song, or with bit 7 the
 * disc's audio track; then its volume, bit 7 to loop); per XA song its first and end sectors on the
 * disc (`0x80024d78`, twelve bytes a song: first, end, channel), which the driver measures its
 * place against; the music set and stereo options as the game powers on (`0x80097f05`,
 * `0x80097f04`); the music's volume option, which the driver sets to 127; and the disc's audio
 * tracks' lengths, which tell the driver when one is over.
 */
const PICKS = 0x80024fd0;
const SONGS = 32;
const XA_SONGS = 0x80024d78;
const MUSIC_SET = 0x80097f05;
const STEREO = 0x80097f04;
const MUSIC_VOLUME = 0x7f;

/** `tracks` the disc's audio tracks as the extraction found them (its manifest's): each one's number and sectors. */
export function musicTables(exe, tracks) {
  const pick = (at) => {
    const which = exe.u8(at);
    const volume = exe.u8(at + 1);
    return { xa: which & 0x7f, track: (which & 0x80) !== 0, volume: volume & 0x7f, loops: (volume & 0x80) !== 0 };
  };
  const picks = Array.from({ length: SONGS }, (_, song) => [pick(PICKS + song * 4), pick(PICKS + song * 4 + 2)]);
  const xaCount = Math.max(...picks.flat().filter((p) => !p.track).map((p) => p.xa)) + 1;
  return {
    picks,
    xaSongs: Array.from({ length: xaCount }, (_, xa) => ({ first: exe.u32(XA_SONGS + xa * 12), end: exe.u32(XA_SONGS + xa * 12 + 4) })),
    tracks: tracks.map(({ track, sectors }) => ({ track, sectors })),
    set: exe.u8(MUSIC_SET),
    stereo: exe.u8(STEREO),
    volume: MUSIC_VOLUME,
  };
}
