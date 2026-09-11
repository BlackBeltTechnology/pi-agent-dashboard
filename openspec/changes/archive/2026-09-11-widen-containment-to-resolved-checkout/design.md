## Context

See proposal.md — Why. Three things shape the approach:

- `packages/server/src/lib/path-containment.ts` is **async** (`execFile` +
  `promisify`, 2 s timeout) on the `GET /api/file*` request path. The shared
  resolver `checkoutRoots()` in `packages/shared/src/platform/git.ts` is
  **synchronous** (`run()` → `spawnSync`); the pure core is
  `resolveCheckoutRootsFrom(probes)` over injected thunks.
- `isAllowedCwd` in `packages/kb-plugin/src/server/kb-routes.ts` already uses
  `checkoutRoots({ timeout: 400 })` synchronously and rejects only a
  `.git`-segment `mainCheckout`. It is a Fastify request path.
- `packages/kb/src/config.ts` `loadConfig(cwd)` resolves `sources[].ref` with
  `isAbsolute(ref) ? ref : resolve(cwd, ref)` and `dbPath` the same way. So the
  "bounded reach — the store opens at the request's own cwd" argument change 1
  accepted is **refuted by reading the code**: an admitted cwd's
  `knowledge_base.json` can name any absolute path or `..` as a source and any
  absolute `dbPath`. Task 1.3 turns this reading into a test, but the design
  already assumes reach is unbounded and picks the strict rule.
- `isAllowed(resolved, { anchors })` is called from NINE sites (measured:
  `rg "isAllowed\(" packages/server/src`) with three anchor shapes:
  `[cwd]` — `gateFilePath` (`:195`, gates the EML routes AND the `open-in-system` /
  `reveal-in-file-manager` system-open endpoints) and `gateOfficeFile`
  (`:249`, office/render/sheet routes), `GET /api/file/tree` (`:490`), and the `grep-routes.ts`
  result filter; `[cwd, homePiAnchor()]` — `GET /api/file` read (`:350`),
  `/api/file/raw` (`:746`), `/api/file/render` (`:901`), and
  `resolve-file-mention.ts`; `[cwd, ...pinnedDirs]` — `GET /api/file/exists`
  (`:661`). There is NO containment site in `system-routes.ts` and no
  "preview" route — the main spec's fourth requirement and
  `packages/server/src/lib/AGENTS.md` both carry that stale claim; this delta
  corrects the enumeration. Layer 2 today runs `gitRoot(anchor)` for EACH
  anchor — `~/.pi` and every pinned directory already get git-root widening.
  This change keeps that per-anchor shape.

**Coordination:** `add-access-grants-and-review` (planned, unshipped) carries a
MODIFIED delta on the same `file-read-containment` requirement, adding a layer 3
and asserting "Layers 1 and 2 and their per-site anchor sets SHALL be
unchanged". The two are compatible — this change alters how layer 2 DERIVES an
anchor's checkout roots, not which anchors a site passes — but whichever
archives second must re-derive its delta against the then-current main spec
(task 5.4). The sibling's enumeration repeats the phantom "preview" site; the
measured nine-site list above is the one to keep.

Nine fixture states exist in
`packages/shared/src/test-support/git-fixtures.ts` (`buildGitFixtures()`):
normal, normalSubdir, worktree, submodule, submoduleWorktree, bare,
bareWorktree, separateGitDir, dotGitNamedCheckout, plus nonRepo.

## Goals / Non-Goals

**Goals:**

- Containment anchors = `{thisCheckout, mainCheckout}` of the session cwd, each
  BOUND to the repository, replacing `dirname(--git-common-dir)` and the
  `basename === ".git"` guard.
- One shared **repository-binding** check, used by both containment and
  `isAllowedCwd`, so "the repository owns this path" has a single definition.
- Refute-or-confirm the bounded-reach argument with a test, not prose.
- No event-loop blocking on the file route.

**Non-Goals:**

- Changing which routes are widened, their anchor sets, or rejection strings.
  The third and fourth `file-read-containment` requirements get MODIFIED
  deltas ONLY to replace "git common root" with the bound checkout roots as
  the boundary and to correct the site enumeration; anchor sets and strings
  are carried over verbatim.
- Restricting `isAllowedCwd`'s deliberately broad subdirectory admission.
- Constraining `knowledge_base.json` sources/dbPath (a separate change if
  wanted; this change only stops *pretending* they are bounded).
