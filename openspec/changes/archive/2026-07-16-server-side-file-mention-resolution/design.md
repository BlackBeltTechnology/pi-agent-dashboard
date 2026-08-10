# Design — server-side file-mention resolution

## Problem framing

Today: `tokenize()` (client) is BOTH detector and resolver. It decides a span is
a file AND commits its resolved path, with zero filesystem knowledge. Every
mismatch between "looks like a path" and "is a real file" ships as a dead or
wrong link (measured: 774/1,713 links broken; 19/19 `~/…` mislinked).

Inversion: **detection stays on the client (cheap, synchronous, offline-safe);
resolution moves to the server (has the filesystem).** Crucially, resolution is
**lazy — performed on click / open, not at render** — so the render path keeps
its current synchronous, server-independent behavior.

## Evidence (12 recent chatlogs, 4,521 mentions, 41,842 repo files)

| Outcome | Count | % | Phase |
|---|---|---|---|
| abs/tilde/rel-to-cwd exists | 1,625 | 35.9% | 1 (deterministic) |
| unique basename search (tracked, stat-confirmed) | ≤326 | ≤7.2% | 2 (fuzzy) |
| ambiguous basename collision | 368 | 8.1% | **refuse** |
| not found | 2,202 | 48.7% | — |

`git ls-files` is tracked-only: the 182 "missed-but-resolvable" upside is an
**upper bound**; freshly-written untracked files the LLM just created are
invisible to it, so real Phase-2 yield is lower. Collision hotspots (why
auto-pick is forbidden): `spec.md` 1781, `tasks.md` 725, `AGENTS.md` 127,
`index.ts` 50, `package.json` 46.

## Decisions

### D1 — Resolution is LAZY (on click), not at render (revised after doubt-review)

The original draft pre-confirmed every mention via a per-message batch. Adversarial
review showed that regresses the interaction model: tool output STREAMS (text
mutates per chunk → re-tokenize → re-fetch), `LinkifiedText` mounts **per
tool-result string** (so "per message" is many batches), and swapping a rendered
span text→`<button>` on async confirmation causes a visible flash AND collapses
an in-progress text selection (violating the selection-preservation invariant).

**Revised model:** the client renders links synchronously. Phase 1 adds ONE new
client tokenizer branch (a leading `~/` file token) so tilde mentions become
clickable at all — every OTHER detection rule is unchanged. On **click**,
`FileLink` calls the server to resolve the mention and opens the resolved path
(or shows "not found"). This matches the original concept ("when the link is
opened, the existence check is made") and keeps rendering offline-safe.

TOCTOU (corrected framing): resolve (`POST /api/file/resolve-mention`) and open
(`/api/open-editor` or `/api/file`) are TWO requests, so a file can change
between them. This is NOT a security gap — the open route re-runs its own
containment gate independently, so a race yields not-found, never a wrong or
escaped file. The earlier "same click, no gap" phrasing was imprecise.

**Mention identity:** the client sends the token's processed `path` field (not
the verbatim `text`), so `file://` URIs and diff-prefixes are already normalized
before they reach the server; the server never parses a `file://` scheme.

**Click-path coverage:** the resolve-on-click contract covers ALL three open
paths in `FileLink` — external editor, preview overlay, AND the split-workspace
open. Decisions (user, this session): (G2) `canSplitOpen` ALWAYS routes through
server resolution too, for consistency (it currently short-circuits before
resolve). (G1) when a clicked mention resolves to null, the link renders an
INLINE not-found affordance (e.g. strikethrough / disabled) and makes NO open
call — not a toast, not a silent no-op.

Pre-confirmation (batch-validate to suppress dead links before click) is a
**Phase-2, opt-in** enhancement, not Phase 1 — see D6.

### D2 — Endpoint gates `cwd` BEFORE containment (security — the load-bearing fix)

`cwd` arrives in the request body and is **untrusted**. Containment anchored on
an attacker-chosen `cwd` is a tautology (`{cwd:"/etc",mentions:["passwd"]}`
"contains" `/etc/passwd`). Every existing file route (`/api/file`,
`/api/file/raw`, `/api/file/render`, `/api/file/exists`) gates `cwd` against
`sessionManager.listAll()` cwds + pinned dirs FIRST; `/api/file/exists` even
rejects relative probes for this exact reason.

`/api/file/resolve-mention` MUST:
1. run behind `networkGuard` (the dashboard advertises tunnel exposure —
   loopback is not guaranteed);
2. reject any `cwd` not in the known-session / pinned-dir set (403) **before**
   any resolution;
3. THEN expand `~`, resolve, run `isAllowed` containment, THEN `fs.stat`.

Containment-before-stat stays; the missing precondition (trusted anchor) is the
real boundary and is now explicit.

**Anchor-set precision (F6/F7):** only the cwd-VALIDATION step of
`/api/file/exists` is reusable — that route also rejects relative probes and
adds pinned dirs to the containment anchors (`Pinned-dir anchor is exists-only;
not folded onto read/raw/render`). The resolve endpoint MUST anchor containment
on the SAME set the eventual open route accepts (session cwd + git-root), NOT the
wider exists-only pinned set — otherwise resolve succeeds but the open 403s.

