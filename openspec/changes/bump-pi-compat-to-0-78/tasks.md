## 1. Phase 1 — Bump piCompatibility

- [x] 1.1 In `packages/server/package.json::piCompatibility`:
  - [x] 1.1.1 Change `minimum: "0.75.0"` → `"0.78.0"`.
  - [x] 1.1.2 Change `recommended: "0.75.5"` → `"0.78.0"`.
  - [x] 1.1.3 Leave `maximum: null` unchanged.
- [x] 1.2 In `packages/server/package.json::dependencies`, bump `"@earendil-works/pi-coding-agent"` from `^0.75.0` → `^0.78.0` so a fresh `npm install @blackbelt-technology/pi-dashboard-server` doesn't resolve a pi the new floor would reject.

## 2. Phase 2 — Bundled-extension peer-deps in lockstep

> **N/A — `packages/electron/resources/bundled-extensions/` no longer exists.** Removed under change `eliminate-electron-runtime-install` (R3): pi/openspec/tsx now ship as regular npm deps of the bundled server tree at `resources/server/node_modules/`; there are no bundled-extension `package.json` manifests left to bump. Catch-all grep returns empty (vacuously satisfied).

- [x] 2.1 `packages/electron/resources/bundled-extensions/pi-anthropic-messages/package.json`: peer-dep `@earendil-works/pi-coding-agent` `">=0.75.0"` → `">=0.78.0"`. _(N/A — file removed under `eliminate-electron-runtime-install`.)_
- [x] 2.2 `packages/electron/resources/bundled-extensions/pi-flows/package.json`:
  - [x] 2.2.1 `peerDependencies`: `pi-ai`, `pi-coding-agent`, `pi-tui` all `^0.75.0` → `^0.78.0`. _(N/A — file removed.)_
  - [x] 2.2.2 `devDependencies`: same three packages, `^0.75.0` → `^0.78.0`. _(N/A — file removed.)_
- [x] 2.3 Catch-all: `grep -rn '0\.75' packages/electron/resources/bundled-extensions/ --include='package.json'`. Expect no output post-edit. Bump any survivors discovered. _(Empty output — directory absent; satisfied vacuously.)_

## 3. Phase 3 — Lint table update

- [x] 3.1 In `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`, add three rows to `PI_MIN_TO_NODE_FLOOR`:
  - `"0.76.0": { major: 22, minor: 19 }`
  - `"0.77.0": { major: 22, minor: 19 }`
  - `"0.78.0": { major: 22, minor: 19 }`
  Keep the table sorted by version.
- [x] 3.2 Confirm the test passes with the new floor.

## 4. Phase 4 — Verification (automated)

- [x] 4.1 `npm test -- pi-version-skew bundled-node-meets-pi-floor` passes. _(27/27 passed.)_
- [x] 4.2 No other test in the suite asserts against the literal `"0.75.0"` as a floor sentinel (synthetic fixtures referencing `"0.74.0"` / `"0.75.0"` as resolution-test versions are not floor literals; they keep passing).
- [x] 4.3 `npm test` overall: green. _(647 test files passed, 6775 tests passed, 19 skipped.)_

## 5. Phase 5 — Manual smoke (BEFORE merge)

> **Surface note:** `/api/bootstrap/status` and the bootstrap banner UI were removed under `eliminate-electron-runtime-install`; `/api/health` no longer carries a `compatibility` field. Runtime enforcement of the floor today flows through (a) `engines.node` + `node-guard.ts` and (b) bundled-extension peer-dep resolution. Smoke steps target those.

> **Status: 5.1 verified via Docker + standalone smoke.** 5.2 N/A (no bundled pi-flows surface). 5.3 / 5.4 deferred to human.