- Caching resolver results (layer 2 stays a cold path, D5 of the original
  containment change).

## Decisions

### D1 — Anchor set is `{thisCheckout, mainCheckout}`, not `thisCheckout` alone

The proposal's wording ("anchor on `thisCheckout`") would, for a linked
worktree, drop reach into the main checkout and break the spec-mandated
"worktree reads `…/repo/node_modules/…`" scenario — the original reason the
widening exists (hoisted `node_modules`). For every non-worktree state the two
fields are equal, so the set collapses to one anchor; for a worktree it is
`{wt, main}`. Confirmed with the user.

*Alternative rejected:* `thisCheckout` only — a silent narrowing that breaks
the primary use case.

**Reach per state** (layer 2 anchors after binding; layer 1 `cwd` always
applies). "Today" = current `dirname` + basename guard.

| State | thisCheckout | mainCheckout | Anchors | Today | Delta |
|---|---|---|---|---|---|
| normal | normal | normal | normal | normal | none |
| normalSubdir | normal | normal | normal | normal | none |
| worktree | wt | normal | wt, normal | normal | + own wt root when cwd is a wt subdir |
| submodule | sub | sub | sub | cwd-only | **+ own checkout** (never `<super>`) |
| submoduleWorktree | subwt | sub (core.worktree) | subwt, sub | cwd-only | **+ own wt, + submodule checkout** (never `<super>/.git/modules`) |
| bare | null | null | — | cwd-only‡ | none |
| bareWorktree | barewt | null | barewt | cwd-only | **+ own checkout** (never hub parent) |
| separateGitDir | app | app | app | cwd-only | **+ own checkout** (never `elsewhere.git` parent) |
| dotGitNamedCheckout | app.git | app.git | app.git | app.git | none |
| nonRepo | (no result) | | — | cwd-only | none |

‡ Except a bare repository whose directory is literally named `.git`
(`git init --bare /work/x/.git`): today the basename guard passes and reach is
`/work/x`; after this change `thisCheckout` is null → cwd-only. A silent
tightening in the safe direction; noted, not a goal.

No state gains reach outside checkouts its own repository owns.

### D2 — Repository binding = re-resolve the candidate and require the same `commonDir` + candidate is its own `thisCheckout`

A candidate anchor `A` (from `thisCheckout` or `mainCheckout`) is bound iff:

1. `!hasGitPathSegment(A)`;
2. `checkoutRoots({cwd: A})?.commonDir` `samePath` the cwd's `commonDir`;
3. that result's `thisCheckout` `samePath` `A`.

Why this exact rule (adversarial cases, all via repository-local `core.worktree`,
which git honors for `--show-toplevel` and which the resolver returns verbatim):

| `core.worktree` names | (1) | (2) | (3) | Bound? |
|---|---|---|---|---|
| honest main checkout / honest submodule checkout | ✓ | same | ✓ | **yes** |
| `/`, `$HOME`, `/tmp` (not a repo) | ✓ | no result | – | no |
| `$HOME` when `$HOME` is a dotfiles repo | ✓ | different | – | no |
| an unrelated KNOWN checkout (`/known/other`) | ✓ | different | – | no |
| `<repo>/.git/x` | ✗ | (same) | toplevel fails | no |
| `<main>/sub/dir` (subdir of the true main) | ✓ | same | measured† | no, or yes with A itself as the anchor |
| a sibling linked worktree of the same repo | ✓ | same | ✓ | yes — the repo owns it |
| nonexistent | ✓ | no result | – | no |

† Re-resolving `<main>/sub/dir` as a cwd discovers the same `.git` and the same
repository-local `core.worktree`, so git may well report `<main>/sub/dir` as
its own toplevel and rule (3) then PASSES. The design does not predict which;
the test measures it. Either outcome is safe: unbound → dropped; bound → the
anchor is `A` itself, a strict subdirectory of the real main checkout, so reach
is NARROWER than the honest case and never leaves the repository's checkout.
Rule (3)'s job is therefore only "the candidate is what git calls a checkout
root" — it closes "candidate lies inside our own repo's git dir even if (1)
were skipped" (`--show-toplevel` fails there), and guarantees an anchor is
never WIDER than what git reports as a toplevel.

