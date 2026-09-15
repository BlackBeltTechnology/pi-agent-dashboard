## Context

See `proposal.md` — Why. Four independent server surfaces, each with a stricter sibling already in the tree:

| Surface | Today | Stricter sibling that exists |
|---|---|---|
| `openspec_refresh` (`browser-handlers/directory-handler.ts` → `directoryService.refreshOpenSpec`) | only `openspec.enabled` gate; force-polls any `cwd` | `getOrPollOpenSpec` gate chain: enabled → `isOptedOutCwd` → `isTrackedCwd` → `hasOpenSpecRoot` |
| `DELETE /api/paired-devices/:id`, `POST /api/pair/approve` (`routes/pairing-routes.ts`) | `networkGuard` (admits `authVia === "device"`) | `createOperatorGuard` on `POST /api/paired-devices` |
| `git-operations.ts` `addWorktree`, `addWorktreeFromPr`, `mergeWorktree`, `pushBranch`, `createPullRequest`, `worktreeDiffStat`, fetch, hint verifies, `run`/`tryRun` | `execSync(string)` + `shellEscape` | `removeWorktree` / branch delete / `pruneWorktrees` already argv via `execFileSync` / `spawnSync` (#512) |
| Host gate default (`auth/host-gate.ts` `resolveHostGateMode`) | `report` | `enforce` mode fully implemented and spec'd, opt-in |

Constraints: no shared-type or protocol change; `platform/exec.js` wrappers stay the only child-process import (`windowsHide`); tests spy `platformExec.execFileSync` / `spawnSync` (pattern in `__tests__/git-worktree-lifecycle-ops.test.ts`); `git-operations.ts` reaches its own exports through `self.*` so internal calls stay spy-able.

## Goals / Non-Goals

**Goals:**
- Each surface uses the guard its sibling already uses; no new guard concept.
- Argv migration is behaviour-preserving: same exit-code → error-code mapping, same timeouts, same stdout trimming.
- Host-gate flip is a one-constant change plus the copy/docs that describe the default; the opt-out already exists.

**Non-Goals:**
- Tightening `approve` to session-only (dropping the genuinely-local admission `qr-device-pairing` already forbids in prose). That is a pre-existing spec/impl gap and a separate decision.
- `X-Forwarded-Host` handling; per-hostname tightening of `*.local`.
- Migrating `tryRun` call sites whose command is a constant string beyond what the signature change forces.
- Any change to `getOrPollOpenSpec`.

## Decisions

### D1 — `openspec_refresh` reuses the D6 gate chain inside `refreshOpenSpec`, not in the handler

Put the gates in `directoryService.refreshOpenSpec(cwd)` (after the existing `cfg.enabled` check, before the `try`), in the same order as `getOrPollOpenSpec`: opt-out → tracked → root. A gated call returns the same finalized placeholder shapes `getOrPollOpenSpec` returns (`OPTED_OUT` / `ABSENT`) **without** writing the cache and without spawning. `handleOpenSpecRefresh` then broadcasts only when the returned payload is not a gated placeholder — simplest: `refreshOpenSpec` returns `null` for a gated call and the handler skips the broadcast on `null`.

*Why in the service:* `refreshOpenSpec` is also called by server code (`handleOpenSpecBulkArchive` post-archive refresh); those callers pass tracked cwds and are unaffected, and putting the gate at the one choke point means a future browser-side caller cannot forget it. *Why `null` instead of a placeholder broadcast:* the client only renders folders for tracked cwds, so a broadcast for an untracked cwd has no consumer; silence matches `openspec_get`'s "no broadcast" rule for gated answers.

*Alternative rejected:* gating in the handler only — leaves `refreshOpenSpec` itself un-gated for any future internal caller with a caller-supplied cwd.

Tracked-cwd gate runs BEFORE `hasOpenSpecRoot` (an `fs.stat`) so a hostile cwd never touches the filesystem — same X8 ordering as `getOrPollOpenSpec`.

### D2 — Swap `preHandler` to `operatorGuard` on revoke and approve; validate label at the route

`pairing-routes.ts` already builds `operatorGuard` from `createOperatorGuard({ localToken, hostAdmission })`; the two routes swap `networkGuard` → `operatorGuard`. This is the one-line change #665 was designed for. The operator guard also applies Host admission in enforce semantics on these routes regardless of the global mode — accepted, since D4 makes enforce the default anyway.

Label bound: validate in the route handler, mirroring the mint route's existing check (`trim`, `Buffer.byteLength ≤ MAX_DEVICE_LABEL_BYTES`, `400` otherwise), and pass the trimmed value to `pairing.approve`. Not inside `PairingManager.approve` — the manager has no HTTP status vocabulary and the bound is a transport-level concern the mint route already owns.

*Residual (recorded, not fixed):* `qr-device-pairing` says approval "SHALL NOT honor any loopback/tunnel exemption"; `operatorGuard` admits genuinely-local callers. Today's `networkGuard` admits strictly more, so this change narrows the gap without closing it. Filed as an open question below.

### D3 — Argv migration: change `run`/`tryRun` to take `string[]`, delete `shellEscape`

`run(argv: string[], cwd)` → `execFileSync(argv[0], argv.slice(1), { cwd, encoding, stdio, timeout })`; `tryRun` unchanged in shape. Every caller becomes an array literal (`["git", "rev-parse", "--verify", `refs/heads/${base}`]`). The sites that concatenate `args.map(shellEscape).join(" ")` (`createPullRequest`, `pushBranch`) already hold an argv — they just stop joining it. `worktreeDiffStat` passes `${base}..${branch}` as one element. `mergeWorktree`'s three `execSync` calls (`checkout`, `merge --no-ff`, `branch -d`) become `execFileSync` with the same `stdio`/`timeout` options.

Error mapping: `execFileSync` throws the same `{ status, stderr, stdout }` shape as `execSync`, so `classify*`/stable-code logic that inspects `stderr` is unchanged. The `2>&1`-style capture is not needed at any migrated site (the only one that needed both streams was `pruneWorktrees`, already `spawnSync`).

`shellEscape` is deleted with its last caller; a repo grep for `execSync(` in `git-operations.ts` must return zero hits — pinned by a test that imports the module source and asserts the token is absent, so the property cannot silently regress.

*Alternative rejected:* keep `execSync` and fix `shellEscape` for `cmd.exe` — there is no quoting scheme that is safe for both `sh` and `cmd.exe`; argv is the only platform-neutral form, and it is what the rest of the file already uses.

### D4 — Flip the resolved default in `resolveHostGateMode`; do not touch mode resolution order

`configMode ?? "report"` → `configMode ?? "enforce"`. Env still wins; config still applies live. `server.ts` gains one boot line stating the resolved mode and its source (`env` / `config` / `default`) so a locked-out operator reading `server.log` sees why. Client `?? "report"` fallbacks in `SettingsPanel.tsx` (3 sites) become `?? "enforce"` so the mode control shows the real effective default when `hostGate.mode` is absent; `AllowedHostsSection` copy that says the default is report-only is updated.

*Why now:* `add-host-allowlist-admission` said "flipping the default to enforce is a later, separate change once report-only logs are clean". The admitted set already covers every population the harness, docs, and tunnel flows use (loopback, IP literal, `.local`, `publicBaseUrls`, live tunnel, `allowedHosts`), and the refusal page is self-describing. There is no telemetry that would ever declare logs "clean" across installs; the opt-out is the safety valve.

*Alternative rejected:* a one-release "enforce with soft-fail" mode — adds a third mode and a second flip; the refusal page already tells the operator what to do.

## Risks / Trade-offs

- [Operator locked out after upgrade on an unadmitted hostname (e.g. internal proxy name)] → 403 page names `allowedHosts`/`publicBaseUrls` and `localhost:<port>`; boot log names the mode; CHANGELOG breaking note names `hostGate.mode: "report"` as the rollback. Loopback always works.
- [`openspec_refresh` from a browser whose folder is tracked by a session that just ended and is unpinned] → `isTrackedCwd` includes ended sessions (any status), so the folder stays refreshable until it leaves the registry; matches `openspec_get`.
- [Argv migration changes an error message string that a test or the client matches on] → tests pin argv shape, not stderr text; the stable-code mapping inspects git's stderr which is unchanged by invocation form.
- [`operatorGuard` on approve now also refuses a non-admitted Host even in `report` mode] → same as the mint route today; with D4 the global default is enforce anyway.
- [A device that was self-revoking (e.g. a "forget this dashboard" button on a phone UI) breaks] → no such client exists in the repo; the mobile shell's settings drive revocation through the operator's dashboard session.

## Migration Plan

1. Land D1–D3 (no user-visible behaviour change for admitted callers).
2. Land D4 with the CHANGELOG `[Unreleased]` entry under a **Breaking** heading naming the opt-out.
3. Rollback for D4 is config-only (`hostGate.mode: "report"` or `PI_DASHBOARD_HOST_GATE=report`); no code rollback needed.
4. Docker harness + Playwright E2E reach the dashboard on `localhost`/IP literal — verify the suite is unchanged before merge (task).

## Open Questions

- Should `POST /api/pair/approve` drop the genuinely-local admission to match `qr-device-pairing`'s "no loopback exemption" clause? Deferred: does not change this change's specs (only narrows the gate further) and needs a decision on how a no-auth local operator approves at all.
