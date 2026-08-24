---
session: 019e1307
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (11 user prompts)"
upgrade_status: pending
openspec_changes: [add-rpc-stdin-dispatch-with-keeper-sidecar]
proposal_excerpt: "Pi 0.74's `ExtensionAPI` still does not expose `dispatchCommand`, `prompt`, or any path to `AgentSession._tryExecuteExtensionCommand`. Typed extension slash commands in the dashboard chat (`/ctx-stats`, `/curator`, `/…"
---

# How we did it: RPC stdin dispatch with a keeper sidecar — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `Is there anything to clarify?` — a probe, not a spec. The
real objective landed in prompt 2: **apply an OpenSpec change**
(`add-rpc-stdin-dispatch-with-keeper-sidecar`) — a 71-task, spec-driven change that adds
a **keeper sidecar** (`keeper.cjs`) so the dashboard can dispatch typed extension slash
commands (`/ctx-stats`, `/curator`, …) into a headless `pi --mode rpc` session over a
Unix-domain socket / Windows named pipe, because pi 0.74's `ExtensionAPI` exposes no
`dispatchCommand` path. The genuine goal was **land a clean, tested slice of that change
and prove it works against the running Electron-attached dashboard** — not blindly grind
all 71 tasks.

## 2. TL;DR playbook

1. **Kick off with the OpenSpec apply skill** naming the change:
   `openspec instructions apply --change add-rpc-stdin-dispatch-with-keeper-sidecar --json`.
2. **Force a scope check before grinding.** Have the AI read `proposal.md` + `design.md`,
   enumerate the phases, and flag which tasks are non-code (manual smoke tests, upstream
   PRs, deferred cleanup). Agree a slice: *Phase 1 preflight + Phase 2 sidecar, then pause*.
3. **Do preflight empirically** — confirm the prerequisite change archived, confirm
   `pi --mode rpc` really dispatches `/ctx-stats`, confirm `dispatchCommand` is still absent
   in the pinned pi. Capture findings in `notes/preflight-rpc-dispatch.md`.
4. **Build the sidecar** (`keeper.cjs`, pure CJS, Node built-ins only): bind-before-spawn
   with one stale-socket retry, 300 ms crash window, single unified shutdown path. Smoke it
   with a **fake `pi` shim** before writing real tests.
5. **To test against your Electron app**, switch it into **attach mode**: run
   `pi-dashboard` from the monorepo on :8000, then launch Electron — its resolver chain
   (`attach → devMonorepo → …`) attaches to your source server instead of the extracted copy.
6. **Write vitest tests** as `.test.ts` drivers that spawn the `.cjs` under **bare `node`**
   (preserves the CJS-purity contract). Give each test a **short per-test `HOME`** under
   `/tmp` to dodge the macOS `sun_path` 104-byte limit.
7. **Land phases incrementally with a full-suite regression gate** after each
   (`npm test` → all files green), pausing for review at phase boundaries.
8. **Wire the flag last**: add `useRpcKeeper` (default `false`) to config, branch
   `spawnHeadless`, deploy via `pi-dashboard restart`, flip the flag in
   `~/.pi/dashboard/config.json`.

## 3. How the collaboration unfolded

**Phase A — Scope reality check (Discovery).**
The AI read the proposal + design and produced a 13-phase / 71-task map, explicitly
tagging the tasks it *couldn't* do in-tree (manual smoke tests 9.2–9.5, upstream PR 12.1,
deferred cleanup Phase 13). *Why it worked:* surfacing non-code and deferred tasks up front
stopped the model from either faking them or grinding the whole change in one shot. The
human chose a **Phase 1 + Phase 2, then pause** slice.

**Phase B — Empirical preflight.**
Rather than trust the spec's assumptions, the AI verified them live: prerequisite change
archived (`slash-dispatch.ts` present), `pi --mode rpc` dispatches `/ctx-stats` via
`session.prompt` on pi 0.74, and `dispatchCommand` has zero references in the pinned pi.
Findings written to `notes/preflight-rpc-dispatch.md`. *Why it worked:* the whole change
exists *because* Path B is unavailable — re-confirming that empirically de-risks the rest.

**Phase C — Sidecar build + smoke.**
`keeper.cjs` written mirroring existing CJS/process-manager conventions. The AI smoke-tested
it end-to-end with a **fake `pi` shim** (bind socket, write PID, forward a JSON line, SIGTERM
→ unlink + EOF → exit 0) *before* touching vitest. *Why it worked:* an ad-hoc shim proves the
happy path in seconds and isolates real bugs from test-harness noise.

**Phase D — Deploy path for the Electron app (a steering-driven detour).**
The operator asked whether building server+bridge was enough to test in the Electron app.
The AI explained the resolver chain and switched the app into **attach mode** so it points at
the monorepo server. A decision point: a packaged Electron app runs an *extracted* server —
rebuilding the monorepo does nothing for it unless you attach.

**Phase E — Tests, then incremental wiring (Verify → Generate).**
Keeper tests, then `KeeperManager` (Phase 4), then `spawnHeadless` integration + config flag
(Phase 5). Every phase ended with a **full `npm test`** (grew 5355 → 5374 tests) and a pause
for review. Two real keeper bugs surfaced *through* the tests (crash-detection race; dropped
resume/fork args) and were fixed immediately.

## 4. Prompts that worked

- **Goal prompt (as-run):** `Is there anything to clarify?` — weak on its own. The
  **stronger kickoff** is: *"Apply OpenSpec change add-rpc-stdin-dispatch-with-keeper-sidecar.
  Read proposal + design first, map the phases, flag non-code / deferred tasks, propose a
  reviewable slice, and pause before grinding."*
