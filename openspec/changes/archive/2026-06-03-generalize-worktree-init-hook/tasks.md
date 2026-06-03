## 1. Hook engine (server)

- [x] 1.1 Generalize `packages/server/src/worktree-bootstrap.ts` into a hook engine (`worktree-init.ts` or in place): `readInitHook(repoRoot)` parses `.pi/settings.json#worktreeInit` → `WorktreeInitHook | null` (fail-open).
- [x] 1.2 `evaluateGate(cwd, hook)` spawns the bash `gate` in `cwd`; returns `{ needsInit: true }` iff exit code === 0. Errors fail-closed (`needsInit: false`) and log.
- [x] 1.3 `runInitHook(cwd, hook, onProgress)`: for `type: "script"` reuse the existing ring-buffer/throttle/timeout executor over `run.command`; for `type: "agent"` spawn a DETACHED headless pi (cwd, `prompt`, `model`, `settings`) writing combined output to `<cwd>/.pi/worktree-init.log`.
- [x] 1.4 `hookDefHash(hook)` = sha256 over a canonical serialization of the `worktreeInit` object.
- [x] 1.5 Unit tests: gate exit-0 → needsInit true; non-zero → false; malformed settings → null/fail-open; script run success/failure; hash stability + change-on-edit.

## 2. Trust store (server)

- [x] 2.1 Create `packages/server/src/worktree-init-trust.ts`: `isTrusted(repoRoot, hash)` / `recordTrust(repoRoot, hash)` persisted server-side, keyed by absolute repo root + hash.
- [x] 2.2 Unit tests: untrusted by default; trusted after record; hash change → untrusted again.

## 3. Endpoints

- [x] 3.1 `GET /api/git/worktree/init-status` (localhost-only): validate cwd, `readInitHook(repoRoot)`; when no hook → `{ hasHook: false }`; else evaluate gate (cached) → `{ hasHook: true, needsInit, trusted }`.
- [x] 3.2 Cache gate result per resolved checkout path with short TTL; invalidate on a hook run start/exit for that path.
- [x] 3.3 `POST /api/git/worktree/init` (localhost-only): require trust (hash match) else respond `init_untrusted` with the def for the client to confirm; on trusted run, stream `worktree_init_progress`, return `{ ran, durationMs?, code?, stderr? }`.
- [x] 3.4 Remove the post-create auto-bootstrap from `POST /api/git/worktree`; it returns success with no init side effect.
- [x] 3.5 Route tests: no-hook, needs-init true/false, untrusted → confirm flow, script success/failure, off-loopback 403.

## 4. Protocol

- [x] 4.1 Rename `worktree_bootstrap_*` → `worktree_init_*` in `packages/shared/src/browser-protocol.ts` (`progress` / `done` / `failed`, plus subscribe/unsubscribe).
- [x] 4.2 Add a trust-confirm round-trip message (client confirms def hash → server records trust).
- [x] 4.3 Update the registry (`worktree-bootstrap-registry.ts`) references/names for init streaming.

## 5. Client — Initialize button + trust + failure card

- [x] 5.1 Add `fetchWorktreeInitStatus(cwd)` + `runWorktreeInit(...)` to `packages/client/src/lib/git-api.ts`.
- [x] 5.2 In folder-action-bar / `WorktreeSpawnDialog`, show an "Initialize" button on a row iff cached init-status `needsInit === true`. Probe lazily; fail-open hides the button on error.
- [x] 5.3 First run for an untrusted hook → trust-confirm dialog naming the gate + run command/prompt; on confirm, record trust then run.
- [x] 5.4 Stream `worktree_init_progress` to a live tail; on `worktree_init_failed` render the spawn-error-style failure card with the stderr/log tail; on `worktree_init_done` clear and re-fetch init-status (button disappears).
- [x] 5.5 Component tests: button shown when needsInit, hidden when not; trust dialog gates first run; failure renders card; success removes button.

## 6. Migration

- [x] 6.1 Add `worktreeInit` to pi-dashboard's `.pi/settings.json`: `{ gate: "test ! -d node_modules", run: { type: "script", command: "npm ci" } }`.
- [x] 6.2 Verify a fresh worktree of pi-dashboard shows Initialize, runs `npm ci`, then the button disappears and Spawn works.
- [x] 6.3 Update `docs/file-index-server.md` rows for the renamed/added server files (delegate to docs subagent, caveman style).

## 7. Validation

- [x] 7.1 `openspec validate generalize-worktree-init-hook --strict` passes.
- [x] 7.2 `npm test` green; type-check clean.
