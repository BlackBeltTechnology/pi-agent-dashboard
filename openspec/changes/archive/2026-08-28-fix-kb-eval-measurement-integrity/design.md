## Context

Two surfaces read the same knowledge base with two different engines and two
different option sets:

- `packages/kb-extension/src/extension.ts:95` calls `store.search` with the full
  ranking option object, and resolves `@blackbelt-technology/pi-dashboard-kb` through
  `exports: { ".": "./src/index.ts" }` — always the working tree.
- `packages/kb/package.json` `bin.kb` → `./dist/cli.js`, a `tsc` artifact that is
  gitignored and only rebuilt by hand (`npm run build`) or on publish
  (`prepublishOnly`). The local `dist/` is dated 2026-08-05 while `src/` last changed
  2026-08-25, so `npx kb search|eval` runs a pre-`fix-kb-search-retrieval-quality`
  engine: `laneQuota` and `suppressedSections` appear nowhere in the artifact
  (`dist/render.js` does exist; the earlier "no render.js" claim was wrong — the
  stale-engine diagnosis stands on the missing ranking features).
- A third, smaller drift exists **today**: `cli.ts` `search` passes `expandGraph` and
  `rerank` to `store.search`; `extension.ts` `kb_search` passes neither. The tool
  never expands or reranks; the CLI does. D2 makes this difference explicit instead
  of silent.

On top of that, `cli.ts:294` calls `evaluate(store, golden, { k, docType })` — every
ranking option is dropped, so even a fresh `dist` would score a bare BM25 path. And
`eval.ts:38` scores `r.path.includes(g.expect)` while the bundled fixtures store
repo-relative `expect` values (`packages/foo/...`) against root-relative indexed
paths, producing an all-zero score that reads as a retrieval failure.

Constraint: `packages/kb` advertises **zero runtime deps** and imports siblings with
NodeNext `.js` specifiers. Node's type stripping does not remap `./config.js` → `./config.ts`,
so the bin cannot simply point at `src/cli.ts` without adding `tsx`/`jiti`. The build
step stays.

## Goals / Non-Goals

**Goals:**
- The `kb` bin and the `kb_search` tool provably run the same engine.
- `kb eval` scores the exact `SearchOpts` the tool passes, from one shared helper.
- The two mined golden sets (`source-intent`, `markdown-intent`) load and score
  non-zero via the documented command. The fictional `doc-example` sets are expected to
  trip the vacuous-run guard — that is the guard working, not a failure.
- A harness fault (bad shape, unreachable targets, zero recall) is loud, not silent.

**Non-Goals:**
- No change to indexing, chunking, or ranking behaviour. Numbers will move because the
  instrument is fixed, not because the engine changed.
- No re-mining or re-shaping of the golden fixture files themselves; only the loader
  and the scorer adapt. (Unreachable `tests/`, `qa/`, `scripts/`, `docker/` targets are
  reported, not deleted.)
- No new runtime dependency in `packages/kb`.

## Decisions

### D1 — Committed engine fingerprint + self-correcting bin shim

First, what cannot work: a build-then-check CI step is vacuous (`dist/` is gitignored,
so a CI build is fresh by construction and can never observe lag), and mtime comparison
is a weak signal (checkout order, npm mtime normalization, `src/__tests__` edits the
build excludes, sub-second tie semantics). Both alternatives rejected.

**Chosen — a committed fingerprint makes staleness visible to CI:**
- `npm run build` = `tsc -p` **plus** writing `packages/kb/engine-fingerprint.json`
  (added to the package `files` allowlist — npm auto-includes `bin/` targets but NOT
  arbitrary root files, and an unshipped fingerprint kills the installed-package leg).
  The file carries three hashes computed by ONE shared plain-JS module
  (`scripts/lib/kb-engine-fingerprint.mjs`, dependency-free — the bin shim imports the
  same module; no three-way reimplementation):
  - `srcHash` — SHA-256 over LF-normalized contents of the tsconfig include set
    (recursive `src/**/*.ts` minus `src/__tests__`, sorted relative paths; LF
    normalization because the repo has no `.gitattributes` and CI runs Windows jobs
    where `autocrlf` would otherwise fork the hash),
  - `tsconfigHash` — hash over the tsconfig chain contents (a `compilerOptions` change
    alters emit without changing src bytes),
  - `distHash` — hash over the emitted `dist/**` (written after tsc succeeds; proves
    the dist on disk is a complete emit, catching an interrupted build that would
    otherwise leave fresh-src-over-stale-dist).
  The file is committed. A commit that edits `src` without rebuilding leaves a stale
  `srcHash` **in the commit** — observable by CI.
