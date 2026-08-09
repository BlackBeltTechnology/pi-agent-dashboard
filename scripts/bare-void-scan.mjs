/**
 * Scanner for bare `void <expr>` discards — the pattern the promise-rule ladder
 * bans (design D1 of `cleanup-async-semantics-server-extension`).
 *
 * A discard must state its handling: `void p.catch(handler)` with a non-empty
 * handler. A bare `void p` silences a rejection that should surface, which makes
 * the bug LESS diagnosable, not more.
 *
 * Kept as a module (not inlined in the test) so the fixture generator and the
 * guard use literally the same scanner — a baseline produced by a different
 * regex than the one that checks it is worse than no baseline at all.
 *
 * Sites are keyed `path\t<trimmed statement line>` rather than `path:line`, so
 * an unrelated edit ABOVE a site does not churn the fixture. Duplicates are
 * meaningful: the set is compared as a multiset.
 *
 * See change: cleanup-async-semantics-server-extension.
 */

/** Source extensions Biome lints. Never narrow this to `.ts` — `keeper.cjs` lives here. */
export const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** How many lines ahead to look for the `.catch(` that guards a discard. */
const STATEMENT_LOOKAHEAD = 8;

/**
 * Find bare `void` discards.
 *
 * @param {(path: string) => string} readFile resolves a repo-relative path to source
 * @param {string[]} files repo-relative paths to scan
 * @returns {string[]} sorted `path\tstatement` keys
 */
export function scanBareVoidDiscards(readFile, files) {
  const found = [];
  for (const file of files) {
    let lines;
    try {
      lines = readFile(file).split("\n");
    } catch {
      continue; // unreadable / deleted between listing and read
    }
    lines.forEach((line, i) => {
      // `void` as an operator, not `.void` / `myvoid` / a bare `void;`
      if (!/(^|[^.\w])void\s+(?![\s;)])/.test(line)) return;
      // A doc-comment line mentioning the pattern is not a discard.
      if (/^\s*\*/.test(line)) return;
      // Type position: `: void`, `(): void`, `=> void`.
      if (/\)\s*:\s*void|:\s*void\b|=>\s*void/.test(line)) return;
      const statement = lines
        .slice(i, i + STATEMENT_LOOKAHEAD)
        .join("\n")
        .split(/;\s*$/m)[0];
      if (/\.catch\(/.test(statement)) return; // guarded discard — allowed
      found.push(`${file}\t${line.trim()}`);
    });
  }
  return found.sort();
}

/**
 * Entries present in `live` beyond what `baseline` allows (multiset difference).
 * Empty result = no new bare discard was introduced.
 *
 * @param {string[]} live
 * @param {string[]} baseline
 * @returns {string[]}
 */
export function newBareVoidSites(live, baseline) {
  const remaining = new Map();
  for (const site of baseline) remaining.set(site, (remaining.get(site) ?? 0) + 1);
  const extra = [];
  for (const site of live) {
    const left = remaining.get(site) ?? 0;
    if (left > 0) remaining.set(site, left - 1);
    else extra.push(site);
  }
  return extra;
}
