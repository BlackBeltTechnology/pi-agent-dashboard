## Context

The `+Worktree` dialog (added by archived change `add-worktree-spawn-dialog`) lets devs spawn a pi session in a new or existing git worktree of the current repo. The dialog flow works mechanically — server creates the worktree, browser sends `spawn_session { cwd }`, pi boots there. But two compounded bugs leave the flow silently broken for dev-on-pi-dashboard:

- Bug A: `.pi/settings.json` in this repo loads the bridge from a worktree-local TypeScript path (`source: ".."`, `extensions: ["+packages/extension/src/bridge.ts"]`). Fresh `git worktree` checkouts have no `node_modules/` — bridge imports throw, `register_session` never fires, `spawn-register-watchdog` times out at 30 s, the spawn ends up in `~/.pi/dashboard/sessions/spawn-failures.log` as `REGISTER_TIMEOUT`.
- Bug B: `spawnErrors: Map<cwd, …>` in `useMessageHandler` is the only sink for `spawn_error`. Banners render under matching folder action bars. Cwds outside the current workspace view (every sibling-worktree spawn) drop on the floor with zero feedback.

Confirmed during browser-driven repro:
- Click `Spawn →` on main row → `[gateway] session registered: 019e75f3 cwd=/Users/.../pi-agent-dashboard` ✓
- Click `Spawn →` on sibling-worktree row → no server log, `spawn-failures.log` gains REGISTER_TIMEOUT, UI unchanged.
- Inspecting the worktree: `node_modules/` absent. `packages/extension/src/bridge.ts` present but un-resolvable.

End users running stable pi-dashboard from npm are unaffected — their bridge resolves under `~/.nvm/.../node_modules/@blackbelt-technology/pi-dashboard-extension`, which always has deps. The fix surface is intentionally narrow.

## Goals / Non-Goals

**Goals:**
- Clicking `Spawn →` on any existing-worktree row of this repo either succeeds or shows a clear, actionable error within ~5 s.
- Creating a new worktree via `Create + Spawn →` produces a session whose bridge can actually load, without the user thinking about `npm install`.
- No `spawn_error` event ever drops silently. Every failure produces visible feedback.
- Zero behavior change for non-dashboard projects and for end-user-installed pi-dashboard.

**Non-Goals:**
- No change to the bridge protocol, `register_session` semantics, or pi extension loader.
- No general per-project install orchestration. The install step is gated on a precise heuristic (worktree-local-bridge), not "run npm install everywhere".
- No change to `headless-spawn`, `spawn-correlation`, or `spawn-register-watchdog` mechanics.
- No retroactive cleanup of the existing REGISTER_TIMEOUT entries in `spawn-failures.log`.

## Decisions

### Decision 1: Gate the bootstrap step on `.pi/settings.json` worktree-local-bridge detection

The post-create install step runs only when the repo's `.pi/settings.json` declares a bridge that resolves into the worktree itself. Concretely: at the time `POST /api/git/worktree` is called, the server reads `<repo-root>/.pi/settings.json` (the parent repo's, not the newly created worktree's) and looks for any `packages[]` entry where `source` resolves (relative to `.pi/`) to a directory that is the parent repo OR any of its descendants AND the extensions list references a path under that directory. If yes → bootstrap-required. Else → skip.

**Why this gate:** It precisely matches the dev-on-pi-dashboard configuration without leaking into unrelated projects. The same `.pi/settings.json` is what makes pi try to load the worktree-local TS bridge in the first place — so it's the right shibboleth for "this worktree needs node_modules to be useful".

**Alternative considered:** Always run install for every new worktree. Rejected: imposes 30 s – 5 min on workflows that don't need it (every other project where bridge comes from npm).

**Alternative considered:** Detect the broken state after the fact (post-spawn, by observing REGISTER_TIMEOUT) and offer a "retry with install" button. Rejected: trades one silent failure (no card) for a noisier one (30 s wait before any feedback). The settings.json shibboleth lets us pre-empt.

### Decision 2: Install command = detected via lockfile, fixed default `npm ci`

Server picks the install command by lockfile presence in the worktree:
- `package-lock.json` → `npm ci` (faster, deterministic, fails-loud on lockfile drift).
- `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`.
- `yarn.lock` → `yarn install --frozen-lockfile`.
- `bun.lock` / `bun.lockb` → `bun install --frozen-lockfile`.
- No lockfile → skip bootstrap, return `bootstrap_skipped` with reason `no_lockfile`. (Edge case for repos that ship `.pi/settings.json` but no lockfile; treated as misconfiguration of the repo, not our problem.)