- `scripts/check-kb-dist-fresh.mjs`, wired into `ci.yml`: recompute `srcHash` +
  `tsconfigHash` from the working tree, compare with the committed fingerprint;
  mismatch → fail with *"the `kb` bin and the extension would run different engines —
  rebuild and commit the fingerprint"*. This is the "build or CI check SHALL fail" the
  spec requires; it checks commit discipline, which is the only form the defect can
  take in CI.
- `bin.kb` → a committed, never-built plain-JS `bin/kb.mjs` (it can never itself be
  stale; `tsc` resolves by walking up from the package to the nearest
  `node_modules/.bin/tsc` — the workspace root in this monorepo (`packages/kb` itself
  declares no `typescript` dependency and has no local `.bin`); if none resolves, the
  package is treated as installed). Branch table:
  - fingerprint present + `srcHash`/`tsconfigHash`/`distHash` all match → import
    `dist/cli.js`;
  - any mismatch (or fingerprint missing) in a dev checkout (`tsconfig.json`
    resolvable): rebuild via `tsc -p`, refresh the fingerprint, import;
  - mismatch in an installed package (no local `tsconfig.json` — the tarball ships
    `src` and the fingerprint but not the tsconfig chain): loud stderr warning, import
    `dist/cli.js` unchanged (`prepublishOnly` builds the tarball, so a mismatch there
    means post-install tampering — loud, not fatal; the warning fires only on actual
    mismatch, never on every run);
  - `dist/cli.js` missing in a dev checkout → rebuild (same as mismatch); missing in an
    installed package → hard error naming the divergence.
- Also bumped while touching the bin entry: package `engines` floor moves to
  `>=22.13.0` (the first Node where `node:sqlite` runs unflagged; the advertised
  `>=22.5.0` crashes on 22.5–22.12 — pre-existing bin flaw, one line to make truthful).

Alternatives also considered:
- *Point `bin` at `src/cli.ts`* — rejected: needs a TS loader (`tsx`), breaking the
  zero-runtime-dep contract, and `.js` specifiers do not resolve under Node's stripper.

### D2 — One `searchOptsFromConfig(cfg, { sources, overrides })` helper

New `packages/kb/src/search-opts.ts`, re-exported from `src/index.ts`. It is the single
place that maps a resolved `KbConfig` + resolved sources into `SearchOpts`
(`fieldWeights`, `proximityBoost`, `diversity`, `sourceDedup`, `laneQuota`,
`coverageRerank`, `queryExpansion`, `prf`, `expandParent`, `expandGraph`, `rerank`,
`rootPriority`). CLI-only negations (`--no-lane-quota`, `--no-source-dedup`,
`--no-coverage-rerank`, `--no-expand-parent` plus the OR-composed positive alias `--expand-parent`
(`cfg.expand.parent || flag`); flag aliases `--expand-query`,
`--expand-graph`, `--rerank`) are passed as an explicit `overrides` object rather than
duplicated logic.

Call sites after the change (complete **ranking-surface** inventory): `cli.ts` `search`,
`cli.ts` `eval`, `extension.ts` `kb_search`, `eval/run-fixtures.ts` (its BASELINE/variant
option sets become `overrides` over the shared base), and `eval/measure-render.ts` (also
builds `SearchOpts` inline today — must not survive as a residual drift site).
**Explicitly out of scope:** `src/dox.ts` and `verify.ts` also construct `SearchOpts`
literals, but pass only `{ limit }` — engine defaults, no ranking options. Converting
them to the config-derived helper would silently change `kb dox`/verify behaviour
(non-goal); they are documented here as deliberate store-default consumers. The
invariant — "adding a ranking option in only one site stops being expressible" — is
scoped to ranking surfaces. Adding a ranking option in only one of those stops being
expressible — the option is read from the helper or not at all.

Rationale over "make eval import the extension's object": the extension depends on the
pi runtime; the helper must be usable from a bare CLI process.

**Canonical option set — resolving the CLI↔tool drift.** The two surfaces differ today:
the CLI passes `expandGraph`/`rerank` (flag-driven), the extension passes neither. The
helper takes them as **explicit `overrides`**, so the difference becomes a visible
code-level decision at each call site instead of a silent omission:
- `extension.ts` passes `overrides: { expandGraph: false, rerank: false }` — exactly its
  current behaviour, now written down;
