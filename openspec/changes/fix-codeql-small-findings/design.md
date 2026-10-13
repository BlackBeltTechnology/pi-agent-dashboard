## Context

See proposal.md (Why) for the triage and the measured timings. Relevant code
(develop):

- **DOX row regex, four copies.** `` /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/ ``
  at `packages/kb/src/dox-triage.ts:22` (`parseRows` `:37`,
  `replaceRowPurpose` `:50`; `parseRows` runs on every kb search with verdicts,
  `packages/kb/src/verdict.ts:182`), `packages/kb/src/dox.ts:320`
  (`ROW_PURPOSE`, `dox describe --list`) and
  `packages/kb/src/migrate-file-index.ts:13`; a loose variant (closing pipe
  optional) in `packages/kb/src/migrate-runner.ts:121` `parseAuthoredBatch`,
  which parses `@fast` subagent output. The lazy `(.*?)` between `\s*` runs is
  cubic (strict) / quadratic (loose) on long whitespace. `(.*?)` cannot match
  `\r`, U+2028 or U+2029. `dox-triage.ts:20` imports `dox.js`, so a helper in
  `dox-triage.ts` cannot be imported by `dox.ts`.
- **Chunker links.** `packages/kb/src/chunker.ts:127-128`:
  `/\[\[([^\]]+)\]\]/g` and `/\]\(([^)]+\.mdx?)\)/g` via `matchAll`, each match
  trimmed; every failed start rescans to the next `]` / `)`.
- **Run trims.** `packages/shared/src/git-worktree-helpers.ts:25-30`
  `slugifyBranch`: `.replace(/^-+|-+$/g, "")` (both ends) then `.slice(0, 64)`;
  `packages/shared/src/source-matching.ts:90-92` `localPathBasename`:
  `src.replace(/\/+$/, "").replace(/\.git$/, "")` then `split(/[\\/]/)`
  (unexported; reached via `sourcesMatch`).
- **Grounding.** `packages/kb/src/migrate-runner.ts:44`:
  ``new RegExp(`\\b${id.replace(/\$/g, "\\$")}\\b`)``; ids come from
  `/[A-Za-z_$][A-Za-z0-9_$]*/g` (`:33`). `\b` never matches next to `$`, so
  `$Foo` is never found and `Foo` is found inside `$Foo` / `Foo$bar`.
  `packages/kb/src/indexer.ts:65` has an unexported `escapeRegExp`.
