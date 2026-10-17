/**
 * The server's public page, for a browser opened on its address, drawn as the game's own mode
 * select: the server's name in the menus' gold, a lamp lit green while it answers, its live
 * numbers as the menu's lines with the selection band across the first, the round timer's numerals for the counts, the explanation in
 * boxes framed as the Options' are, all on a television's black under its scanlines. It says how
 * busy the server is (the players on it, the fights on now, the quick match's queue, the rooms
 * waiting and those listed), the game's versions it serves and those being played, its own
 * version, and how to play on it from a copy of the game, and that it is an unofficial server,
 * affiliated with none of the game's rights holders. It shows no player's address. The
 * numbers come from `status.json` beside it, read again every few seconds; a room's title and its
 * host's name are put in as text, never as markup. Its letters are the game's own two faces, served
 * by the server (`fonts/`), the system's where they are not installed.
 */

/** The page, given the path it is served on (`root`, ending in `/`) and the address a game types to play here (`address`). */
export function panelPage({ root, address }) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tekken 3 online server</title>
<style>
  @font-face { font-family: "Russo One"; src: url("${root}fonts/russo-one.woff2") format("woff2"); font-display: swap; }
  @font-face { font-family: "Saira Extra Condensed"; font-weight: 500; src: url("${root}fonts/saira-500.woff2") format("woff2"); font-display: swap; }
  @font-face { font-family: "Saira Extra Condensed"; font-weight: 900; src: url("${root}fonts/saira-900.woff2") format("woff2"); font-display: swap; }
  :root {
    --screen: #000000;
    --gold-top: #fff3c4; --gold: #f6b93b; --gold-foot: #c2611a; --gold-edge: #241000;
    --band: #c1121f; --band-light: #ff5263;
    --steel-top: #ffffff; --steel-foot: #8f9aa3; --steel-edge: #0b0e12;
    --navy: #0b1d44; --navy-deep: #040b1e; --frame: #7f9cc6;
    --text: #e8e2d4; --quiet: #9d9786;
    --menu: "Russo One", "Arial Black", sans-serif;
    --digits: "Saira Extra Condensed", "Arial Narrow", sans-serif;
  }
  * { box-sizing: border-box; }
  html { background: var(--screen); }
  body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse 120% 90% at 50% 0%, #1a0b06 0%, var(--screen) 55%); color: var(--text); font: 500 20px/1.45 var(--digits); letter-spacing: 0.01em; }
  /* The television: fine scanlines over everything and its corners darkened. */
  body::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 10; background: repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0) 0 2px, rgba(0, 0, 0, 0.1) 2px 3px), radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.55) 100%); }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 56px; }

  /* The menus' letters: slanted capitals, gold running to orange, a dark edge. */
  .menu { font-family: var(--menu); font-weight: 400; text-transform: uppercase; letter-spacing: 0.02em; transform: skewX(-9deg); background: linear-gradient(180deg, var(--gold-top) 0%, var(--gold) 48%, var(--gold-foot) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 1px var(--gold-edge); paint-order: stroke fill; }
  h1 { margin: 0; text-align: center; font-size: clamp(34px, 8vw, 64px); line-height: 1.05; filter: drop-shadow(0 3px 0 #3a1200) drop-shadow(0 0 18px rgba(246, 185, 59, 0.25)); }
  .kind { margin: 10px 0 0; text-align: center; color: var(--quiet); font-size: 17px; }
  .motd { margin: 6px 0 0; text-align: center; color: var(--text); }
  /* A cabinet's lamp: green while the server answers, flaring at each answer, red when it does not. */
  .live { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 12px 0 0; color: var(--quiet); font-size: 17px; }
  .lamp { flex: none; width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #d8d8d8 0 10%, #6b6b6b 40%, #1e1e1e 100%); box-shadow: 0 0 0 2px #000, inset 0 -2px 3px rgba(0, 0, 0, 0.5); }
  .live.up .lamp { background: radial-gradient(circle at 35% 30%, #f0fff2 0 10%, #3ee667 38%, #0a6a23 100%); box-shadow: 0 0 0 2px #000, 0 0 12px 2px rgba(62, 230, 103, 0.55); }
  .live.up .lamp.beat { animation: flare 0.7s ease-out; }
  .live.up .state { color: #7ef09a; }
  .live.down .lamp { background: radial-gradient(circle at 35% 30%, #ffe9ea 0 10%, var(--band-light) 38%, #6a0710 100%); box-shadow: 0 0 0 2px #000, 0 0 12px 2px rgba(255, 82, 99, 0.5); }
  .live.down .state { color: var(--band-light); }
  @keyframes flare { from { filter: brightness(1.7); box-shadow: 0 0 0 2px #000, 0 0 22px 6px rgba(62, 230, 103, 0.8); } }

  /* The numbers as the menu's lines, the first on the selection band. */
  .lines { list-style: none; margin: 36px 0 0; padding: 0; }
  .lines li { position: relative; isolation: isolate; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: clamp(52px, 10vw, 72px); padding: 0 28px; }
  .lines .label { font-size: clamp(20px, 4.4vw, 30px); line-height: 1; }
  .lines .count { font-family: var(--digits); font-weight: 900; font-size: clamp(34px, 7vw, 52px); line-height: 1; padding-top: 0.06em; font-variant-numeric: tabular-nums; background: linear-gradient(180deg, var(--steel-top) 0%, #eef1f3 45%, var(--steel-foot) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 1.5px var(--steel-edge); paint-order: stroke fill; }
  .lines li.picked::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, var(--band-light) 0 1px, transparent 1px calc(100% - 1px), var(--band-light) calc(100% - 1px)), linear-gradient(90deg, transparent 0%, var(--band) 12%, #7a0a14 50%, var(--band) 88%, transparent 100%); transform-origin: center; animation: band 0.5s ease-out both; }
  @keyframes band { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }

  /* The explanations in boxes framed as the Options' are. */
  .box { margin-top: 32px; padding: 18px 22px 20px; background: linear-gradient(180deg, var(--navy) 0%, var(--navy-deep) 100%); border: 2px solid var(--frame); outline: 2px solid #000; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
  .box h2 { margin: 0 0 12px; font-size: 22px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
  .pair .box { margin-top: 20px; }
  ol { margin: 0; padding: 0; list-style: none; counter-reset: step; }
  ol li { counter-increment: step; position: relative; padding-left: 40px; margin: 12px 0; }
  ol li::before { content: counter(step); position: absolute; left: 0; top: -6px; font-family: var(--digits); font-weight: 900; font-size: 34px; line-height: 1; color: var(--steel-top); -webkit-text-stroke: 1px var(--steel-edge); }
  ul.plain { margin: 0; padding: 0; list-style: none; }
  ul.plain li { padding: 2px 0; }
  .empty { color: var(--quiet); }
  b, .game { font-family: var(--menu); font-weight: 400; font-size: 0.86em; letter-spacing: 0.02em; color: var(--gold); }
  .note { margin: 14px 0 0; color: var(--quiet); font-size: 17px; }
  a { color: var(--gold); text-underline-offset: 3px; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--gold-top); outline-offset: 3px; }

  /* SERVER's text field as the game shows it, its caret blinking. */
  .field { display: flex; align-items: stretch; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
  .entry { flex: 1 1 260px; min-width: 0; padding: 8px 12px; background: #000; border: 2px solid var(--steel-foot); font-family: var(--menu); font-size: 18px; color: #fff; overflow-wrap: anywhere; }
  .entry::after { content: "_"; color: var(--gold); animation: caret 1s steps(1) infinite; }
  @keyframes caret { 50% { opacity: 0; } }
  button { font-family: var(--menu); font-size: 16px; text-transform: uppercase; color: #fff; background: linear-gradient(180deg, var(--band-light), var(--band) 55%, #7a0a14); border: 2px solid #000; padding: 6px 16px; cursor: pointer; }
  button:active { transform: translateY(1px); }

  footer { max-width: 64ch; margin: 36px auto 0; color: var(--quiet); font-size: 16px; text-align: center; }
  footer p { margin: 0 0 10px; }

  @media (max-width: 640px) {
    .pair { grid-template-columns: 1fr; }
    .lines li { padding: 6px 14px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .lines li.picked::before, .entry::after, .live.up .lamp.beat { animation: none; }
  }
</style>
</head>
<body>
<main>
  <h1 class="menu" id="name">Tekken 3 server</h1>
  <p class="kind">An unofficial online server for <a href="https://github.com/Emulator000/driftengine-tekken3" rel="noopener">Tekken 3 on DriftEngine</a></p>
  <p class="motd" id="motd" hidden></p>
  <p class="live" id="live"><span class="lamp" id="lamp"></span><span class="state" id="state">Reading the server…</span></p>

  <ul class="lines">
    <li class="picked"><span class="label menu">Players online</span><span class="count" id="players">–</span></li>
    <li><span class="label menu">Fights now</span><span class="count" id="fights">–</span></li>
    <li><span class="label menu">In the quick match</span><span class="count" id="queued">–</span></li>
    <li><span class="label menu">Rooms waiting</span><span class="count" id="rooms">–</span></li>
  </ul>

  <section class="box">
    <h2 class="menu">Play here</h2>
    <ol>
      <li>Set up the game from your own Tekken 3 disc (USA, SLUS-00402) as the
        <a href="https://github.com/Emulator000/driftengine-tekken3#getting-started" rel="noopener">project's README</a> explains: in a browser, or as the desktop or Android app.</li>
      <li>Open <span class="game">ONLINE MODE</span> (in the mode menu, after <span class="game">VS MODE</span>), choose <span class="game">SERVER</span> and enter:
        <div class="field"><div class="entry" id="address"></div><button type="button" id="copy">Copy</button></div></li>
      <li>Choose <span class="game">QUICK MATCH</span> to meet the next player waiting, or <span class="game">CREATE ROOM</span>, <span class="game">JOIN ROOM</span> or <span class="game">ROOM LIST</span> to play a friend.</li>
      <li>Pick your fighter and side. You train against a partner while you wait, and both players accept before the fight starts.</li>
    </ol>
    <p class="note">Both players need the same game version, and each the data of the fighter the other picks. A <span class="game">ws://</span> address works from the apps and from a page opened over http://; a page opened over https:// needs <span class="game">wss://</span>.</p>
  </section>

  <div class="pair">
    <section class="box">
      <h2 class="menu">Room list</h2>
      <ul class="plain" id="listed"></ul>
    </section>
    <section class="box">
      <h2 class="menu">Versions</h2>
      <div>This server: <span class="game" id="version">–</span></div>
      <div>Serves games <span class="game" id="supported">–</span> and later, each matched with players on the same version.</div>
      <ul class="plain" id="versions"></ul>
    </section>
  </div>

  <footer>
    <p>This server only pairs players and passes their presses between their games. It holds no game files; each game runs from its player's own disc. <span id="since"></span></p>
    <p>An unofficial server for an unofficial, independently developed project. Neither is affiliated with, endorsed by, sponsored by, authorized by, or approved by Bandai Namco Entertainment or Sony Interactive Entertainment. Tekken, Tekken 3 and their characters are trademarks and/or intellectual property of their respective rights holders. PlayStation is a trademark of Sony Interactive Entertainment.</p>
  </footer>
</main>
<script>
  const statusPath = ${json(`${root}status.json`)};
  const address = ${json(address)};
  const $ = (id) => document.getElementById(id);
  $('address').textContent = address;
  $('copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(address).then(() => {
      $('copy').textContent = 'Copied';
      setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
    }, () => {});
  });
  const list = (element, items, empty) => {
    element.replaceChildren();
    for (const text of items.length === 0 ? [empty] : items) {
      const li = document.createElement('li');
      li.textContent = text;
      if (items.length === 0) li.className = 'empty';
      element.append(li);
    }
  };
  const lasting = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? hours + ' h ' + minutes + ' min' : minutes + ' min';
  };
  let silent = null;
  async function read() {
    try {
      const response = await fetch(statusPath, { cache: 'no-store' });
      const s = await response.json();
      $('name').textContent = s.name;
      document.title = s.name;
      $('motd').textContent = s.motd;
      $('motd').hidden = s.motd === '';
      $('players').textContent = s.players;
      $('fights').textContent = s.fights;
      $('queued').textContent = s.queued;
      $('rooms').textContent = s.rooms;
      list($('listed'), s.listed.map((room) => room.title + ', ' + room.host + ' (' + room.version + ')'), 'No room listed. Create one in the game with ROOM set to LISTED.');
      $('version').textContent = s.version;
      $('supported').textContent = s.oldest;
      list($('versions'), Object.entries(s.versions).map(([version, count]) => version + ': ' + count + (count === 1 ? ' player' : ' players')), 'Nobody is playing right now.');
      $('since').textContent = 'Up for ' + lasting(s.up) + '.';
      silent = null;
      $('live').className = 'live up';
      $('state').textContent = 'Up, updated ' + new Date().toLocaleTimeString();
      $('lamp').classList.remove('beat');
      void $('lamp').offsetWidth;
      $('lamp').classList.add('beat');
    } catch {
      $('live').className = 'live down';
      silent ??= new Date().toLocaleTimeString();
      $('state').textContent = 'Not answering since ' + silent;
    }
  }
  read();
  setInterval(read, 3000);
</script>
</body>
</html>
`;
}