- `cli.ts` `search` passes its flag-derived overrides (`--expand-graph`, `--rerank`,
  cfg fallbacks) — exactly its current behaviour;
- `cli.ts` `eval` passes **the extension's overrides**, because eval's purpose is to
  measure the `kb_search` tool path: it scores the option set the tool ships with
  (spec: "identical to the option set the extension passes"), not the CLI's interactive
  extras. Equivalence tests assert each call site's helper output equals today's inline
  object, for the default config and an all-knobs-flipped config.

### D3 — `loadGolden(raw, file)` accepts array | `{ items: [] }`, validates items

Bundled fixtures are objects carrying `$provenance` / `intent` / `minedAt` / `n` /
`items` (the mined sets); the `doc-example` sets are plain arrays — both accepted. The
loader throws a message naming **both** accepted shapes plus the offending file for
anything else, and validates **item shape** too: every item needs a string `q` and a
string `expect`, rejected with file name + array index — today a non-string `expect`
is a **silent zero** (`includes(undefined)` searches the literal string `"undefined"`,
no throw), which is worse than a crash. The fifth file in `eval/`,
`golden.provenance.json` (mining-session metadata: `$provenance`, `sessionsRoot`,
`window`, `stats`), matches neither accepted shape and is **intentionally rejected** —
it is not a queryable fixture. Provenance fields are read for the run header
(`intent`, `minedAt`; absent on array fixtures) but do not affect scoring. The run
header prints to **stderr**, keeping `--json` stdout byte-compatible for existing pipes.

### D4 — Two-tier expect normalization + filesystem-anchored reachability

A fixture census (recomputed against `golden.markdown-intent.json`): of 108 items,
**104 are reachable** under the canonical config — 60 repo-relative strippable
(packages 25, openspec 24, docs 9, .pi 2), 32 root-relative (`specs/…` 19, `server/…` 5,
others 8), 12 bare basenames (`architecture.md` 11, `faq.md` 1) — and 4 unreachable
(`Documents/…`, `Szemelyes/…`, `eurodns_recovery/…`, `tests/e2e/README.md`). The
revision-1 strip-prefix-or-unreachable rule would have misclassified **44 of the 104**
reachable items — the exact defect class this change exists to kill, reintroduced by
the fix.

`evaluate` gains `roots: Array<{ id: string; relPrefix: string }>` (`relPrefix` =
`relative(cfg.cwd, source.dir)`). Per golden item:

1. **Normalize (candidate generation):** if `expect` starts with some root's `relPrefix`
   followed by a path separator — longest matching prefix wins, separator checked on
   both sides so `packages` never matches `packages-x/…`, `path.sep`-aware — strip it →
   *stripped candidate*. The raw `expect` is always kept as a second candidate.
2. **Match (unchanged semantics):** score with today's substring semantics
   (`path.includes(candidate)`), first hit wins, over both candidates. Bare basenames
   and root-relative keeps keep scoring exactly as they do today — the reachable set
   never shrinks relative to the status quo.
3. **Reachability (decided before retrieval, first-segment-anchored):** an item is
   `unreachable` iff `expect` contains a separator **and** its first path segment is
   neither (a) the first segment of any root's `relPrefix`, nor (b) a top-level entry of
   any configured root directory (top-level entries resolved once per run from disk).
   `faq.md` (no separator) → reachable attempt; `changes/specs/…` → `changes` is a
   top-level entry of the openspec root → reachable; `tests/foo.md`,
   `Documents/Projektek/…` → first segment is a top-level entry of no configured root →
   unreachable, matching the spec scenario. Anchoring depth is a documented trade-off:
   only the FIRST segment is checked, so a mid-path typo (`docs/nonexistent/x.md`)
   stays reachable and simply scores low — which is the metric's job, not the harness's.
   Likewise the config's `exclude` globs (e.g. `**/archive/**`) are not consulted: an
   expect under an excluded dir counts as reachable yet can never be indexed. Verified
   latent only — zero current fixtures hit an excluded path — so accepted rather than
   re-implementing glob matching in the scorer.
4. **Reporting:** unreachable items are **not searched at all** (no retrieval, no
   latency contribution); they are excluded from `P@1`, `P@5`, `Recall@K`, `MRR`,
   `nDCG@K` **and** from the redundancy metrics (`distinctSourcesAtK`,
   `duplicateSlotShare`, `singleSourcePageRate`) and `avgLatencyMs`, counted in a new
   `unreachable` metric field; denominator `n = golden.length − unreachable`, with
   `n + unreachable` always summing to the fixture size. JSON output carries the count;
   the path list prints behind `--verbose` (open question resolved: count in JSON,
   list opt-in).

