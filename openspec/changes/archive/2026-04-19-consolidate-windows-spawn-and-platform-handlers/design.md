## Context

Session spawning on Windows is broken in four distinct, user-visible ways (see proposal B1–B7). Investigation into each bug led repeatedly to the same conclusion: the fix for every one of them requires rewriting code that is *also* an obvious candidate for consolidation. Rather than fix-in-place and refactor-later, this design proposes to do both in one change, with the invariant that **every file touched is one that would be touched either way** — each rewrite is a consolidation target, each new file is a canonical home for logic currently scattered across three packages.

Current state of the scatter:

```
 Spawn/detach logic lives in 7+ sites:
 ─────────────────────────────────────
  process-manager.ts          3 spawn paths (tmux / wsl / cmd) + headless Windows
  server-lifecycle.ts         2 spawn paths (launchViaCli, launchServer)
  cli.ts                      1 detached node --import server spawn
  server-launcher.ts          1 detached node --import bridge auto-start
  session-action-handler.ts   3 Windows branches for kill/identify
  process-manager.ts:288-304  The WSL/cmd interactive fallback that DROPS
                              the sessionFile and mode options entirely —
                              the proximate cause of Windows fork failure.
```

Research performed during exploration established two important facts that shape this design:

1. **Windows lifecycle asymmetry is a bug, not a platform limitation.** Node's `spawn()` with `detached: true` on Windows emits `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` via libuv and critically does NOT call `AssignProcessToJobObject` on the global parent job (which has `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`). Source: `deps/uv/src/win/process.c` `uv_spawn`. Today's code uses `detached: false`, placing children in the parent job — hence they die when the dashboard dies. Fix: pass `detached: true`.
2. **Windows `pi.cmd` + `shell: true` is the wrong resolution.** `ToolResolver.resolvePi()` already returns `[node.exe, cli.js]` when the managed install is present. This avoids cmd.exe entirely, sidesteps Node issue #21825 (flashing console on `shell: true + detached + windowsHide`), and removes the arg-quoting fragility. The fix is to make that path the always-path, not the preferred-path.

## Goals / Non-Goals

**Goals:**

- Windows "Fork from here" and "Continue ended session" work correctly in every mode (terminal launch, Electron launch, headless, wt, wsl-tmux).
- Windows sessions survive dashboard server restart (PGID-equivalent lifecycle parity with Unix).
- Windows spawn latency drops to ≤ 400 ms on happy path (from current 1500+ ms).
- Spawn-and-lifecycle logic lives in exactly ONE place per concern: detached-spawn primitive, mechanism selector, process-identify primitive. Every caller delegates.
- Windows Terminal (`wt.exe`) becomes the preferred interactive mechanism on Win10/11, transparently falling through to WSL tmux → headless when absent.
- Dispatch is testable with injected `platform` and tool availability — no `process.platform` mutation, no `vi.mock`.
- An invariant guard test prevents regression: `process.platform === "win32"` outside `packages/**/platform/**` (plus a small documented seed allowlist) fails the build.

**Non-Goals:**

- Tools UI three-level disclosure redesign (separate change).
- Full sweep removing every remaining platform branch in `extension/process-scanner.ts` and `electron/dependency-detector.ts` — those remain on the guard allowlist as documented follow-ups.
- `CREATE_BREAKAWAY_FROM_JOB` or other stronger-than-libuv lifecycle guarantees — libuv's default `detached: true` behaviour is sufficient and mirrors Unix PGID parity.
- Changing the user-visible `SpawnStrategy` config type (`"tmux" | "headless"` stays). The internal `SpawnMechanism` is a separate, richer enum.
- Adding tunable crash-detection windows as user config — the window becomes a per-call parameter in code; values are chosen per site by developers.

## Decisions

### Decision 1 — Three primitives, not one

**Choice:** Separate `spawnDetached`, `waitForNoCrash`, and `waitForReady` as three independent functions that callers compose, rather than a single `spawnDetachedAndWait(...)` with option-union ambiguity.

**Why:** The seven call sites split cleanly into two "wait strategies": *negative* (did it crash?) used by bridge auto-start and Windows pi spawn, and *positive* (is it ready?) used by Electron/CLI server launch. Forcing both into one options bag produces an API where half the options are ignored depending on another option. Each primitive has a crystal-clear test matrix; composition is the caller's choice.

**Alternatives considered:**
- *Single `spawnDetachedAndWait` with `waitStrategy: "no-crash" | "ready"`.* Rejected: branching behaviour inside the primitive, larger test surface, worse error messages.
- *Three primitives but expose them behind a convenience wrapper per-use-case.* Maybe later; not worth it in the first pass — callers are short and clear already.

### Decision 2 — `SpawnMechanism` is a separate internal enum

