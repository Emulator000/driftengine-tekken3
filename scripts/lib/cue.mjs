/**
 * A disc image's cue sheet: its tracks and where each starts in the image. Times are minutes,
 * seconds and frames (75 a second) from the image's start; a PREGAP is silence the image does not
 * hold, so it moves nothing in the file.
 */

/** "mm:ss:ff" as sectors. */
const sectors = (time) => {
  const [m, s, f] = time.split(':').map(Number);
  return (m * 60 + s) * 75 + f;
};

/** The tracks of a cue sheet's text: number, type (`MODE2/2352`, `AUDIO`), and their indexes as image sectors. */
export function parseCue(text) {
  const tracks = [];
  for (const line of text.split(/\r?\n/)) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'TRACK') tracks.push({ number: Number(words[1]), type: words[2], indexes: new Map() });
    else if (words[0] === 'INDEX' && tracks.length > 0) tracks.at(-1).indexes.set(Number(words[1]), sectors(words[2]));
  }
  return tracks;
}

/**
 * Each audio track's sectors in the image: from its index 1 to where the next track begins (its
 * index 0 when the image holds that pregap, else its index 1), the last to the image's end.
 */
export function audioTracks(tracks, imageSectors) {
  return tracks.flatMap((track, i) => {
    if (track.type !== 'AUDIO') return [];
    const next = tracks[i + 1];
    const end = next === undefined ? imageSectors : (next.indexes.get(0) ?? next.indexes.get(1));
    return [{ number: track.number, start: track.indexes.get(1), end }];
  });
}

/** The files a cue sheet names, each with its tracks (their indexes in sectors from that file's start). */
export function cueFiles(text) {
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const file = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
    if (file !== null) {
      files.push({ name: file[1] ?? file[2], tracks: [] });
      continue;
    }
    const words = line.trim().split(/\s+/);
    const tracks = files.at(-1)?.tracks;
    if (tracks === undefined) continue;
    if (words[0] === 'TRACK') tracks.push({ number: Number(words[1]), type: words[2], indexes: new Map(), pregap: null });
    else if (words[0] === 'INDEX' && tracks.length > 0) tracks.at(-1).indexes.set(Number(words[1]), sectors(words[2]));
    else if (words[0] === 'PREGAP' && tracks.length > 0) tracks.at(-1).pregap = words[1];
  }
  return files;
}

/** Sectors as "mm:ss:ff". */
const time = (n) => [Math.floor(n / 4500), Math.floor(n / 75) % 60, n % 75].map((v) => String(v).padStart(2, '0')).join(':');

/**
 * The cue sheet of one image made of `files` joined in order (one file a track, as many ripping
 * tools write a disc), named `image`: each track's indexes moved on by the sectors of the files
 * before it.
 */
export function joinedCue(files, sizes, image) {
  const lines = [`FILE "${image}" BINARY`];
  let base = 0;
  files.forEach((file, i) => {
    for (const track of file.tracks) {
      lines.push(`  TRACK ${String(track.number).padStart(2, '0')} ${track.type}`);
      if (track.pregap !== null) lines.push(`    PREGAP ${track.pregap}`);
      for (const [index, at] of [...track.indexes].sort((a, b) => a[0] - b[0])) lines.push(`    INDEX ${String(index).padStart(2, '0')} ${time(base + at)}`);
    }
    base += sizes[i] / 2352;
  });
  return lines.join('\n') + '\n';
}
