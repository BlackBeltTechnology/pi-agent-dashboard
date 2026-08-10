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
 * Drop the comment part of a line: a whole-line `//` or `*` comment yields "".
 *
 * Deliberately simple — it does not parse strings, so a `//` inside a string
 * literal truncates the line early. That direction is safe: it can only cause a
 * MISS, never a false positive, and a discard written inside a string literal is
 * not a discard.
 */
function stripComment(line) {
  if (/^\s*(\*|\/\/|\/\*)/.test(line)) return "";
  // Blank out string literals first, so a `//` inside one does not truncate the
  // line and hide a real discard after it (`const u = "http://x"; void work();`).
  // Quotes are replaced rather than removed to keep column semantics simple.
  const withoutStrings = line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const idx = withoutStrings.indexOf("//");
  return idx === -1 ? withoutStrings : withoutStrings.slice(0, idx);
}

/**
 * True when the statement carries a `.catch(` with a NON-EMPTY handler.
 *
 * `void p.catch()` is not a guarded discard — it installs no handler at all, so
 * the rejection is still swallowed. D1 requires the handler to exist and do
 * something, so an empty `.catch()` must read as bare.
 */
function hasNonEmptyCatch(statement) {
  const at = statement.indexOf(".catch(");
  if (at === -1) return false;
  const afterOpenParen = statement.slice(at + ".catch(".length);
  // Anything other than an immediate `)` (modulo whitespace) counts as an
  // argument. An empty arrow body (`() => {}`) is still an explicit decision and
  // is accepted here; the ban this scanner enforces is on the *bare* form.
  return !/^\s*\)/.test(afterOpenParen);
}

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
      // Comments discuss this pattern constantly (the ban is documented at the
      // sites it applies to), so strip them before matching. Without this, a
      // comment quoting `void p.then(...)` is reported as a violation of the
      // very rule it is explaining.
      const code = stripComment(line);
      // `void` as an operator, not `.void` / `myvoid` / a bare `void;`
      if (!/(^|[^.\w])void\s+(?![\s;)])/.test(code)) return;
      // Type position: `: void`, `(): void`, `=> void`.
      if (/\)\s*:\s*void|:\s*void\b|=>\s*void/.test(code)) return;
      const statement = lines
        .slice(i, i + STATEMENT_LOOKAHEAD)
        .join("\n")
        .split(/;\s*$/m)[0];
      if (hasNonEmptyCatch(statement)) return; // guarded discard — allowed
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