The candidate is `realpath`ed BEFORE it is re-resolved as a cwd and before
every compare; the re-resolved `thisCheckout`/`commonDir` are canonicalized the
same way (`normalizePath` + realpath). Both consumers already canonicalize
(kb guard `canonPath`, containment `safeRealpath`); the helper does it itself
so neither can forget.

*Alternatives rejected:*
- Require `within(cwd, A)` — insufficient: `core.worktree=/` contains every cwd.
- Require `A` to directly contain a `.git` entry (the persistence shape test
  from change 1) — shape, not identity; `/known/other` passes it.
- Compare `--git-dir` instead of `--git-common-dir` — a linked worktree's git
  dir differs from main's; only the common dir is the repository identity.

**Shared helper**: `isBoundCheckout(candidate, commonDir, { timeout })` (sync)
and an async twin in `packages/shared/src/platform/git.ts`, next to
`hasGitPathSegment`. Both consumers call it; neither re-implements it. Any
probe failure or timeout inside the helper → `false`.

### D3 — Expose `commonDir` on `GitCheckoutRoots`

Binding needs the cwd's common dir. The resolver already has it; adding it as a
fourth, explicitly non-anchor field costs nothing and avoids a re-probe on both
request paths. Spec delta marks it as identity-only, never a trust anchor.
Confirmed with the user.

*Alternative rejected:* helper re-probes `--git-common-dir` on the cwd — +1
spawn per resolution on an authorization path for information already in hand.

### D4 — `checkoutRootsAsync()` over the same pure core

The file route must not block. Add an async wiring in `git.ts` that runs the
probes with `runAsync` in two phases, memoizes the answers, and feeds
`resolveCheckoutRootsFrom` with thunks returning the memoized values (a thunk
for a probe that was not pre-run throws, which the core maps to "failed" /
`"unknown"` exactly as a real failure). Phase 1: `--git-dir`,
`--git-common-dir`, `--show-toplevel`. Phase 2 is gated by the SAME predicate
the core uses — extract `isLinked(gitDirRaw, commonDirRaw)` (normalize + `samePath`)
and `wantsBareness(commonDir)` (`basename === ".git"`) from the core and call
them from both wirings, so the async pre-check cannot disagree with the core
about whether `core.worktree` / `core.bare` are needed. The classification
logic runs once, in one place. The parity scenario covers all fixture states
AND a degraded probe (injected `--show-toplevel` failure, and a `core.bare`
probe failure → `"unknown"`, never `"not-bare"`) so a wiring drift on the
failure path is caught too. Confirmed with the user.

*Alternative rejected:* call sync `checkoutRoots` from the route — a remote
caller can force layer 2 at will by requesting an out-of-cwd path, so a slow git
becomes an event-loop DoS.

`isAllowedCwd` stays synchronous. Probe arithmetic: resolving the cwd costs up
to 5 probes; binding re-resolves the candidate, which costs up to 5 MORE when
the candidate is itself a linked worktree (the honest "sibling worktree" case
that must be bound) — 10 probes, not 8. `kb-routes.ts` holds a load-bearing
"≤ 2 s synchronous worst case" invariant (its comment sets 400 ms × 5 for
exactly that reason). To keep it, the guard passes `timeout: 200` to both the
resolver and the binding check: 10 × 200 ms = 2 s. A healthy git answers in
~10 ms; a git that needs > 200 ms per probe fails closed to rejection, which
is the guard's existing degraded behaviour. The proposal's "a new probe" was
an undercount; this is the corrected budget.

Containment's cold path: ≤ 5 (cwd) + ≤ 5 (bind `thisCheckout`) + ≤ 5 (bind
`mainCheckout`) probes per anchor, each async with its own timeout — there is
no shared deadline (`runner.ts` timeouts are per-probe), so the bound is
latency-per-request, not event-loop time. Layer 1 short-circuits every in-cwd
read; the dedupe below removes one binding for every non-worktree state.

### D5 — `path-containment.ts` shape

