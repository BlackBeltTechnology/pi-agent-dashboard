# Design — friendlier-worktree-init

## Context

Init runs today via `runWorktreeInit({ cwd, requestId })`. The `requestId` is minted in the
browser (`winit-${Date.now()}-${counter}` for manual, `winit-auto-…` for auto-init) and is
the sole key for progress delivery: `worktree-init-registry.ts` maps `requestId → ws` and
drops the entry when that ws closes. This makes progress **non-portable** across the events
that matter — refresh, second tab, and the fire-and-forget auto-init that never subscribes.

The fix is to make **`cwd` the stable primary key** for run state and progress delivery.
cwd is naturally single-run-per-checkout (you cannot init the same worktree twice at once),
survives refresh, and is known at every trigger site.

## Key decision: cwd-keyed run registry (server-authoritative)

```
        MANUAL BUTTON ─┐
        AUTO-ON-SPAWN ─┼──▶  Map<cwd, RunState>  ──▶  progress deliverable by cwd
        REFRESH/2nd-TAB┘        (server source of truth)
```

```ts
interface RunState {
  phase: "running" | "done" | "failed";
  startedAt: number;
  lastLine?: string;      // drives the ghost preview
  logTail?: string;       // last ≤4KB, drives the opt-in <details>
  code?: number;          // failed only
  expiresAt?: number;     // terminal states only; TTL ~60s
}
```

- On `POST /init`: create/replace `Map[cwd] = { phase: "running", startedAt }`.
- On each progress line: update `lastLine` + append-bounded `logTail`; fan out to cwd
  subscribers (and, for back-compat, the requestId subscriber if present).
- On exit: set terminal phase + `code?` + `expiresAt = now + TTL`. Fan out done/failed.
- A sweep (or lazy check on read) evicts entries past `expiresAt`.

### Why keep requestId at all?
Back-compat + per-click correlation. requestId subscription remains an additional delivery
target; cwd is the durable one. Auto-init stops caring about its requestId entirely.

## New endpoint

```
GET /api/git/worktree/active-inits
  → { runs: Array<{ cwd, phase, startedAt, lastLine?, code? }> }
```

Returns running entries plus non-expired terminal entries. Client calls it once on boot to
rehydrate, then relies on the ws stream.

## Rehydration + lifecycle

```
Tier 1 — in-flight:   boot → active-inits → {phase:"running"} → chip rehydrates, keeps streaming
Tier 2 — terminal:    within TTL → done → "✓ Initialized" flash; failed → sticky "✕ … Retry"
Tier 3 — cross-tab:   cwd subscription → every tab shows the same state (free)
```

Dismiss rules:
- **success** auto-collapses after ~2s confirmation (never silent-vanish — user must see it worked).
- **failure** is **sticky**; only Retry or explicit dismiss clears it (never lose a failure to a timer).

## Init vs re-trust: two reasons the button shows

Button visibility is `hasHook && (trusted === false || needsInit === true)` — so it appears
for two distinct reasons that today look identical:

| `needsInit` | `trusted` | Real pending action | Chip label |
|---|---|---|---|
| `true` | any | assets missing → run the hook | **Initialize** |
| `false` | `false` | hook edited → re-approve it (TOFU) | **Review & trust changes** |
| `false` | `true` | nothing | (button hidden) |

Trust is keyed by `repoRoot + sha256(canonical(worktreeInit))` (`hookDefHash`,
`packages/server/src/worktree-init.ts`; store `~/.pi/dashboard/worktree-init-trust.json`,
`worktree-init-trust.ts`). Editing the hook changes the hash, invalidating prior trust — so a
fully initialized checkout re-shows the button purely to re-approve the changed hook. The
chip MUST read `needsInit` to pick its label; the trust-confirm dialog (already naming the
gate + run) is the correct affordance for the re-trust case and needs no init run when the
gate reports `needsInit === false`.

## Feedback surfaces (all views of the same RunState)

| Trigger | Surface | Rationale |
|---|---|---|
| Manual button (folder row) | status chip inline (variant **A**) | replaces raw `<pre>`; row layout intact |
| Auto-init on spawn | sub-state on spawn placeholder / session card (**D1**) | contextual, where the user is looking; no floating element |
| Background / multiple | corner stack (**C/E2**) | one summary surface; auto-shrinks |

The chip anatomy: `⚙ Initializing… · {elapsed}` + slim indeterminate bar + muted ghost of
`lastLine`; `▸ View log` reveals `logTail` in a collapsed `<details>`. Failure: `✕ Init
failed · exit{code} · {short cmd}` + `↻ Retry` + `▸ View log`.

Mockup of every state: `mockups/index.html` (serve with the bundled serve_mockup tool).

## Concurrent runs

N cwds → N `RunState` entries. The corner surface renders a header
(`Initializing N worktrees · M done · K failed`) over ≤4 rows (`+N more` overflow), each an
independent cwd. Stack fades when all settle; any `failed` row keeps it open until cleared.
The per-card D1 sub-state is unaffected — stack and cards read the same registry.

## Alternatives considered

- **Keep requestId, thread it through auto-init**: still dies on refresh; doesn't solve
  cross-tab. Rejected.
- **Poll gate-based `init-status` for "running"**: gate reports `needsInit`, not "a run is
  in flight"; can't distinguish running from not-yet-started. Rejected as the primary
  signal (still used to decide button visibility).
- **Toast-only (no card sub-state)**: detaches feedback from the worktree it belongs to;
  kept as the concurrent/background surface, not the spawn primary.

## Risks

- **stderr secret leak** in the opt-in log — mitigate by reusing the existing ≤4KB tail and
  not adding new capture; security-hardening review.
- **TTL race**: a refresh landing exactly at eviction shows nothing — acceptable (gate has
  flipped for success; failed within TTL is the guarded case).
- **Registry growth**: bounded by number of concurrent worktrees + TTL sweep.
