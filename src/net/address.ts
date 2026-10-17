/**
 * The addresses a page tries for its online server, in turn until one opens. Typed with its way
 * (`ws://`, `wss://`, or `http://` and `https://` for theirs), as it is. A bare `host:port` tried the
 * page's own way first and then the other: secure then plain on a secure page (an app's, whose
 * server on a home network has no certificate), plain then secure on a plain one (a server that has
 * one). None typed, the server beside the page (`/relay` on its own address), where one can run: not
 * beside an app's page, which no server serves.
 */

/** The Android app's own origin, which its files are served on, and which no server runs beside. */
const APP_HOST = 'appassets.androidplatform.net';

export function serverAddresses(typed: string, page: { readonly protocol: string; readonly host: string }): string[] {
  const raw = typed.trim();
  const secure = page.protocol === 'https:';
  if (raw === '') return (page.protocol === 'http:' || secure) && page.host !== APP_HOST ? [`${secure ? 'wss' : 'ws'}://${page.host}/relay`] : [];
  if (/^wss?:\/\//i.test(raw)) return [raw];
  if (/^https?:\/\//i.test(raw)) return [raw.replace(/^http/i, 'ws')];
  return secure ? [`wss://${raw}`, `ws://${raw}`] : [`ws://${raw}`, `wss://${raw}`];
}