`gitRoot(anchor): Promise<string>` is replaced by
`checkoutAnchors(anchor): Promise<string[]>` returning bound checkout roots
(possibly empty; `[]` on any failure), deduplicated by `samePath` BEFORE
binding so a non-worktree state binds once, not twice. `isAllowed` keeps its
existing per-anchor shape: layer 2 iterates the site's layer-1 anchors, and for
EACH computes `checkoutAnchors(anchor)`, skips a root `samePath` that anchor
(no widening), realpaths, `within`. Sites and their anchor sets are untouched;
`~/.pi` and pinned directories keep the widening they already have, now via
bound checkout roots instead of `dirname(common dir)`. The local `execFile`
probe and the `basename === ".git"` guard are deleted. Each probe keeps a 2 s
timeout (per-probe, via the async wiring's `timeout` option).

Tests move from inline `git init` to `buildGitFixtures()` (all nine states +
nonRepo), plus adversarial `core.worktree` fixtures set with
`git config --local core.worktree <path>` on the common dir at test time.

### D6 — Binding strictness: reject unbound, no tolerance path

Because reach past admission is unbounded (Context, and task 1.5's test), an
unbound `mainCheckout` is "no main path" → reject in the guard, and "no anchor"
→ dropped in containment. There is no "warn but admit" mode.

## Risks / Trade-offs

- [Widening is real: submodule / separate-git-dir / bare-worktree sessions gain
  their own checkout] → It is bounded to checkouts the repository owns (D1
  table); every "never" cell is a test. `security-hardening` pass enumerates
  the table against the fixtures.
- [Binding rule misfires on an honest setup and NARROWS containment (e.g. a
  worktree-of-submodule loses the submodule checkout)] → Positive-control
  tests for every honest state; failure mode is fail-closed (cwd-only), never
  over-reach.
- [`core.worktree` semantics for linked worktrees differ across git versions
  (whether the shared config's `core.worktree` affects `--show-toplevel` in a
  linked worktree)] → The design never assumes either; binding re-resolves and
  the tests MEASURE `thisCheckout` per fixture. If git ignores it, the case
  simply never arises.
- [Extra spawns on the file route's cold path (≤ 5 for roots + ≤ 3 per
  candidate for binding)] → Async, each bounded; layer 1 still short-circuits
  every in-cwd read. No caching by design.
- [Sync/async resolver drift] → Single pure core; parity test across fixtures.
- [`commonDir` on the result gets used as an anchor by a future consumer] →
  Spec text marks it identity-only; the doc row in
  `packages/shared/src/platform/git.ts.AGENTS.md` repeats it.
- [Task 1.3's test proves reach is unbounded and someone reads that as a new
  vulnerability to fix here] → Out of scope (Non-Goals); the test documents the
  premise for D6, nothing more.

## Migration Plan

No persisted data, no protocol change. `git.ts` is shared: the server picks it
up on restart (`curl -X POST http://localhost:8000/api/restart`), and the
bridge extension (`packages/extension/src/vcs-info.ts` calls `checkoutRoots`)
needs `npm run reload` so sessions and server run the same resolver. Rollback
= revert the commit; the previous fail-closed behaviour returns.

## Review

`doubt-driven-review`, planning stage, 3 cycles (same-model fresh-context +
cross-model on `@propose-review-1` = `zai/glm-5.3`, ran automatically).

- Cycle 1 — 5 actionable, folded: layer 2 is per-anchor at nine sites (D5 was
  cwd-scoped → would have silently changed `~/.pi`/pinned semantics);
  `core.worktree=<main>/sub` is NOT provably unbound (git honors it on
  re-resolve) → scenario is measured, both outcomes stay inside main; sibling
  `add-access-grants-and-review` deltas the same requirement → Coordination +
  task 5.4; guard probe count is 10 not 8 → 200 ms budget holds the 2 s ceiling;
  async phase-2 gating via predicates shared with the core + degraded-probe
  parity scenario. Trade-off accepted: layer 1 is logical, layer 2 realpath —
  an in-cwd symlink is allowed by layer 1 (pre-existing, out of scope).
- Cycle 2 — 3 actionable, folded: site inventory was copied from a stale
  `AGENTS.md` row (no `system-routes` site, no "preview" route; `/api/file/tree`
  was missing); main-spec req 3/4 still said "git common root" → MODIFIED
  deltas with scenarios verbatim; bare repo named `.git` tightens (D1 ‡).
  Reviewer found no new hole in D2 against the real resolver.
- Cycle 3 — 1 minor descriptive (`gateFilePath` also gates the system-open
  endpoints), folded. Stop condition: trivial findings.
- Noted, out of scope: raw route allows artifact-root images outside all
  anchors (`serve-agent-artifact-previews`), same wording gap as the current
  main spec.
