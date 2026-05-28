## Context

The `add-rpc-stdin-dispatch-with-keeper-sidecar` change shipped in **v0.5.3** (2026-05-11) and has had one full release cycle of soak time through **v0.5.4** (2026-05-26) with no critical regressions. The parent change's tasks.md §13 explicitly defers the "default-on + legacy-removal" step to a follow-up change once that soak window clears. This change is that follow-up.

**One real bug surfaced during soak and was already fixed in-place** — `fix-rpc-keeper-pi-resolution` (archived 2026-05-27) discovered that `keeper.cjs`'s bare `spawn("pi", …)` failed `ENOENT` under Electron because the resource-bundled server has no `node_modules/.bin` on PATH. The fix added `resolvePiCommand()` at spawn time and forwards the absolute argv to the keeper via `PI_KEEPER_PI_CMD`. The fact that this bug only blocked **Electron-resume of an already-running keeper-spawned session** (not initial spawn) is itself a positive signal: the keeper path is exercised enough internally that a real-world resume-under-Electron edge case found a real defect, and the fix landed cleanly without touching the keeper gating. Confidence to flip default is higher post-fix than it would have been at v0.5.3 + 2 weeks of pure absence-of-bug-reports.

Current state in the working tree (verified 2026-05-27 post-`fix-rpc-keeper-pi-resolution`):

- `packages/shared/src/config.ts:310` — `DEFAULT_CONFIG.useRpcKeeper = false`. Schema field at L250, loader at L597.
- `packages/server/src/process-manager.ts:83-94` — `_setUseRpcKeeperOverrideForTests` + `useRpcKeeperOverride` module var + `shouldUseRpcKeeper()` runtime gate.
- `packages/server/src/process-manager.ts:454-462` — the `shouldUseRpcKeeper()` branch (now calls `resolvePiCommand()` then dispatches to `spawnHeadlessViaKeeper(cwd, env, args, piCmd)` for **both** Unix and Windows — uniform across OSes once flag is on).
- `packages/server/src/process-manager.ts:464-498` — the legacy fall-through: Unix uses the `sh -c "tail -f /dev/null | …"` shell wrapper (L478-481); Windows calls `spawnHeadlessDetached(cwd, bin, prefixArgs, args, env)` at L470, which itself lives at L589… and pipes pi's stdin directly from the dashboard server.
- `packages/server/src/__tests__/process-manager-keeper-spawn.test.ts` — exercises the keeper branch via 6 `_setUseRpcKeeperOverrideForTests(true)` setups (L112/158/187/210/226) plus one `(false)` legacy-path teardown (L241).
- `packages/extension/src/slash-dispatch.ts:130-135` — Path-D stopgap error message `RPC_KEEPER_HINT` literally instructs users to add `"useRpcKeeper": true` to their dashboard config. After this change, the flag no longer exists — the message text must be rewritten.
- `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts:108,196,311` — three assertions check that the stopgap error message contains the substring `"useRpcKeeper"`. Updated to match the new message text.

User-visible symptom while keeper is opt-in: every slash command typed in a dashboard-spawned headless session (`/ctx-stats`, `/curator`, `/agents`, `/flows:*`) returns the stopgap `command_feedback {error}` ("requires pi 0.71+") unless the user has hand-edited `~/.pi/dashboard/config.json`. The keeper architecture exists specifically to fix this. Default-off means default-broken.

## Goals / Non-Goals

**Goals:**

- Slash commands work in every dashboard-spawned headless session without user configuration.
- One spawn code path for `--mode rpc` sessions on Unix and Windows (the keeper path).
- "pi survives dashboard server restart" becomes uniform across Unix and Windows.
- Test surface shrinks: no more "flag-on vs flag-off" matrix in keeper-spawn tests.
- Documentation stops calling the keeper experimental.

**Non-Goals:**

- No changes to `keeper.cjs` or `keeper-manager.ts`. The keeper code ships unchanged.
- No changes to the bridge ↔ server protocol. `dispatch_extension_command` is unchanged.
- No changes to tmux / wt / wsl-tmux spawn paths. Their slash-command experience continues using the existing stopgap.
- No new bridge-side detection logic. The existing `isHeadlessRpcSession()` probe stands; it just no longer needs to additionally test for keeper presence (every headless session now has one).
- No introduction of a new opt-out flag. Anyone who needs to escape the keeper path can pin to a pre-this-change release.

## Decisions

### Decision 1 — Flip default AND remove the flag in the same change (one-step)

**What:** `DEFAULT_CONFIG.useRpcKeeper = false → true` and the field itself (`config.ts` schema entry, `process-manager.ts` `shouldUseRpcKeeper()` reader, `_setUseRpcKeeperOverrideForTests` test hook) are removed in the same commit.

**Rationale:**
- The legacy paths have known bugs (Windows loses pi on every server restart). Keeping them as an opt-out preserves a known-broken escape hatch.
- Two spawn paths means every future change to spawn env, crash detection, or PID tracking has to be made and tested twice. One release cycle has already passed without keeper regressions; doubling maintenance for a second cycle has diminishing returns.
- Users who explicitly set `useRpcKeeper: false` get silent migration: the field is ignored, they get the keeper. CHANGELOG migration note explains why.

**Alternative considered — two-step (flip default in this change, remove flag in a third change next cycle):**
- Pros: explicit one-cycle escape hatch for anyone whose legacy-path muscle memory matters.
- Cons: requires us to maintain two spawn paths for another full cycle; doubles the test matrix; the escape hatch points at the known-broken Windows behavior. The parent change already gave one cycle of opt-in availability — that was the escape window. Extending it indefinitely past default-on is over-cautious.