- **Doctor Markdown.** `packages/shared/src/doctor-core.ts:1710`,
  `packages/client/src/components/settings/DiagnosticsSection.tsx:99`,
  `packages/electron/src/renderer/doctor.html:236` escape `|` but not `\` in the
  message cell; their detail-cell fences already escape `\` first
  (`doctor.html:225`, `doctor-core.ts:1676`). `doctor-core.ts` imports
  `node:fs`/`node:dns`, so the client cannot import it.
  `packages/deck3d/src/ir/field-reference.ts:56` is the in-repo precedent for
  `\`-then-`|` escaping.
- **Branch list.** `packages/server/src/git-worktree/git-operations.ts:430-458`
  runs `git branch --format=%(refname:short)%(HEAD)`: `%(HEAD)` prints `*` for
  the current branch and a **space** otherwise; lines are parsed with
  `line.replace("*", "").trim()` (`:443`, `:453`), and the remote list skips
  names ending in `/HEAD`.
- **Other sites.** `packages/client/src/components/session/SessionList.tsx:121-125`
  (`cssEscapeId`) and `packages/client/src/components/openspec/OpenSpecBoardView.tsx:242-244`
  fall back to `replace(/"/g, '\\"')` when `CSS.escape` is missing (jsdom).
  `packages/electron/src/main.ts:390-399` `updateSplashStatus` escapes only
  `` ` `` and `$` before splicing into a template literal; all five callers
  (`:668-756`) pass string literals. `extractYouTubeId`
  (`YouTubePreview.tsx:18-35`, sole caller `YouTubePreview.tsx:40`) accepts any
  host ending in `youtube.com`, while `dispatchPreview`
  (`packages/client/src/lib/preview/preview-dispatch.ts:23-44`) routes to
  that renderer only for the exact set `youtube.com`, `www.youtube.com`,
  `m.youtube.com`, `youtu.be`. `packages/bus-client/src/codegen/generate-verbs.ts:92`
  `.replace(/\n/g, "\n")` is an identity; the committed `generated/verbs.ts`
  already differs from current generator output (pre-existing drift).

## Goals / Non-Goals

**Goals:** linear-time parsing at every copy of the measured patterns with
output identical to the previous implementation on every input; correct
Markdown cell escaping; correct grounding for `$`-containing identifiers;
remove the remaining listed alerts.

**Non-Goals:**
- Mermaid SVG sanitizer (`sanitize-untrusted-rendered-content`).
- Alerts in tests / scripts / mockups (excluded by `add-local-codeql-ratchet`)
  and accepted-by-design operator-API alerts.
- The same `^-+|-+$` / `/\/+$/` shapes elsewhere (e.g. `deck3d/src/ir/ids.ts:22`,
  `shared/src/vault-project-key.ts:59`, `client/.../WorktreeList.tsx:37`) that
  CodeQL did not flag (no tainted path established); the ratchet surfaces them
  if one becomes tainted.
- The pre-existing `generated/verbs.ts` drift, the doctor "Remediation" bullet
  list, and dismissing alerts on GitHub.

## Decisions

### D1 — Linear scans with the old semantics spelled out

All rewrites are verified by (a) a timed L1 test on the CodeQL witness at
100 000 characters with a 100 ms budget, and (b) a differential test against
the old regex over randomized inputs drawn from each pattern's delimiter
alphabet plus the listed edge cases (the old regex is fast on those).

- **DOX rows** → new leaf module `packages/kb/src/dox-row.ts` (no imports)
  exporting `matchRow(line)` (strict) and `matchRowLoose(line)` (closing pipe
  optional). Both match the head with `` /^\|\s*`([^`]+)`\s*\|/ `` (no ambiguous
  repetition) and parse the tail with string ops:
  - strict: `t = rest.trim()`; no match unless `t.endsWith("|")`;
    `purpose = t.slice(0, -1).trim()`.
  - loose: `t = rest.trim()`; if `t.endsWith("|")` then `t = t.slice(0, -1).trim()`;
    `purpose = t`.
  - both: no match when `purpose` contains `\r`, U+2028 or U+2029 (the old
    `(.*?)` never matched them; JS `trim()` and regex `\s` cover the same set,
    so the surrounding whitespace behaves as before).
  `dox-triage.ts` (`parseRows`, `replaceRowPurpose`), `dox.ts` (`ROW_PURPOSE`)
  and `migrate-file-index.ts` use `matchRow`; `migrate-runner.ts`
  `parseAuthoredBatch` uses `matchRowLoose`. `ROW_RE` / `ROW_PURPOSE` are
  removed (no importer outside `dist/`).
- **Chunker links** → one scanner per kind with a single forward-only pointer
  `close` to the next closing delimiter (`]` / `)`): for each opener at `i`
  (`[[` / `](`), if `close < i + 2` set `close = text.indexOf(delim, i + 2)`;
  stop when it is `-1`. Because openers are visited in increasing order and
  `close` only moves forward, the total scanned length is O(n).
  - wikilink: raw inner = `text.slice(i + 2, close)`; a link iff
    `close > i + 2` and `text[close + 1] === "]"`; emit `inner.trim()`
    (so `[[ ]]` still yields `""`); resume after `close + 2`.
  - md-link: a link iff `close - (i + 2) >= 4` and the raw inner ends with
    `.md`, or `>= 5` and it ends with `.mdx`, checked with
    `text.endsWith(".md", close)` / `text.endsWith(".mdx", close)` — no slice or
    regex per opener; emit the raw inner trimmed (so `[x](a.md )` is still not
    a link); resume after `close + 1`. Non-matching openers resume at `i + 1`,
    as `matchAll` does.
- **Run trims** → index loops. `slugifyBranch`: advance `start` over leading `-`
  and retreat `end` over trailing `-`, then `.slice(0, 64)` as before.
  `localPathBasename`: retreat over trailing `/` only (not `\`), then strip one
  trailing case-sensitive `.git`, then split on `[\\/]` as before.

Alternative: "non-backtracking" regexes. Rejected: their cost is
engine-dependent and the next edit can reintroduce the problem; a scan is
self-evidently linear.

### D2 — One shared `escapeMdTableCell`

New `packages/shared/src/md-table-cell.ts` (no Node imports) exports
`escapeMdTableCell(s)`: `\` → `\\`, then `|` → `\|`, then `\r?\n` → space
(order as in `deck3d/src/ir/field-reference.ts:56`). `doctor-core.ts` and
`DiagnosticsSection.tsx` apply it to the name and message cells; `doctor.html`
(standalone page, no bundling) inlines the same three steps. Behavior change,
intended: the raw Markdown of any message containing `\` changes (`C:\Users\me`
becomes `C:\\Users\\me` and still renders as `C:\Users\me`), and a message that
relied on Markdown escapes (`x\*y\*`) now renders its backslashes literally.

### D3 — Grounding: full escape, identifier-alphabet boundaries

`` new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(id)}(?![A-Za-z0-9_$])`) ``,
with `escapeRegExp` exported from `packages/kb/src/indexer.ts:65` and reused.
`$` is an identifier character in JS/TS, so `Foo` is no longer grounded by
`$Foo` or `Foo$bar` (different identifiers), and `$Foo` is grounded by
`const $Foo`. This modifies the grounding requirement's notion of "present".

### D4 — Small clean-ups

- `git-operations.ts` (local and remote loops):
  `const t = line.trim(); const name = (t.endsWith("*") ? t.slice(0, -1) : t).trim();`
  `isCurrent = t.endsWith("*")`; the `/HEAD` skip runs on that `name`.
  Identical to today for every ref name git can print (git forbids `*` in ref
  names).
- New `packages/client/src/lib/css-escape.ts` exports `cssEscape(s)`: native
  `CSS.escape` when present, else every character outside `[A-Za-z0-9_-]`
  becomes a CSS hex escape (`\` + code point in hex + space), which is valid in
  any selector context. `SessionList.tsx` and `OpenSpecBoardView.tsx` use it.
  Identical in browsers (native path); in jsdom the fallback becomes correct
  for `\`, `]`, newlines and other characters.
- `main.ts` `updateSplashStatus`: the script becomes
  `` `(() => { const el = document.getElementById("status"); if (el) el.textContent = ${JSON.stringify(text)}; })()` ``
  — no template-literal delimiters around the value. The displayed text is
  identical for the five literal callers; the script bytes differ.
- `preview-dispatch.ts` exports `YOUTUBE_HOSTS`; `extractYouTubeId` accepts
  `youtu.be` plus that set. Hosts such as `music.youtube.com` or
  `evilyoutube.com` now yield `null`; none of them reaches `extractYouTubeId`
  today, because `dispatchPreview` routes only that set to `YouTubePreview`.
- `generate-verbs.ts:92`: delete the identity `.replace`. Verified by running
  the generator before and after the edit and comparing the two outputs (not
  against the committed file, which already drifts).

## Risks / Trade-offs

- [Scanner diverges from the old regex on an edge input] → differential fuzz
  plus the named edge cases (`[[ ]]`, `[[a]b]]`, `[x](a.md )`, `](.md)`,
  `[w](a(b).md)`, trailing `)`; rows with `\|`, `||`, empty purpose, CR /
  U+2028 inside the purpose).
- [Timing tests flaky on slow CI] → 100 ms at 100 000 chars is ≥ 50× the
  measured linear scans (≤ 2 ms); the pre-fix code exceeds it by orders of
  magnitude.
- [CodeQL still flags a rewritten site] → judged by measured behavior; a
  residual alert is accepted in the ratchet baseline with the measurement as
  its reason.

## Migration Plan

Pure code change, no data/config. kb source edits require a refreshed
`packages/kb/engine-fingerprint.json` (gated by
`scripts/check-kb-dist-fresh.mjs`). Rollback = revert.
