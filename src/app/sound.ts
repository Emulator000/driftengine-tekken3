/**
 * The game's sound for the page: the banks and the music's tables loaded, the player made, and
 * woken by the first key, click or touch (the browser's rule for audio, which counts a touch as it
 * ends). Null where the browser gives no audio; the game plays on silent.
 */
import { loadPlayableBanks, parseMusicTables } from '../assets/playback.ts';
import { SoundPlayer } from '../present/sound/player.ts';
import { assetBytes, dataBytes, json, two } from './page.ts';

export async function startSound(): Promise<SoundPlayer | null> {
  try {
    const [banks, music] = await Promise.all([loadPlayableBanks(await json('sound/banks.json'), (file) => assetBytes(`sound/banks/${file}`)), json('sound/music.json').then((m) => parseMusicTables(m))]);
    const player = await SoundPlayer.create(
      banks,
      music,
      (xa) => dataBytes(`music/${two(xa)}.xa`),
      (track) => dataBytes(`music/track${two(track)}.pcm`),
    );
    if (player === null) return null;
    const wake = (): void => player.wake();
    for (const event of ['keydown', 'pointerdown', 'pointerup', 'touchend']) window.addEventListener(event, wake);
    return player;
  } catch (error) {
    console.error('[tekken3] sound:', error);
    return null;
  }
}