**Decision:** one-step. The CHANGELOG migration note is the user-facing communication; the field-removal is the implementation cleanup.

### Decision 2 — Legacy spawn paths deleted, not deprecated

**What:** The Unix `tail -f /dev/null | pi --mode rpc` shell wrapper and the Windows direct-stdin pipe branches in `process-manager.ts::spawnHeadless` are removed outright. `spawnHeadless` becomes "always go through the keeper".

**Rationale:**
- Dead code rots fast. A branch nobody exercises will silently break on the next refactor of `buildSpawnEnv`, `headlessPidRegistry`, or `waitForNoCrash` and we won't notice until someone tries to enable the flag.
- Removal forces test coverage to consolidate around the keeper path, which is what we actually ship.
- The keeper path's crash-detection window already covers the failure modes the legacy paths handled.

**Alternative considered — leave the code in place, gate behind `useRpcKeeper === false` deprecation warning:**
- Cons: same maintenance cost, plus user confusion about a flag that does nothing.

**Decision:** delete.

### Decision 3 — Bridge-side `isHeadlessRpcSession()` probe stays as-is; Path-D hint text is rewritten

(see also Decision 5 for the hint-text rewrite that this change forces)

#### Probe stays as-is

**What:** No change to the bridge's headless-detection logic in `slash-dispatch.ts`.

**Rationale:**
- The probe doesn't currently check for keeper presence; it checks whether the bridge is running in a headless RPC pi at all. The keeper-presence implication is automatic once every headless session has a keeper.
- Touching the probe would require coordinated bridge + server release, which we don't need.

**Decision:** the probe is unchanged. Spec language describing it may say "headless" instead of "headless + keeper" but the probe code itself is byte-identical.

### Decision 4 — Tmux / wt / wsl-tmux strategies are untouched

**Note:** the Path-D stopgap message in `slash-dispatch.ts` currently points users at `"useRpcKeeper": true`. After this change there is no such config flag, so the message must be rewritten. See Decision 5.



**What:** Those spawn paths continue without any RPC stdin channel. Slash commands typed in them still emit the stopgap error.

**Rationale:**
- The user's terminal owns pi's stdin in those strategies. The keeper architecture can't help — the terminal would have to give up stdin to the keeper, which defeats the point of using a terminal.
- The proper long-term fix for tmux / wt is upstream `pi.dispatchCommand` (Path B from `slash-command.md`).

**Decision:** out of scope. Path A → Path B remains the upgrade path for terminal-hosted sessions.

### Decision 5 — Path-D stopgap hint loses its `useRpcKeeper` reference

**What:** `RPC_KEEPER_HINT` in `packages/extension/src/slash-dispatch.ts:130-135` is rewritten. Today it says: *"Extension slash commands cannot be dispatched from the dashboard for non-headless (tmux/wt) sessions. If you're using headless mode, add `"useRpcKeeper": true` to your dashboard config."* After this change the second sentence is wrong (the flag no longer exists). The new text is roughly: *"Extension slash commands cannot be dispatched from this session shape (typically tmux / Windows Terminal sessions, where the user's terminal owns pi's stdin). Headless dashboard-spawned sessions support slash commands natively."*

**Rationale:** keeping the old message would point users at a removed config field, producing a worse error than today. The rewrite is the minimum surface change — same emit site, same `command_feedback` shape, just different message text.

**Decision:** rewrite, update the 3 test assertions in `bridge-slash-command-routing.test.ts`. Test assertions move from substring-match on `"useRpcKeeper"` to substring-match on a stable token in the new text (e.g. `"tmux"` or `"session shape"`).

## Risks / Trade-offs

- **[Risk]** A latent keeper-path bug surfaces post-flip that wasn't visible during the opt-in soak (most users left the flag off) → Mitigation: the CHANGELOG entry includes a one-line revert recipe (downgrade to v0.5.4 if regression hits). The keeper code itself has been on the codepath of every internal user with `useRpcKeeper: true` during the soak cycle; the team running with it default-on for two weeks of pre-release dogfooding is the practical mitigation.
- **[Risk]** Users with `useRpcKeeper: false` explicitly set in custom config silently switch path on upgrade → Mitigation: CHANGELOG `### Changed` entry calls this out; the field is silently ignored (no warning) because emitting a startup warning for a removed field rewards careful-config users with noise. They can delete the line at leisure.
- **[Trade-off]** No opt-out for one release cycle means a user hitting a keeper-path bug has no in-place workaround — they must downgrade. → Mitigated by the soak cycle that already happened; we are not flipping cold.
- **[Risk]** Test files outside `process-manager-keeper-spawn.test.ts` that call `_setUseRpcKeeperOverrideForTests` will fail to compile after the hook is removed → Mitigation: grep enumerates the call sites before edit; proposal §Impact already flags this.

## Migration Plan

1. Land this change (single commit / single PR).
2. CHANGELOG `[Unreleased] → Changed` entry includes:
   - "RPC keeper sidecar is now the default and only spawn path for headless RPC sessions."
   - One-line migration note: "Users who had `useRpcKeeper: false` in `~/.pi/dashboard/config.json` may delete that line — it is now ignored."
3. The next release cuts as normal. The flag's removal makes the version a minor bump (config schema change).
4. **Rollback strategy:** if a regression surfaces post-release, the user-facing recovery is to downgrade to the prior tag. There is no in-place flag to set. The keeper code itself remains unchanged from v0.5.4, so the regression would have to be in something else that this change touched (`spawnHeadless` cleanup, `headlessPidRegistry` updates, test wiring). Bisect within this change's diff.

## Open Questions

- None as of drafting. The proposal's Depends-On gate is now met. The implementation is mechanical — flip, delete, clean up tests, update docs.