- **High-leverage steering:**
  - `-use web and check` (prompt 3) — forced the AI to **verify a platform assumption**
    (Windows named-pipe cleanup) against authoritative Node + Win32 docs instead of guessing.
  - `is it enough to build the server, bridge to test?` (prompt 4) — a scoping question that
    unlocked the whole attach-mode deploy story.
  - `Continue with Phase 4` / `yes` — tight phase-gate unlocks after each review pause.
  - `Resuming is not resuming the session … Maybe later fix will address this?` (prompt 11) —
    a **bug report framed as a question**; the AI correctly owned it as a Phase-5 regression
    rather than deferring.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a 71-task change as one grind | Implicitly, via the apply skill's pause-and-review rhythm | State "reviewable slice, then pause" in the kickoff prompt |
| Assert a platform assumption (Windows pipe unlink) from memory | `-use web and check` | Add "verify platform/OS claims against docs" to the standing rule |
| Assume monorepo rebuild reaches the Electron app | `is it enough to build the server, bridge to test?` | Know the resolver chain: packaged app runs *extracted* server; use **attach mode** to test source |
| Silence an unused arg (`_piArgs`) instead of wiring it | Bug report: "resuming is not resuming" | Treat an `_`-prefixed unused param on a data-carrying value as a red flag, not a lint fix |
| Report "deploy done" from indirect signals | Operator's "is the instance ok now?" | Verify with concrete checks (server PID, source path in argv, `mtime` vs uptime) |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session — but two **reproducible techniques** emerged
and are worth capturing as project skills:

- **"Test a CJS sidecar binary under bare node from a `.test.ts` driver."** The vitest glob
  is `*.test.ts`, but the binary-under-test must stay CJS-pure (no jiti/tsx). Solution: TS
  driver spawns the `.cjs` under bare `node`. *Invoke when* adding any standalone Node binary
  to this monorepo that must not depend on the TS loader.
- **"Switch the Electron app to attach-mode against the monorepo server."** Quit the app →
  free :8000 → start `pi-dashboard` from the monorepo → relaunch Electron; its
  `attach → devMonorepo → …` resolver points the Chromium shell at your source server.
  *Invoke when* you need to test server/bridge/keeper source changes through the real Electron
  UI. (A `switch-extension-source`-style skill for the *server* would formalize this.)

## 7. Pitfalls & dead ends

- **macOS `sun_path` 104-byte limit.** `npm test` sets `HOME` under `/var/folders/…` (73+
  chars); the keeper's UDS path then overflows and bind fails — but a standalone run with the
  real short `HOME` passes. *Fix:* give each test a short per-test `HOME` under `/tmp/pXXX`.
- **Crash-detection race.** `child.on("exit")` always beat the 300 ms crash timer and forced
  exit 0, so the crash path could never set exit 1. *Fix:* unify both paths — the exit handler
  checks elapsed time and chooses 1 vs 0.
- **Dropped resume/fork args.** `spawnHeadlessViaKeeper` ignored `buildHeadlessArgs(options)`
  and `keeper.cjs` hardcoded `["--mode","rpc"]`, so `--session-file` / `--fork` were silently
  dropped → resume started fresh. *Fix:* pass the args array through via a `PI_KEEPER_PI_ARGS`
  JSON env var, stripped from pi's env before spawn.
- **`ask_user` selection didn't register** (prompt 10 was a re-answer). If a choice doesn't
  land, ask the operator to state it in plain text and move on.
- **Standalone `node` + jiti couldn't cleanly import the TS `spawnPiSession` exports** for a
  one-off keeper smoke — don't fight the loader; verify the deploy is healthy and exercise the
  path from the UI instead.

## 8. Reproduce it faster — checklist

- [ ] Kick off: `openspec instructions apply --change add-rpc-stdin-dispatch-with-keeper-sidecar --json`; have the AI map phases + flag non-code/deferred tasks; agree a slice.
- [ ] Preflight empirically (prerequisite archived, `pi --mode rpc` dispatches, `dispatchCommand` absent) → write `notes/preflight-rpc-dispatch.md`.
- [ ] Build `keeper.cjs` (bind-before-spawn + one retry, 300 ms crash window, single shutdown path); smoke with a fake `pi` shim.
- [ ] Attach Electron to the monorepo server: quit app → free :8000 → `pi-dashboard` from monorepo → relaunch app.
- [ ] Write `.test.ts` drivers spawning the `.cjs` under bare `node`; short per-test `HOME` under `/tmp`.
- [ ] Land phase-by-phase (`KeeperManager` → `spawnHeadless` + `useRpcKeeper` flag), full `npm test` gate + pause after each.
- [ ] Deploy: flip `useRpcKeeper: true` in `~/.pi/dashboard/config.json`, `pi-dashboard restart`, verify via server PID + source path in argv.

**Key inputs:** the OpenSpec change (`proposal.md`, `design.md`, `tasks.md`), a pinned pi
(`@earendil-works/pi-coding-agent@0.74.0`), and write access to `~/.pi/dashboard/config.json`.

**Artifacts produced:** `packages/server/src/rpc-keeper/keeper.cjs`,
`keeper-manager.ts`, their `__tests__/*` (+ `fixtures/mock-pi.cjs`, `mock-pi-shim.sh`),
`process-manager-keeper-spawn.test.ts`, edits to `packages/shared/src/config.ts` and
`packages/server/src/process-manager.ts`, and
`openspec/changes/add-rpc-stdin-dispatch-with-keeper-sidecar/notes/preflight-rpc-dispatch.md`.
Progress: **32/71 tasks** (Phases 1–5), full suite green (5374 tests).

---

_Generated from session `019e1307` · `pi-agent-dashboard` · 2026-05-10. Source extract: `/tmp/session_facts.wuzWb1.md`._