**Choice:** Keep user-visible `SpawnStrategy` = `"tmux" | "headless"` unchanged. Introduce internal `SpawnMechanism` = `"tmux" | "wt" | "wsl-tmux" | "headless"`. `selectMechanism(ctx)` is the only mapping function between them.

**Why:** The user expresses preference ("I want an interactive terminal") without needing to know platform details. The system chooses the actual mechanism. Mixing these today (via `PlatformInfo.strategy: "tmux" | "wsl" | "cmd"` with implicit, untested mapping) is the source of the options-dropping bug.

**Alternatives considered:**
- *Add `wt` to `SpawnStrategy`.* Rejected: forces config migration, leaks platform detail to users, duplicates information.
- *Keep today's two-type-system and just fix the mapping.* Rejected: the tangle is the bug; making it explicit is the fix.

### Decision 3 — Windows defaults to `detached: true` inside the primitive

**Choice:** `spawnDetached` always passes `detached: true` to Node's `spawn()`, on all platforms. The name reflects intent; callers never need to think about it.

**Why:** This is the libuv-documented mechanism for "Windows PGID-equivalent." Making it the primitive's invariant makes every caller correct by default. The exception (attached children that should die with parent) isn't a use case we have; if it arises, use `child_process.spawn` directly with a load-bearing comment.

