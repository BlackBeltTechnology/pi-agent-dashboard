# Test Plan — server-side-file-mention-resolution (Phase 1)

Adversarial scenario catalog. Manifest for the `plan-proposal` fold + `ship-change`
defer. Every row: id · class · technique · level · **disposition** · Triple.
Levels: L1 = vitest unit (`packages/*/src/**/__tests__`), L3 = Playwright e2e
(`tests/e2e/*.spec.ts`, docker harness — port from `.pi-test-harness.json`, not
`:18000`). Phase 2 scenarios are listed at the end, **deferred** (not folded).

## Server resolver + endpoint (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S1 | error-handling | decision-table | L1 | automated | `{cwd:"/etc",mention:"passwd"}`, `/etc` not a known session cwd · POST `/api/file/resolve-mention` · 403 **and** `fs.stat` never called |
| S2 | edge-case | EP | L1 | automated | `~/.pi/dashboard/worktree-init-trust.json` exists, known cwd · resolve · `{resolved:"<home>/.pi/dashboard/worktree-init-trust.json", kind:"tilde"}` |
| S3 | error-handling | boundary | L1 | automated | `~/.ssh/id_rsa`, known cwd · resolve · `null` (outside cwd/git-root/`~/.pi`) |
| S4 | error-handling | fault | L1 | automated | `~/../../etc/passwd`, known cwd · resolve · `null` (containment reject after expand) |
| S5 | edge-case | EP | L1 | automated | `packages/server/src/routes/file-routes.ts` under cwd · resolve · resolved rooted at cwd, `kind:"relative"` |
| S6 | edge-case | EP | L1 | automated | `foo.ts`, no such file · resolve · `null` (no error) |
| S7 | edge-case | boundary | L1 | automated | `~alice/x.ts` · resolve · `null`, tilde NOT expanded to another user home |
| S8 | error-handling | invariant | L1 | automated | path that fails containment · resolve · `fs.stat` spy asserts stat runs AFTER containment, never before |

## Open/preview honors ~/.pi anchor (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S9 | edge-case | EP | L1 | automated | resolved `~/.pi/agent/settings.json`, project cwd · GET `/api/file` read · 200 + content (anchor set includes `~/.pi`) |
| S10 | error-handling | boundary | L1 | automated | `~/.ssh/config`, project cwd · GET `/api/file` read · 403 (not under any anchor) |

## Client tokenizer — tilde branch (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S11 | frontend-quirk | state-pure | L1 | automated | `~/.pi/dashboard/trusted-paths.json` in text · `tokenize()` · ONE `file` token, path retains `~/…`, no orphan `~` text token, join-coverage holds |
| S12 | frontend-quirk | EP | L1 | automated | existing negatives (`Node.js`, `math.PI`, `and/or`) · `tokenize()` · unchanged (no new false-positive file token from the tilde branch) |

## Client FileLink — resolve-on-click (L1 component)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S13 | frontend-quirk | state-transition | L1 | automated | link for `~/.pi/agent/settings.json`, resolve mocked → resolved path · click · open called with the server-resolved path |
| S14 | error-handling | state-transition | L1 | automated | resolve mocked → `null` · click · link shows INLINE not-found affordance (strikethrough/disabled), NO open call (G1) |
| S15 | error-handling | fault | L1 | automated | resolve mocked → 5xx/network reject · click · falls back to client-side `resolveLinkOrigin` open; rejection caught (no unhandled promise); not treated as null |
| S16 | frontend-quirk | invariant | L1 | automated | worktree session, resolve → absolute path · click · open target equals server path exactly (no double `resolveLinkOrigin` re-root) |
| S17 | frontend-quirk | state-transition | L1 | automated | cwd-relative token in split-workspace · click · `canSplitOpen` routes THROUGH resolve endpoint (G2), not a client short-circuit |
| S18 | frontend-quirk | invariant | L1 | automated | message with N file mentions · initial render (mount) · zero resolve calls fire until a click (lazy invariant, offline-safe render) |

## End-to-end (L3, docker harness)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S19 | frontend-quirk | state-convergence | L3 | automated | real tool-output message containing `~/.pi/agent/settings.json` in the harness · click the link · preview overlay/editor opens the resolved home file (not a `/`-rooted 404) |

## Manual-only (not folded)

| id | class | level | disposition | note |
|----|-------|-------|-------------|------|
| M1 | performance (subjective) | — | manual-only | Remote/tunnel: click→open latency (one resolve round-trip) "feels acceptable". No spec threshold → not automatable; post-merge manual check. |

## Phase 2 — deferred (listed, NOT folded into this change)

| id | class | note |
|----|-------|------|
| P2-1 | edge-case | unique tracked basename (`monaco-setup.ts`), stat-confirmed → resolves |
| P2-2 | error-handling | unique tracked file deleted on disk → `null` (no dead link) |
| P2-3 | edge-case | colliding basename (`tasks.md`, many) → `null`, never auto-picked |
| P2-4 | error-handling | non-repo cwd → fuzzy skipped |
| P2-5 | frontend-quirk | loosened bare-basename candidate stays plain text until batch pre-confirm (fuzz-corpus MODIFIED rule) |
