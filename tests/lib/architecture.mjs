/** What the source must not contain, and a scan of source text for it. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The game's code: no PlayStation memory addresses (0x80000000 itself, the sign bit, is not one). */
export const REMAKE_RULES = [{ name: 'PlayStation address', pattern: /\b0x80(?!000000\b)[0-7][0-9a-f]{5}\b|\b0x1f80[0-9a-f]{4}\b/i }];

export const SIM_RULES = [
  { name: 'engine import', pattern: /from\s+['"]@driftengine\// },
  { name: 'outer layer import', pattern: /from\s+['"][^'"]*\/(assets|present|app)\// },
  /* The browser's globals used (a member read or a call), not the words in prose. */
  { name: 'browser global', pattern: /\b(document|window|localStorage)\s*(\.\s*[A-Za-z_$]|\[)|\bfetch\s*\(/ },
];

/** Each rule's matches in `text`, with their 1-based line. */
export function scan(text, rules) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    for (const rule of rules) if (rule.pattern.test(line)) findings.push({ name: rule.name, line: i + 1, text: line.trim() });
  });
  return findings;
}

/** Every `.ts` and `.mjs` file under `root`, scanned; nothing while `root` does not exist. */
export function scanTree(root, rules) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    const file = path.join(root, entry);
    if (statSync(file).isDirectory()) out.push(...scanTree(file, rules));
    else if (file.endsWith('.ts') || file.endsWith('.mjs')) out.push({ file, findings: scan(readFileSync(file, 'utf8'), rules) });
  }
  return out;
}