A root with `relPrefix: ""` (root = cwd) is a stated special case: empty prefix ⇒ no
stripped candidate is generated (the raw expect already IS root-relative) and rule (a)
counts as satisfied for every item, so only rule (b) can classify anything unreachable.
Reachability remains a function of the *config + indexable tree*, never of the fixture,
so the same fixtures stay valid under a different root set. Chosen over rewriting the
fixture files because the fixtures are mined artifacts with provenance.

### D5 — Vacuous-run guard is an exit code, not a warning

The guard fires on **both** vacuous shapes:
- **empty scored set** — `n === 0` after the unreachable exclusion (empty fixture, or a
  fixture whose every item is unreachable, e.g. the fictional-corpus `doc-example` sets
  against this repo). Without this, today's `n || 1` fallback reports a full page of
  **0.000 metrics and exits 0** — fake-green zeros copied into a report, the exact
  silent-green class this change exists to kill;
- **zero recall** — `Recall@K === 0` with `n > 0`.

Either condition prints its diagnostic to **stderr** (naming fixture shape and root
normalization as the likely causes), still prints the metrics JSON to stdout (an
`--json` consumer gets its payload and the failure signal), then exits non-zero.
`--allow-zero` exists as an escape hatch for the
legitimate "prove retrieval is broken" case, so the guard never blocks a deliberate
measurement. A warning-only guard was rejected: the whole defect class is a green-looking
zero being copied into a report.

## Risks / Trade-offs

- **Auto-rebuild in the bin shim adds latency to the first `kb` call after an edit** →
  only when stale; a `tsc` incremental build is sub-second, and the alternative is
  measuring the wrong engine.
- **The fingerprint gate adds commit discipline** (edit `src`, forget to rebuild, and
  CI fails on the stale committed fingerprint) → the failure message says exactly what
  to do ("rebuild and commit the fingerprint"); the bin shim auto-heals locally so dev
  flow never trips on it.
- **Rebuild branch in installed packages**: the tarball ships `src` + the fingerprint
  but not the tsconfig chain, so rebuilding without a tsconfig check would fail
  mid-command → the shim requires `tsconfig.json` resolvable before attempting a
  rebuild, else warns loudly and loads `dist` as-is.
- **Shim side effects**: a rebuild refreshes the tracked fingerprint, leaving the tree
  dirty — truthful (the dev WAS stale) and self-healing on the next commit-with-build;
  concurrent `kb` invocations may race a rebuild into the same `dist/` — accepted for a
  single-dev CLI (worst case: one duplicate sub-second build).
- **`unreachable` changes the denominator, so new numbers are not comparable to any
  previously published figure** → intentional; the change explicitly instructs re-baselining
  after landing, and `unreachable` is emitted so any run is auditable.
- **Extracting `searchOptsFromConfig` touches the live `kb_search` path** → covered by a
  behavioural-equivalence test asserting the helper's output equals today's inline
  object for the default config and for a config with every ranking knob flipped.
- **Spec wording**: the delta scenario "stale dist is rejected" is satisfied by the CI
  script; the bin shim is the additional, non-specified belt-and-braces.

## Migration Plan

1. Land the shared helper + eval fixes (no behaviour change to the tool; testable via
   vitest/`tsx` even while the bin still runs stale `dist`).
2. Land the bin shim + engine fingerprint + CI check.
3. Rebuild `dist`, then re-run the **two mined golden sets** (`golden.source-intent.json`,
   `golden.markdown-intent.json`) against the repo's canonical baseline config
   (`.pi/dashboard/knowledge_base.json`: roots `docs`, `openspec`, `packages`, `.pi`) —
   the config future tuning will use — and record metrics incl. `unreachable` **in the
   change's task notes**, never by editing fixture files. The `doc-example` fixtures
   (fictional corpus) are expected to trip the D5 guard — run them with `--allow-zero`
   to see the metrics and confirm the guard fires; that run validates the guard,
   it is not a baseline.
4. Unblock `fix-kb-search-lane-composition`, which must be measured only on these
   post-landing numbers.

Rollback: the helper extraction is behaviour-preserving and revertible in isolation;
the bin shim + fingerprint can be reverted to `bin.kb → dist/cli.js` without touching
the eval work.

## Open Questions

- None. The unreachable-list question is resolved in D4 (count in JSON, list behind
  `--verbose`).
