## Context

`kb dox lint` (`packages/kb/src/dox.ts`) recognizes file rows with a heading-state
boolean (`inDox`), set by any heading matching `/^DOX\b/` and cleared by *every*
heading — including deeper subheadings. The same heuristic is copy-pasted in
three places: `countInlineRows` (~L189), `parseRowPaths` (~L207), and inline in
`doxLint`'s row loop (~L448). Measured against the walked tree:

- **33 rows** sit under subheadings in 2 files that DO open `# DOX`
  (`pi-forms-bpmn` 19, `cost-estimator` 14).
- **57 rows** sit in 4 files that never set `inDox` (`bus-client` 29, `shell` 15,
  `server/src/attachments` 8, `server/src/tunnel-providers` 5).
- **90 rows newly visible** total. (The proposal's "96" also counted pi-flows'
  7 rows — a walk-excluded, untracked vendored tree — and root `AGENTS.md`'s
  8 prose-table cells, which are true negatives. This design supersedes that
  count.) ~4.3% of the ~2104 walked rows.
- `stale`/`orphan`/`broken-ref`/`missing` all read the same `rowPaths`, so those
  90 rows are unaudited under whatever verdict lint reports.
- Baseline (live, read-only run, reproduced independently twice): **67
  findings** — 45 `missing` (29 real + 16 bogus gitignored: 8
  `.pi/prompts/opsx-*.md` + 8 `.pi/skills/openspec-*/SKILL.md`), 16 `stale`,
  3 `over-threshold`, 1 `orphan`, 1 `broken-ref`, 1 `missing-companion`. Zero is the goal *after* this change
  lands and the backlog (pre-existing, not a regression) is cleared.

Two adjacent gaps:

- The dox walks (`walkFiles`; callers `walkMd`, `walkSource`, `walkAgents`)
  ignore `.gitignore`. `.pi/.gitignore` vendors `prompts/opsx-*.md` +
  `skills/openspec-*/**` with negations `!skills/openspec-shared/` AND
  `!skills/openspec-shared/**` re-including the shared skills; the root
  `.gitignore` ignores `.pytest_cache/` (no nested `.pytest_cache/.gitignore`
  exists — the root entry is the mechanism). The 16 bogus `missing` findings are
  a *documented standing contract*: `.pi/skills/AGENTS.md` says "that finding is
  expected. Do NOT add rows" — that prose must be rewritten when the findings
  vanish.
- `packages/kb/src/config.ts:111` declares `respectGitignore: true` as an indexer
  default, but nothing in `packages/kb/src/` consumes it. The indexer is where
  this bites hardest: its sources are `docs`, `openspec`, `packages`, `.pi`
  (never the repo root), and its own `DEFAULT_EXCLUDE` (`indexer.ts:34`) —
  unlike dox.ts's — has no `bundled-extensions`/`out` tokens, so **179 gitignored
  md files** under `packages/electron/resources/bundled-extensions` +
  `packages/electron/out` are visible to it on disk — plus the 16 gitignored `.pi` md
  files (the `.pi` source's config exclude covers only node_modules/.worktrees/
  archive). With `dedup.exactContentCollapse: true` collapsing byte-identical
  vendored copies, that is **~100 distinct indexed paths** (76 bundled-extensions
  + 8 out + 16 .pi) that drop when the filter lands.

Prior art: `gitignoreToRegex`/`loadGitignoreMatcher` in
`packages/extension/src/command-handler.ts` (root `.gitignore` only, no
negations, case-insensitive — a deviation from git semantics) and a second mirror
in `packages/server/src/lib/grep.ts:21-46`. A kb-local matcher becomes the third
live implementation — accepted, same mirrored-not-shared convention.

Census (walked scope): **207 tables** with the exact header `| File | Purpose |`;
exactly **3 prose tables** with backticked cells (all in root `AGENTS.md`:
"You're about to… | Do this first instead", "Kind of update | Goes in",
"Subagent | Use for"). The proposal's 214/5 counted walk-excluded trees too
(`pi-flows` carries `Task | Command | Notes` + `Kind of update`). The four blind
files and both subheading files all use `| File | Purpose |`. `| Path | Purpose |`
appears twice repo-wide — `pi-flows/AGENTS.md:42` and a `site/` fixture — both
in DEFAULT_EXCLUDE'd trees no walk reads; neither is
tracked (0 tracked files under either tree), so **no normalization edit is
possible or needed**; neither ever enters a walk.