**Why `npm ci`:** the dashboard repo uses npm + lockfile. `npm ci` is faster than `npm install` and fails on lockfile/`package.json` mismatch instead of mutating the lockfile. Users on broken lockfiles get a clear error.

**Alternative considered:** Always `npm install`. Rejected: mutates lockfile, slower, masks drift.

### Decision 3: Bootstrap progress streams via browser-gateway events, not HTTP chunked response

The existing `POST /api/git/worktree` is a one-shot JSON response. We keep that shape (no migration to streaming HTTP). The install step's progress streams via NEW browser-channel events on the websocket the requesting browser already has open. Server tags each event with the spawn `requestId` minted client-side (already round-trips through `spawn_session`; we'll require the worktree-create call to also carry it).

New events on `ServerToBrowserMessage`:
- `bootstrap_progress { requestId, cwd, line }` — one event per ~250 ms throttled, last 4 KB of stdout/stderr tail.
- `bootstrap_done { requestId, cwd, durationMs }` — install succeeded.
- `bootstrap_failed { requestId, cwd, code, message, stderr }` — install failed.

**Why not chunked HTTP:** would force a parallel non-WS streaming path for the dialog. The browser already holds the WS; reusing it costs one switch case in `useMessageHandler` and zero new client plumbing.

**Why throttle:** npm install streams hundreds of lines/sec. Unthrottled, the client churns through reconciles; throttled to ~250 ms, the user sees a live tail without RAM/CPU cost.

### Decision 4: HTTP response timing — return after bootstrap completes (or fails)

`POST /api/git/worktree` doesn't return until the bootstrap step finishes (or skips). On success: `{ path, branch, bootstrap: { ran: bool, durationMs?, skippedReason? } }`. On bootstrap failure: HTTP 200 with `{ success: false, error: "bootstrap_failed", stderr, message }` — the worktree itself was created, but the dialog should show the error and NOT auto-spawn pi.

**Why hold the response:** the client's existing `Create + Spawn →` handler reads `res.path` then calls `onSpawn(res.path, { gitWorktreeBase: base })`. If we returned early, we'd race the spawn against the install. Holding makes the existing flow correct without restructuring it.

**Trade-off:** the HTTP request hangs for 30 s – 5 min. Acceptable because (a) modern browsers don't time out idle HTTP that long, (b) progress events keep the UI honest, (c) failure cases get cancel via dialog Escape (server keeps installing in background but the spawn won't fire).

**Alternative considered:** return immediately, gate spawn on `bootstrap_done`. Rejected: more states for both client (`spawnRequestId` pending bootstrap_done) and server. Costs > benefit.

### Decision 5: Per-row `node_modules` probe in dialog uses a single cheap endpoint

Add `GET /api/git/worktree/bootstrap-status?cwd=<path>` returning `{ needsBootstrap: bool, reason: "no_node_modules" | "stale_lockfile" | "ok" | "not_required" }`. The dialog calls this for each existing-worktree row in parallel with the existing `GET /api/git/worktrees` fetch. UI degrades rows where `needsBootstrap === true && reason !== "not_required"`.

**reason values:**
- `not_required` — repo doesn't have worktree-local-bridge `.pi/settings.json`. Row renders as today.
- `ok` — bootstrap-required repo and `node_modules` looks healthy (exists + non-empty). Row renders as today.
- `no_node_modules` — bootstrap-required and `node_modules` missing. Row renders `⚠ Install deps first` button that, when clicked, runs the bootstrap (reuses the same flow as `Create + Spawn →`) and then spawns.
- `stale_lockfile` — bootstrap-required and `package-lock.json` mtime > `node_modules/.package-lock.json` mtime. (Treated as `no_node_modules` in UI for v1; reason carried for telemetry.)

**Why a separate endpoint vs. inlining in `GET /api/git/worktrees`:** the worktrees list endpoint is generic and used elsewhere. Bootstrap status is dashboard-dev-specific. Cleaner to keep concerns separate.

### Decision 6: Off-screen `spawn_error` toast — wire through existing `Toast` channel