**Non-repo cwd latency (F11):** `isAllowed` layer-② spawns `git` (2s timeout)
only on a layer-① cwd-escape miss. In-cwd paths never spawn git. Out-of-cwd
mentions in a non-repo cwd would pay the git-spawn timeout per click — acceptable
(rare) but noted; do not call the resolve endpoint in a hot loop.

### D3 — Never auto-pick on ambiguity; fuzzy match MUST be stat-confirmed

Phase-2 fuzzy searches the **git index** (`git ls-files`), which lags the working
tree (staged-but-deleted, sparse-checkout, just-committed-then-removed). A unique
index hit is NOT proof of an on-disk file. The server MUST `fs.stat` the unique
candidate before returning it; a missing file → null (no dead link). >1 basename
match → null, never auto-select.

### D4 — Server owns re-rooting; client stops double-resolving (data flow)

`FileLink` currently calls `resolveLinkOrigin(cwd, path, absolute)` on every
render (client-side worktree re-rooting) and opens `openTarget`. Under lazy
server resolution the **server** returns the authoritative open-target (it knows
cwd + git root). To avoid double-re-root (`/wt/x/.worktrees/x/...`) or none:

- The token keeps the verbatim mention as its display text (join-coverage
  unchanged).
- On click, the client passes the server response's `resolved` absolute path
  DIRECTLY to `openFile` / preview / split-open; the resolved path is the
  contract that signals "already resolved," so the client **does not** run
  `resolveLinkOrigin` on it (no double re-root).
- The existing synchronous `resolveLinkOrigin` path remains ONLY as the offline
  fallback when the resolve call FAILS (D5) — a null result is not a failure.
- The `kind` field (`abs|tilde|relative|fuzzy`) is diagnostic/telemetry only;
  no client behavior branches on it (drop it if no consumer emerges).

### D5 — Error path: transient failure ≠ null

Server `resolved: null` means "no such file." A **fetch rejection / 5xx /
timeout** is different: the client MUST fall back to today's client-side
open behavior (best-effort `resolveLinkOrigin`) rather than declaring the file
absent, MUST catch the rejection (no unhandled promise, honoring the
fault-isolation invariant), and MUST NOT enter a reflash/retry loop.

### D6 — Phase 2 (opt-in): loose detection + pre-confirmation, cost owned

Only Phase 2 loosens client detection (bare `basename.ext`, no separator) to
capture the ~182 tracked-unique upside. Because loose detection also matches
prose (`math.PI`, `Node.js`, `README.md` in a sentence), Phase-2 loose candidates
render as **plain text until a batch pre-confirm** returns a real file — this is
where server-confirmation earns its place, and it updates the existing spec
requirement "bare `README.md` MUST NOT link" + the fuzz-corpus expectations.
Phase 2 owns the batch cost explicitly: debounce during streaming, cap mentions
per request, cache `(cwd, mention)` with a short TTL / session-scoped
invalidation, and skip entirely for non-repo cwds.

### D7 — Authorization boundary for out-of-cwd (home) files — DECIDED: Option A

The motivating files are `~/.pi/...` home config, which sit outside the project
cwd, so the `isAllowed(resolved, { anchors: [cwd] })` gate would reject them and
the tilde fix would return null for its own motivating files.

**Decision (user, this session): Option A — bounded `~/.pi` allowlist.** The
resolve endpoint AND the open/preview routes add a FIXED, server-side
containment anchor rooted at `path.join(os.homedir(), ".pi")` (NOT
attacker-supplied), alongside the existing cwd + git-root anchors. A resolved
path is authorized when it is contained by cwd, the git common root, OR `~/.pi`.

Security envelope (tightly bounded by construction):
- `~/.pi/dashboard/worktree-init-trust.json`, `~/.pi/agent/settings.json` →
  under `~/.pi` → authorized (local editor AND remote preview).
- `~/.ssh/id_rsa`, `~/.aws/credentials` → NOT under `~/.pi` → rejected.
- `~/../../etc/passwd` → not under cwd / git-root / `~/.pi` → rejected.
- The `~/.pi` anchor is a constant derived from `os.homedir()` on the server; a
  request can never widen it (unlike the untrusted `cwd`, which stays gated).
- Applies to BOTH the resolve endpoint's containment and the eventual open/
  preview route's containment, so resolve never succeeds on a path the open
  route would 403 (closes the F6 mismatch for the home case too).

## Open questions

1. Phase-2 cache invalidation granularity (TTL vs. fs-watch vs. session-scoped
   clear) — decide when Phase 2 is scheduled, not now.
2. Does Phase 1 want a lightweight "not found" affordance on click (toast) vs.
   silent no-op? Proposal picks a toast; confirm at build.

## Non-goals

- ESM `.js` → `.ts` source remapping (separate known gap).
- Eager filesystem indexing / a persistent file-name database.
- Multi-file disambiguation UI (a picker for ambiguous hits).
- Phase-1 pre-confirmation / any render-time server round-trip (explicitly
  deferred to Phase 2 per D1).