## Goals / Non-Goals

**Goals:**

- Row recognition keyed on the table header (`| File | Purpose |`), identical in
  all three call sites, independent of heading structure.
- Preserve the Defect-B guarantee (prose tables never yield rows or orphans),
  structurally, including the direct-adjacency case.
- `.gitignore`-aware walks with nested-file and negation support for the dox
  walkers; make the indexer's declared `respectGitignore` real with a
  repo-root-seeded pattern stack.
- Coverage reporting: files scanned, rows recognized, and a `zero-row-table`
  finding so a header with no recognizable rows is loud.
- Drive lint from the measured baseline of 67 findings to zero, auditing the 90
  newly visible rows.

**Non-Goals:**

- No change to indexing, retrieval, or ranking beyond the gitignore filter —
  the filter's effect on the index is intentional file removal (179 gitignored
  files drop; that is the fix, not a regression).
- No edits to the four blind files or the two subheading files — the header fix
  needs zero edits to them. (One *malformed* file does get a whitespace fix:
  `quota-plugin`, see Risks.)
- No edit to `pi-flows/AGENTS.md` — untracked vendored tree; `Path | Purpose`
  stays, permanently unlinted by walk exclusion, and no synonym is added to the
  grammar.
- Not replacing the extension's or grep.ts's inline matchers (mirrored-not-shared
  convention; surgical scope). Release coupling: `kb-extension` pins
  `^0.8.0` of the kb package — covered by the monorepo's lockstep release model
  (release-cut bumps every workspace package together); stale external installs
  keep heading-based `parseRowPaths` until updated, acceptable.
- Existing test fixtures are part of the migration surface: 17 `# DOX` fixture
  sites in `kb.test.ts` (none with a table header) plus
  `dox-source-coverage.test.ts` (~10 tests) whose DOX helper writes
  `| FILE | PURPOSE |` — uppercase, rejected by the case-sensitive grammar.
- Not implementing full gitignore semantics — no character classes beyond
  pass-through escaping, and no tracked-file override (git treats tracked files
  as un-ignorable; the pure-pattern matcher does not. 3 tracked files match
  ignore patterns today, none markdown; a future tracked md under an ignored
  path would silently drop from lint+index — accepted divergence, visible via
  the coverage line).

## Decisions

### D1 — Table-header recognition replaces heading state

A row counts iff it sits in a table whose header line matches
`/^\|\s*File\s*\|\s*Purpose\s*\|\s*$/` (whitespace-flexible, exact cell names,
case-sensitive — all 207 walked tables match exactly). State machine:

- opens on the header line;
- stays open while lines start with `|` **and** are not a second delimiter row;
- closes on the first non-`|` line (blank, prose, heading) **or** on a second
  `|---|` delimiter row (a table has exactly one; a directly-adjacent prose
  table brings its own delimiter, which closes the file table before its body
  cells — closes the adjacency hazard where a prose table butted against a file
  table would otherwise have its backticked cells read as rows; the prose
  table's own header line still lands inside the open table, which only bites
  if a prose HEADER is row-shaped — no walked file has that today, and the
  census gate covers it).