- [x] 5.1 Fresh `npm install` of `@blackbelt-technology/pi-dashboard-server` (no globally-installed pi) resolves `@earendil-works/pi-coding-agent@^0.78.0` — verify via `npm ls @earendil-works/pi-coding-agent`. _Verified two ways: (1) `bash scripts/test-standalone-npm-install.sh --port 18000` (CI's standalone-install-smoke path) — packed all workspaces, installed into clean HOME with no global pi, dashboard reached `mode=production` in 5s, web UI reachable; (2) synthetic `npm install '@earendil-works/pi-coding-agent@^0.78.0'` in /tmp — resolved to exactly `0.78.0`. (3) Docker bundled-server smoke: `bash packages/electron/scripts/test-electron-install.sh` — `npm install --omit=dev` inside Ubuntu 22.04 container produced `node_modules/@earendil-works/pi-coding-agent@0.78.0`; new pi-floor check stage reports `pi=0.78.0 min=0.78.0`; 13/13 stages pass._
- [ ] 5.2 Install bundled `pi-flows` against a host pi 0.77.x — peer-dep resolution warns / fails as expected (this is the intended bite of the floor). Install against pi `0.78.0` — clean. _N/A: bundled-extensions surface (including pi-flows) removed under `eliminate-electron-runtime-install` (R3). Floor enforcement now flows via `packages/server/package.json::dependencies."@earendil-works/pi-coding-agent": "^0.78.0"` and the Docker test's pi-floor check stage; the original target peer-dep no longer exists._
- [ ] 5.3 SIGTERM/SIGHUP positive: kill a running pi session with SIGTERM and confirm the bridge's `session_shutdown` handler fires (`session_unregister` reaches the server before WS close). This is a passive verification — the fix lives in pi 0.77, no dashboard code change is needed; we're confirming the dashboard inherits the cleanup correctly. _Deferred to human; no existing automated probe._
- [ ] 5.4 (Optional) Quick functional smoke: a model-proxy compaction round-trip on 0.78. If `model-proxy.jsonl` shows unexpected behavior, file a follow-up; do NOT block this change on it unless the proxy is broken end-to-end.

## 6. Documentation

- [x] 6.1 Append a CHANGELOG entry under `## [Unreleased] / ### Changed`: "Bump pi compatibility floor to 0.78.0 (recommended 0.78.0). Supersedes the unshipped bump-pi-compat-to-0-76 proposal. Tracks the latest upstream pi-coding-agent release; no Node engines change. Inherits SIGTERM/SIGHUP `session_shutdown` cleanup and bounded RPC stdin behavior from pi 0.77."
- [x] 6.2 No update needed to `AGENTS.md` Key Files — the affected rows are not architectural backbone.
- [x] 6.3 No update needed to `docs/file-index-server.md` or `docs/file-index-shared.md` — the change-history annotation on `pi-version-skew.ts` already references the floor-tracking pattern; this is one more tick on the same surface.

## 7. Post-merge

- [x] 7.1 Verify `packages/server/package.json::piCompatibility.minimum === "0.78.0"` on `develop`. _(Verified on worktree: `{ minimum: '0.78.0', recommended: '0.78.0', maximum: null }`. Confirm again post-merge to develop.)_
- [ ] 7.2 Verify bundled-extension peer-deps reject a host pi `0.75.x`, `0.76.x`, `0.77.x` install (peer-dep warning / failure from `npm install`). _(N/A — bundled-extensions directory removed. Floor enforcement now flows via `packages/server/package.json::dependencies."@earendil-works/pi-coding-agent": "^0.78.0"` AND the new pi-floor check stage in the three rewritten Docker tests — any future drift between bundled pi and `piCompatibility.minimum` fails those tests at the floor-check stage. Verified live: `pi=0.78.0 min=0.78.0` passing in `test-electron-install.sh` Docker run.)_
- [ ] 7.3 Archive the unshipped `bump-pi-compat-to-0-76` proposal directory (or leave for the bulk-archive flow) — it is now superseded. _(Deferred to bulk-archive.)_
- [ ] 7.4 Open / pick up follow-up proposals for opt-in surface (each separate):
  - `surface-input-streaming-behavior` (scaffolded sibling).
  - Consume `--session-id` for deterministic session creation at spawn (unify bridge+pi session IDs).
  - Consume `--name`/`-n` for pre-set session display name at spawn (replaces post-spawn `setSessionName`).
  - Consume `--exclude-tools` for per-session tool gating.
  - Surface `pi.getAllTools().promptGuidelines` in the dashboard tool-info UI.
- [ ] 7.5 Open a separate proposal `restore-pi-version-skew-surface` if the team wants `/api/health.compatibility` + a bootstrap banner re-wired — currently both gone, and the spec scenarios that reference them are aspirational documentation.