**Alternatives considered:**
- *Make `detached` a required option.* Rejected: the correct answer is always `true`; forcing callers to opt in invites mistakes.
- *Default to `true` on Unix, `false` on Windows (today's behaviour, just consolidated).* Rejected: this IS the bug.

### Decision 4 — Always use `stdio[0] = "ignore"` and `stdio[2] = logFd` for detached children

**Choice:** The primitive's stdio shape is fixed: `["ignore", "ignore", logFd?]`. Callers supply an optional file fd for stderr capture; they cannot ask for a pipe.

**Why:** Pipes owned by a parent that dies cause EPIPE on the child's next write. File fds survive. Every one of the 7 current sites that needs diagnostics already opens a file (`~/.pi/dashboard/server.log` or similar) — the primitive standardises the pattern.

**Trade-off:** Callers who want live stderr streaming can't have it. None of the current sites do; if needed later, add a sibling primitive (`spawnAttached` or `spawnWithPipes`).

### Decision 5 — Windows pi spawn resolves `node.exe + cli.js`, never `pi.cmd`

**Choice:** `ToolResolver.resolvePi()` on Windows returns `[node.exe, cli.js]` when either the managed install OR a discoverable `pi-coding-agent/dist/cli.js` is present. If only `pi.cmd` on system PATH exists, the primitive fails loudly with a clear error directing the user to run the setup wizard.

**Why:** Node issue #21825 (flashing console on `shell: true + detached + windowsHide + .cmd`), quote-escaping fragility in `.map(a => \`"${a}"\`)`, and cmd.exe's `/d /s /c` edge cases all disappear. Managed install is already the recommended path on Windows.

**Trade-off:** Users with only `pi.cmd` on PATH (rare — almost always means `npm i -g`) get a clearer error instead of a flaky spawn. Acceptable; the managed install is the supported config.

### Decision 6 — `wt.exe` in this change, not a follow-up

**Choice:** Include Windows Terminal detection + `wt new-tab` spawn in `selectMechanism` as part of this change.

**Why:** `spawn-mechanism.ts` is the file we are creating. Adding `wt` here is +30 LOC in the new file. Adding it later means touching the same file a second time, which violates the "every file is touched once" invariant of this change's scope.

**Detection:** `wt` joins the tool registry with a `where`-only strategy (no override, no managed fallback — it's a system tool). Win10 without Store-installed wt → registry returns `{ ok: false }` → selector falls through to WSL tmux → headless. No new failure mode.

### Decision 7 — Seed allowlist for the invariant guard

**Choice:** Ship `no-direct-platform-branch.test.ts` with a documented seed allowlist containing `extension/process-scanner.ts` and `electron/dependency-detector.ts` (existing, out of scope here). The three rewritten files (process-manager, server-lifecycle, session-action-handler) are NOT on the allowlist — they must be clean of direct `process.platform === "win32"` branches by the time this change lands.

**Why:** Empty allowlist would force this change to also clean up two files that have nothing to do with spawn. Seed allowlist keeps the change focused; each subsequent change can shrink the allowlist by one file.

### Decision 8 — ToolResolver injection seam for dispatch testing

**Choice:** Refactor `process-manager.ts` to accept an optional `resolver: ToolResolver` dependency instead of constructing one at module scope. Production code passes `new ToolResolver(...)` once; tests pass a fake.

**Why:** The current module-level `const resolver = new ToolResolver(...)` prevents dispatch tests from asserting "if `wt` is available, `selectMechanism` returns `'wt'`." The refactor is 5 lines and unlocks ~10 dispatch tests.

**Alternatives considered:**
- *Set a module-level mutable reference from tests.* Rejected: implicit global, conflicts with parallel vitest workers.
- *Skip dispatch tests, cover only `buildXCommand` helpers.* Rejected: misses the bug class this change exists to prevent.

## Risks / Trade-offs

- **[R1] Windows lifecycle change is user-visible** → Release note in README's Windows-specific section; documented as a bug fix ("sessions no longer die when the dashboard restarts"). Add a `/api/shutdown?kill-sessions=1` escape hatch in a follow-up if users request it.
- **[R2] `wt.exe` shim disabled by App-Execution-Aliases** → `where wt` finds the shim, launching it returns nonzero silently. Accepted: user sees no tab, retries, checks the documented troubleshooting note. Alternative probe (`wt --version` at boot) rejected as too slow.
- **[R3] Removing the `cmd /c pi` interactive fallback** → That fallback used `stdio: "ignore"`, so it was a ghost anyway (no visible terminal, no stderr). Removal matches what users already experienced; headless replacement gives them a working session instead of a ghost.
- **[R4] Changes to `resolvePi` on Windows may affect non-Windows callers** → The `resolvePi` function is only called from two sites (`process-manager.ts` Windows branch, Electron doctor). Non-Windows code paths untouched. Contract: function returns argv; callers never inspect contents.
- **[R5] `platform-process-identify` leaves Windows stubs** → Today's `killHeadlessBySessionId` returns `false` on Windows and `isPiProcess` returns `true` on Windows. The new primitive returns `[]` and `true` respectively. Observable behaviour is identical; future Windows PID-registry integration lives in one place instead of three.
- **[R6] Bridge extension `server-launcher.ts` uses its own detached spawn** → Migrated in this change so it uses `spawnDetached` + `waitForNoCrash(2000ms)`. The bridge extension ships with the dashboard, so version lock-step is fine.
- **[R7] Larger PR is harder to review** → Mitigated by a deliberate commit order inside the PR (see Migration Plan). Commits 1–3 are purely additive and reviewable in isolation. Commit 4 is the fulcrum; commits 5–9 are parallel-safe.

## Migration Plan

The change lands as a single PR, structured as nine commits for reviewability:

1. **Commit 1** — Add `platform/detached-spawn.ts` + `__tests__/detached-spawn.test.ts`. Zero production callers yet.
2. **Commit 2** — Add `platform/spawn-mechanism.ts` + `__tests__/spawn-mechanism.test.ts`. Includes `wt` branch. Zero production callers yet.
3. **Commit 3** — Add `platform/process-identify.ts` + `__tests__/process-identify.test.ts`. Zero production callers yet.
4. **Commit 4** — Rewrite `server/process-manager.ts` `spawnPiSession` body: delegates entirely to `selectMechanism` + the spawn primitives. Extend `server/__tests__/process-manager.test.ts` with Windows dispatch + fork-forwarding coverage (including an injectable resolver seam). **This commit fixes B1, B2, B3, B4, B5, B7, A1, A2, A3, A5 in one atomic change.**
5. **Commit 5** — Rewrite `electron/lib/server-lifecycle.ts`: both `launchViaCli` and `launchServer` migrate to `spawnDetached` + `waitForReady`.
6. **Commit 6** — Rewrite `server/browser-handlers/session-action-handler.ts`: `killHeadlessBySessionId` and `isPiProcess` delegate to `platform-process-identify`. The three `process.platform === "win32"` branches are removed.
7. **Commit 7** — Rewrite `extension/src/server-launcher.ts`: migrates to `spawnDetached` + `waitForNoCrash`. Same bundle shipped with dashboard.
8. **Commit 8** — Add `shared/__tests__/no-direct-platform-branch.test.ts` with seed allowlist (process-scanner, dependency-detector). Verifies the three rewritten files are now clean.
9. **Commit 9** — Update `AGENTS.md` (three new key-file rows), `docs/architecture.md` (Platform primitives → Spawn subsection), `README.md` (Windows lifecycle release note + optional `wt` recommendation).

**Rollback strategy:** If any single commit introduces a regression, revert that commit and the ones that depend on it. Commits 1–3 have no dependents and can remain. Commit 4 is the high-risk commit; if reverted, commits 5–7 are still useful (they fix independent issues). Commit 8 (the guard) depends only on the file rewrites being clean — if any of commits 4/5/6/7 are reverted, commit 8's allowlist must grow to cover them.

**Verification at merge time:**

- All unit tests pass on Windows + macOS + Linux (the QA VM harness is set up for this).
- Manual test: start dashboard, spawn a session, fork from a message, kill dashboard process, confirm session still running. Repeat on Windows (new behaviour) and Unix (existing behaviour).
- Manual test: on Windows 11 with `wt.exe` installed, spawn interactive session → see new tab in existing Windows Terminal window. On Windows 10 without wt → graceful fallback to headless.