Rows: `/^\|\s*`([^`]+)`\s*\|/`. The delimiter row never matches the row regex.

Known loss mode, handled by migration: a row-shaped line separated from its
table by a blank line is NOT recognized (`quota-plugin/src/AGENTS.md:13-15` —
today's heading rule audits that row; D1 would drop it). The file is malformed
markdown (the row renders as a headerless one-row table); the fix is removing
the blank line, plus a one-time census for any other loose row-shaped lines
outside tables (task 5.1).

`| Path | Purpose |` is **not** accepted as a synonym. Every accepted synonym
widens the false-positive surface forever; the one instance is in an untracked
vendored tree no walk reads.

### D2 — One shared scanner, three consumers

New exported `scanDoxRows(text)` in `dox.ts`:

```ts
{ rows: { path: string; line: string; lineIndex: number }[];
  emptyFileTables: { line: number }[] }   // header line numbers, per empty table
```

implementing the D1 state machine once. Header matching is **case-sensitive** —
all 207 walked tables match exactly; the one uppercase outlier is a test helper
(`dox-source-coverage.test.ts`), fixed as part of the fixture migration, not
accommodated by the grammar.

- `parseRowPaths` → `scanDoxRows().rows.map(r => r.path)` — signature and
  sidecar-pointer inclusion unchanged. Sole cross-package consumer:
  `kb-extension/src/reindex.ts` (`dox-triage.ts` imports only `DoxIssue` +
  `resolveRowPath`; its own headerless `parseRows` remains a fourth recognizer —
  divergence is pre-existing, D1 does not worsen it, unifying it is out of
  scope).
- `countInlineRows` → same rows minus `SIDECAR_POINTER` matches (count-only
  exclusion preserved).
- `doxLint` iterates `scanDoxRows().rows` (purpose-cell extraction, existence,
  staleness, ref checks) and rebuilds the file for `--fix` from pruned-orphan
  `lineIndex`es — byte-identical to today except pruned orphan lines.
- **`--fix` missing-arm AND `doxInit` become table-aware.** Today the missing
  arm does `appendFileSync(owner, "| `md` |  |")` at EOF; under D1 an
  EOF-appended row is only recognized if the file ends inside an open table,
  else the finding re-fires and duplicates accumulate forever. `doxInit` is
  worse: its create-template writes bare rows with no header/delimiter, its
  append path prepends a blank line (closing any open table), and its
  idempotence check (`new Set(parseRowPaths(file))`) would read its own output
  as `[]` — every `kb dox init` run would re-append all rows. Both write paths
  share one table-aware row-append helper (insert after the file-table's last
  row; create header + delimiter at EOF when absent), and the create-template
  gains the header + delimiter. Convergence test: rows appended by `--fix` and
  by `dox init` are recognized on the next run, and repeated `dox init` runs
  are idempotent.

### D3 — Gitignore-honouring walks, rooted at the repo root

New `packages/kb/src/gitignore.ts`, best-effort. Forms with md/lint impact
today, plus the cheap core forms the repo's 20+ nested `.gitignore` files use:

- bare names, `dir/` directories, `*.ext` globs, mid-name globs
  (`rows*.jsonl`);
- `**` mid-pattern and chained (`packages/*/src/**/*.js`,
  `site/design-scratch/**/out/`) and leading-`**/` prefixes (`**/node_modules`,
  `**/dist`);
- bare `*` ignore-all with file negations (`.pi/npm/.gitignore`,
  `packages/client/src/generated/.gitignore`);
- `!` negation, both dir (`!skills/openspec-shared/`) and content
  (`!skills/openspec-shared/**`) forms, plus root-level file negations
  (`!packages/client/src/vite-env.d.ts`,
  `!packages/quota-plugin/src/pi-quotas.d.ts`); last-match-wins within a file,
  deeper `.gitignore` overrides shallower;
- leading-slash anchors, file (`/package-lock.json`) and dir forms, and `/*`;
- case-SENSITIVE (git semantics; do not copy the extension matcher's `/i`).

Not implemented: tracked-file override (see Non-Goals) and character classes
beyond pass-through escaping. Forms with no md impact today are included
because they share the same glob machinery — the test list in tasks 1.7/3.1
exercises each form.

**Anchoring:** the pattern stack is seeded by walking UP from the walk start to
the repo root (`.git` boundary or `cwd`), then descending — so root-anchored
root-`.gitignore` patterns (`packages/electron/resources/bundled-extensions`,
`out/`, `.pytest_cache/`) apply to nested-source walks (`packages`, `.pi`,
`docs`). A walk-root-only stack would miss all of them — this is the difference
that removes the 179 wrongly-indexed files.

**Pruning is conservative:** a directory is pruned early only when a
directory-matching pattern (e.g. `bundled-extensions`, `out/`) hits it;
otherwise the walk descends and filters files at match time, so negations of
deep files survive.

`walkFiles` takes an optional ignore predicate; `walkMd`, `walkSource`,
`walkAgents` pass one. `DEFAULT_EXCLUDE` (dox.ts) stays — it also covers
untracked noise (`openspec/`, `doc-example`, `CHANGELOG.md`, …). The missing
arm, missing-companion arm, row parsing, and `dox init` inherit the predicate.
The indexer's `walk` gets the same repo-root-seeded predicate gated on the
existing `respectGitignore` default (opt-out preserved); its own
`DEFAULT_EXCLUDE` is left untouched — the gitignore filter subsumes the
bundled-extensions/out cases on a real checkout.

### D4 — Coverage reporting + `zero-row-table` finding

`DoxLintResult` gains `filesScanned: number` (AGENTS.md files row-parsed) and
`rowsScanned: number` (recognized rows). New `DoxIssue` kind `zero-row-table`,
one finding per empty table, `detail` carrying the header's line number (from
`emptyFileTables`). CLI text mode prints one coverage line
(`N files, M rows scanned, K findings`); `--json` carries the new fields
additively. Consumer-safe: `cli.ts` reads only `r.issues` (`r.fixed` is
currently unread in the lint block);
`dox-triage.ts` special-cases only `stale`; no consumer switches exhaustively
on issue kinds (verified).

## Risks / Trade-offs

- [Row-shaped line outside any table goes dark (quota-plugin)] → one-time
  loose-row census across walked AGENTS.md files; the file gets the blank-line
  fix; any future loose row shows up as a `missing` finding for the file it
  documents.
- [Indexer shrink misread as data loss] → expected one-time `deleted` churn:
  179 gitignored md on disk under `packages/electron/**` + 16 in `.pi`, ≈**100
  distinct indexed paths** after content-dedup; matches fresh-clone reality;
  reversible per-source via `respectGitignore: false`.
- [Prose table butted directly under a file table converts prose rows to
  orphans] → structurally closed by the second-delimiter-row rule (D1);
  remaining exposure needs a delimiter-less pseudo-table, caught by the census
  gate.
- [Someone authors a prose table with a literal `| File | Purpose |` header] →
  indistinguishable from a file table by construction; its backticked cells
  would be audited (and `--fix` could prune them). Doctrine + census gate guard
  this; accepted trade-off, documented here.
- [Matcher bug over-excludes tracked files, silently shrinking coverage] →
  tests written first against this repo's real patterns (both negation forms,
  root-anchored patterns, mid-`**`); the coverage line makes shrink visible
  run-over-run.
- [~90 rows entering the audit arms read as a regression] → proposed and
  expected; baseline is 67 findings *today*; coverage line shows why; the
  backlog is cleared in this change, not left red.
- [`--fix` rewrite regressions] → golden tests: only orphan lines pruned;
  `--fix`-appended rows land inside the table and are recognized on the next
  run.
- [`.pi/skills/AGENTS.md` standing contract goes stale] → its
  "Deliberately undocumented … that finding is expected" paragraph is rewritten
  in this change (task 4.4).

## Migration Plan

1. Land `gitignore.ts` (repo-root-seeded stack) + `scanDoxRows` with red tests
   — new cases AND the existing `kb.test.ts` / `dox-source-coverage.test.ts`
   fixtures rewritten to header shape (the old fixtures encode the heading-state
   rule being deleted; ~6 of them fail unchanged).
2. Switch the three call sites; make `--fix`'s missing-arm table-aware; remove
   the blank line in `quota-plugin/src/AGENTS.md` (loose-row fix).
3. Run `kb dox lint` repo-wide: audit the 90 newly visible rows + the ~51
   pre-existing findings back to zero; confirm the coverage line; rewrite the
   `.pi/skills/AGENTS.md` contract paragraph once the 16 bogus findings are
   gone. Verify `kb dox init` idempotence on a scratch tree (dry-run twice).
4. No data migration: the staleness sidecar stays keyed by relative path.
   Rollback = revert the commit; lint returns to heading-state behavior with no
   residue (the one `quota-plugin` whitespace fix is harmless under both rules).

## Open Questions

- None blocking. `Path | Purpose` synonym: decided (no synonym; pi-flows stays
  untouched — untracked). Indexer anchoring: decided (repo-root-seeded stack).