`useMessageHandler.case "spawn_error"` already sets `spawnErrors`. Add: also compute `isVisibleCwd(cwd, pinnedDirectories, workspaces, sessions)` — true iff the cwd matches any pinned dir, any workspace.folders entry, or any existing session's cwd. When false, dispatch a toast via the existing `Toast` mechanism: `{ kind: "error", message: \`Spawn failed at ${cwd}: ${reason}\`, durationMs: 10_000, action?: "copy-path" }`.

**Why also keep `spawnErrors` map:** future spawns into newly-pinned dirs should still render the banner under the folder card. The toast is a fallback for the off-screen case, not a replacement.

**Why not always toast:** users with a visible folder banner would see two notifications for the same event. Keep the channels distinct.

### Decision 7: Place bootstrap logic in a new module, not in `git-operations.ts`

New file `packages/server/src/worktree-bootstrap.ts` with pure helpers:
- `detectBootstrapRequirement(repoRoot: string): { required: bool, reason?: string }`
- `pickInstallCommand(worktreePath: string): { cmd: string, args: string[], lockfile: string } | null`
- `runBootstrap(worktreePath: string, onProgress: (line) => void): Promise<{ ok, durationMs, stderr? }>`

`addWorktree` (in `git-operations.ts`) stays small. Route handler in `git-routes.ts` orchestrates: `addWorktree` → if `detectBootstrapRequirement` true → `runBootstrap` (streaming progress over WS) → respond.

**Why a new module:** keeps `git-operations.ts` focused on `git` subprocess wrappers. Bootstrap involves a different subprocess family (npm/pnpm/yarn/bun) and different streaming semantics. Easier to test in isolation.

## Risks / Trade-offs

- **Risk:** Install command runs as the dashboard server's user with the dashboard server's PATH. May not match the user's interactive shell PATH (nvm shims, etc.). → **Mitigation:** Reuse the same PATH resolution as `process-manager.ts` (which already handles this for `pi`). Surface the resolved `npm` binary path in `bootstrap_progress` first line for debugging.
- **Risk:** `npm ci` failure surfaces stderr but provides no remediation suggestion. → **Mitigation:** Map common stderr patterns (`EACCES`, `engine`, `ETARGET`, lockfile drift) to short hint strings rendered next to the error code. Keep mapping in `packages/server/src/worktree-bootstrap-errors.ts` with explicit tests.
- **Risk:** Long install (5 min) blocks the dialog. User may double-click `Cancel` → second worktree creation attempt → confusion. → **Mitigation:** Cancel during bootstrap closes the dialog but the server's bootstrap continues in the background to completion. The worktree is already created; aborting mid-install would leave a half-installed `node_modules` which is worse. Document this in `bootstrap-failed` reason `cancelled_client_side_install_continued`.
- **Risk:** `worktree-local-bridge` detection heuristic is too loose / too strict. → **Mitigation:** Heuristic is a pure function; cover with unit tests including (a) this exact repo's `.pi/settings.json`, (b) a project that has `.pi/settings.json` but bridges via `npm:`, (c) no `.pi/settings.json` at all.
- **Trade-off:** Per-row bootstrap-status endpoint adds N requests per dialog open (N = worktree count, typically 1–5). → Accept: cheap stat calls, run in parallel; dialog open is rare.
- **Trade-off:** Toast for off-screen `spawn_error` may be intrusive for users running many background spawns. → Accept: 10 s auto-dismiss, only fires for failures, only when banner has no home.

## Migration Plan

No data migration. No deprecated paths.

Rollout order:
1. Ship bootstrap-status endpoint + pure detection helpers + tests. No behavior change.
2. Ship dialog per-row probe + degraded button UX. Bootstrap can't run yet but at least row clearly says "Install deps first".
3. Ship bootstrap execution path + progress events + `Create + Spawn →` integration.
4. Ship `spawn_error` toast fallback.

Each phase is independently shippable behind no flag — the spec gate (worktree-local-bridge detection) is the natural rollout switch.

## Open Questions

- Should `⚠ Install deps first` button run the bootstrap inline (like `Create + Spawn →`) or open a separate "Bootstrap worktree" sub-dialog? **Tentative answer:** inline — fewer clicks, same progress UI surface. Confirm during specs phase.
- Do we offer a "skip bootstrap" override on the Create form for repos that want to manage install manually? **Tentative answer:** no for v1 — solves a hypothetical use case; add later if requested.
- Should the toast carry an action button to "Open spawn-failures.log"? **Tentative answer:** v1 = just the message + cwd. Action button is a nice-to-have for later.
