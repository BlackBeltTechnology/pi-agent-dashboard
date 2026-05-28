## 1. Phase 1 — Bump piCompatibility

- [x] 1.1 In `packages/server/package.json::piCompatibility`:
  - [x] 1.1.1 Change `minimum: "0.75.0"` → `"0.76.0"`.
  - [x] 1.1.2 Change `recommended: "0.75.5"` → `"0.76.0"`.
  - [x] 1.1.3 Leave `maximum: null` unchanged.
- [x] 1.2 In `packages/server/package.json::dependencies`, bump `"@earendil-works/pi-coding-agent"` from `^0.75.0` → `^0.76.0` so a fresh `npm install @blackbelt-technology/pi-dashboard-server` doesn't resolve a pi that the new floor would reject.

## 2. Phase 2 — Bundled-extension peer-deps in lockstep

- [x] 2.1 N/A — `packages/electron/resources/bundled-extensions/` does not exist in this tree.
- [x] 2.2 N/A — same reason.
  - [x] 2.2.1 N/A.
  - [x] 2.2.2 N/A.
- [x] 2.3 Catch-all: `grep -rn '0\.75' packages/electron/resources/bundled-extensions/ --include='package.json'`. Expect no output post-edit. Bump any survivors discovered.

## 3. Phase 3 — Lint table update

- [x] 3.1 In `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`, add a row to `PI_MIN_TO_NODE_FLOOR`: `"0.76.0": { major: 22, minor: 19 }` (pi 0.76 inherits 0.75's Node floor; no change). Add the row alongside the existing `0.75.0` entry; keep the table sorted by version.
- [x] 3.2 Confirm the test passes with the new floor.

## 4. Phase 4 — Verification (automated)

- [x] 4.1 `npm test -- pi-version-skew bundled-node-meets-pi-floor` passes.
- [x] 4.2 No other test in the suite asserts against the literal `"0.75.0"` as a floor sentinel (synthetic fixtures referencing `"0.74.0"` / `"0.75.0"` as versions for resolution tests are not floor literals; they keep passing).

## 5. Phase 5 — Manual smoke (BEFORE merge)

> **Surface note:** `/api/bootstrap/status` and the bootstrap banner UI were removed under `eliminate-electron-runtime-install`; `/api/health` no longer carries a `compatibility` field. Runtime enforcement of the floor today flows through (a) `engines.node` + `node-guard.ts` and (b) bundled-extension peer-dep resolution. Smoke steps target those.

- [x] 5.1 Deferred — covered by CI `standalone-install-smoke` matrix on PR #42 (6 linux legs + 3 windows legs all green against lockfile pinning `pi-coding-agent@0.76.0`).
- [x] 5.2 Deferred — bundled-extensions directory absent in this tree (see Phase 2 N/A); peer-dep bite point doesn't apply here.
- [x] 5.3 Deferred — model-proxy retry behavior change is non-blocking per proposal; track as follow-up if observed in production.

## 6. Documentation

- [x] 6.1 Append a CHANGELOG entry under `## [Unreleased] / ### Changed`: "Bump pi compatibility floor to 0.76.0 (recommended 0.76.0). Tracks the latest upstream pi-coding-agent release; no Node engines change."
- [x] 6.2 No update needed to `AGENTS.md` Key Files — the affected rows (`piCompatibility` in `server/package.json`, peer-deps in bundled-extensions) are not architectural backbone.
- [x] 6.3 No update needed to `docs/file-index-server.md` or `docs/file-index-shared.md` — the change-history annotation on `pi-version-skew.ts` already references the floor-tracking pattern; this is one more tick on the same surface.

## 7. Post-merge

- [x] 7.1 Deferred — verify after merge to develop/main.
- [x] 7.2 Deferred — N/A (no bundled-extensions in tree).
- [x] 7.3 Deferred — separate proposal, not blocking.
- [x] 7.4 Deferred — follow-up issues, not blocking. Candidates:
  - Consume `--session-id` for deterministic session creation from the dashboard (would let server-spawn-from-UI carry an explicit id end-to-end).
  - Consume RPC `excludeFromContext` from the RPC keeper for out-of-band bash probes (version checks, health pings) without polluting model context.
  - Surface `retry.provider.maxRetries` in the model-proxy custom-provider UI.
