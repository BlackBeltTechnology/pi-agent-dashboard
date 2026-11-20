## Why

Three open issues share one theme: a guard exists on one road but not its sibling, so a
caller (or a wedged child) gets past it. Each was verified against current `develop`.

- **[#1104](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1104) — CONFIRMED (+ wider).** The automation plugin's browser `plugin_action` handler
  builds its write/run base from the unadmitted `payload.cwd`:
  `create` → `path.resolve(cwd)` (or `process.cwd()` when absent) → `writeAutomation`
  (`packages/automation-plugin/src/server/index.ts:224`, `automation-writer.ts:49-57`);
  no `admitRouteCwdParam` runs. The REST `create` admits it (`routes.ts:176-199,396-412`) and the
  sibling WS `stop` already does (`index.ts:194-208`, change `polish-automation-board`).
  The WS `run` has the same hole: `runNowViaEngine(scope, cwd, name)` scans
  `<cwd>/.pi/automation` and starts a run from whatever it finds (`index.ts:190,647-667`),
  so an operate caller can run an automation file planted in any folder. The issue names only `create`;
  `run` is the same defect and is fixed together. Recorded as accepted-risk F1: 5 entries in
  `codeql-baseline.json:164-198`, pinned by `codeql-baseline-gates.test.ts:161-168`.
- **[#1115](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1115) — CONFIRMED, but contradicts shipped spec (decision pending).**
  `path-gate/handler.ts:298-302` checks `suppression.isSuppressed` before the YOLO ask
  (`:303-329`), and `suppression.ts:9` is a fixed 120 s. This is deliberate: spec
  `agent-path-confinement` "The gate fails closed" says suppression "SHALL take precedence ...
  over asking the server for a YOLO answer", with the scenario "A recent denial is not overridden".
  Not covered by `harden-agent-tool-guards` (its deltas touch other requirements; no
  `recently-denied`/suppression text). Detail + options: `/tmp/issue-batch/harden-path-and-process-guards-DECISIONS.md`.
- **[#1103](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1103) — CONFIRMED.** `execVerb` spawns the child with `stdio:"inherit"`,
  not detached, and registers no signal handler (`packages/server/src/services/cli-service.ts:367`);
  the heartbeat timer and lease release run only after the child exits (`:392-393`). SIGTERM sent to
  `service exec` by `BridgeManager.terminate` (`obs-studio-plugin/src/server/bridge.ts:168-182`, `b.child.kill()`)
  kills only the wrapper; a child that ignores stdin EOF is reparented and keeps running. The
  `managed-services` spec (`CLI and REST consumer contract`) has no signal contract.

## What Changes

- **#1104:** the automation `plugin_action` `create` and `run` actions admit `payload.cwd` with the
  same `admitRouteCwdParam` + `knownCwds` the REST routes use, before any scan/write; folder-scope
  `create` without a cwd is refused (no `process.cwd()` fallback); admission token released in `finally`.
  Refusals are logged and nothing is written/started. Then the five `automation-writer.ts`
  `accepted-risk` baseline entries are removed (or, if CodeQL still reports them, re-triaged as
  `false-positive:` naming the admission gate) and the contract test is updated.
- **#1115 (recommended option, confirmed (owner, 2026-11-20)):** in `path-gate/handler.ts`, ask the server's YOLO
  verdict *before* the recent-denial short-circuit for grantable, non-sensitive paths. An explicit operator
  Deny stays refused (the server's remembered refusal answers `refused` → `yolo-refused`); a *timeout*
  (never remembered) is overridden by a live YOLO session. Sensitive/ungrantable paths, no-UI, and
  non-YOLO behaviour are unchanged; the suppression map is untouched.
- **#1103:** `service exec` installs SIGTERM/SIGINT/SIGHUP handlers while the child runs, forwards the
  signal to it, waits for exit, releases the lease and exits with the child's status (128+n when
  the child dies to the signal). If the child outlives a kill-grace (default 5 s) or a second signal
  arrives, `exec` sends SIGKILL to the child, then releases the lease. Handlers are removed after exit.
  SIGKILL of `exec` itself stays unforwardable (lease expires at TTL, as today).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `plugin-cwd-admission` — "Automation and flows plugin routes admit the request cwd" also covers the automation `plugin_action` `create`/`run`.
- `codeql-local-ratchet` — F1 baseline entries are removed/re-triaged once #1104 is fixed.
- `agent-path-confinement` — "The gate fails closed" and "A live YOLO session answers the out-of-root prompt": YOLO verdict precedes the recent-denial suppression (confirmed — owner, 2026-11-20).
- `managed-services` — "CLI and REST consumer contract": `exec` signal-forwarding contract.

## Non-goals

- Tiering/auth of the `plugin_action` WS frame itself (`ws-message-tiers.ts`); the caller is already operate-capable.
- A cwd-admission refactor of other plugins' `plugin_action` handlers (kb/flows already guarded: `kb-plugin-cwd-guard`).
- #1115 "related friction": `missing`-folder provisioning classification and the ~4 min provisioning cooldown (separate surface; file as its own issue if wanted).
- Changing the 120 s window, the Deny-remembered-durably rules, or YOLO scope/forbidden rules.
- Process-group spawn in `BridgeManager` (issue's optional defence in depth): not needed once `exec` forwards and escalates; revisit only if SIGKILL-of-`exec` leaks are observed.
- Windows-specific job-object handling for `exec` (SIGTERM/`child.kill()` semantics unchanged there).

## Relationship

- `harden-agent-tool-guards` (active, unstarted): touches `agent-path-confinement` ("Session roots", "Always allow ...", an added requirement) and `access-grant-yolo`; **no overlap** with the suppression/YOLO-order text. Both edit `path-gate/` files (`decide.ts`/`roots.ts` there; `handler.ts` here) — mergeable; rebase on whichever lands second. #1115 is **not** covered by it, so it stays in this change.
- `add-supervised-tool-approval` (active): composes after the path gate ("Path-gate denial suppresses the approval"). A YOLO auto-allow after a timeout simply lets the call reach the supervised gate; no conflict (its design.md:483 already treats YOLO path auto-allow as independent).
- `harden-http-auth-boundaries` (active): HTTP tiers only; no overlap.
- Archived: `polish-automation-board` (added WS `stop` admission — this change completes `create`/`run`), `harden-plugin-cwd-admission` / `core-cwd-admission` (the admission gate reused), `fix-codeql-baseline-coverage` (recorded F1; "this change does not fix it"), `yolo-covers-agent-path-gate`, `ask-agent-file-access-in-chat` (D5 suppression), `add-obs-studio-plugin`/`add-service-registry-core` (exec + BridgeManager).

## Discipline Skills

- `security-hardening` — untrusted browser-supplied `cwd` written/run on disk (#1104); path-gate precedence between a human Deny and an automatic allow (#1115); child-process lifecycle of a credential-carrying `exec` (#1103).
- `doubt-driven-review` — #1115 reverses a documented fail-closed ordering; review before the spec delta stands.
- `review-code` — before commit (non-trivial change, tests green).
- `observability-instrumentation`, `performance-optimization`: none apply (no new endpoint/job; admission is the existing per-request check).

## Impact

- Files: `packages/automation-plugin/src/server/index.ts`; `packages/extension/src/path-gate/handler.ts` (+ `AGENTS.md` row); `packages/server/src/services/cli-service.ts`; `packages/obs-studio-plugin/src/server/bridge.ts` (comment only); `codeql-baseline.json`; `packages/shared/src/__tests__/codeql-baseline-gates.test.ts`; tests; `docs/code-quality.md` line 610 + `docs/security/tool-call-guards.md` via DocScribe.
- Compatibility: WS `create`/`run` with an unadmitted cwd now no-ops with a warning (same refusal the REST route gives); legitimate callers (UI folders are known/pinned) are unaffected. `service exec` callers that never signal it are unchanged.
- Migration: none (no persisted data). Rollback: revert the commit; baseline entries restore from git.
- Build/restart: automation plugin + cli-service = server restart; `path-gate` = extension → `npm run reload`.
