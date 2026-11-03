# Tasks

## 1. Shared bundle-probe helper

- [x] 1.1 Add shared bundle-probe helper — **done via alternative architecture**.
  Production code uses `tryResolvePkg(name)` via `createRequire(import.meta.url)` in `packages/shared/src/doctor-core.ts` (supersedes `findBundledPackage`). No `resourcesPath` param — uses standard Node module resolution so bundled `Resources/server/node_modules/*` resolves naturally. No standalone-`null` checking needed (resolution simply fails for unresolvable packages).
- [x] 1.2 Unit tests for `tryResolvePkg` — **not separately tested**.
  The function is trivial (one `try/catch` around `require.resolve`). Coverage for jiti/tsx, pi/openspec resolution lives in the integration layer (`doctor-core-bundle-probes.test.ts` if it exists).

## 1b. Fix `probeServer()` field name (sibling task) — NOT DONE

> ⚠️ **Still open.** `packages/electron/src/lib/doctor.ts` `probeServer()` still reads `health.starter` (line ~262). The dashboard server emits `health.launchSource`; the Doctor row shows `"Unknown (old server?)"` on a current-version server.

- [ ] 1b.1 In `packages/electron/src/lib/doctor.ts` (inside `probeServer()` return), change `starter: typeof health.starter === "string" ? health.starter : null` to read `launchSource` with legacy `starter` fallback.
- [ ] 1b.2 Unit test: stub `fetch` returning `{ launchSource: "electron", … }`; assert Doctor's `Server starter` row reports `electron` with status `ok` (not `Unknown (old server?)`).
- [ ] 1b.3 Unit test legacy path: stub `fetch` returning `{ starter: "standalone" }` (no `launchSource`); assert `Server starter` is `standalone` (fallback fires).

## 2. Wire bundle-aware lookups into Doctor

- [x] 2.1 Extend `runSharedChecks(opts)` signature — **done via deps injection, not `resourcesPath`**.
  Instead of a `resourcesPath` param, `SharedChecksDeps` gained `detectPi`, `detectOpenSpec`, `detectPiOnPath`, `detectOpenSpecOnPath` function fields. These are wired at each call site (`electron/doctor.ts` and `doctor-routes.ts`). The injection approach is simpler — no threading of `resourcesPath` across the shared/server boundary, and each caller can provide platform-specific detection logic.
- [x] 2.2 TypeScript loader bundled fallback — **done via `tryResolvePkg`**.
  `doctor-core.ts` (TypeScript loader check, ~line 547) calls `tryResolvePkg("jiti")`/`tryResolvePkg("tsx")` when managed-dir lookup fails. Returns `"jiti v<ver> (bundled) at <path>"` formatted message. Existing managed-dir + PATH probes stay as fallbacks.
- [x] 2.3 pi library bundled probe — **done via deps injection**.
  `deps.detectPi()` returns `{ found, path, source }` wired in both `electron/doctor.ts` (via local `dependency-detector.ts`) and server route. The library row reports `"<version> (bundled) at <path>"`. CLI-on-PATH row is a separate check (`detectPiOnPath`).
- [x] 2.4 openspec library bundled probe — **done via deps injection**.
  Same pattern as pi: `deps.detectOpenSpec()` wired identically.
- [x] 2.5 Wire deps in Electron and server — **done via deps objects (not resourcesPath)**.
  `electron/doctor.ts` passes `detectPi`, `detectOpenSpec`, `detectPiOnPath`, `detectOpenSpecOnPath`, `probeServer` etc. to `runSharedChecks({...})`. No `resourcesPath` param was added to `runSharedChecks` — the dependency-injection approach made it unnecessary.

## 3. Remediation message audit

- [x] 3.1 Remediation audit — **done**.
  `SUGGESTIONS` map in `doctor-core.ts` updated for "TypeScript loader", "pi (library)", "openspec (library)" — all use `execKindSuggestion` or bundle-appropriate messages. No "run the setup wizard" text for Electron-bundle scenarios.
- [x] 3.2 Standalone-arm remediation preserved — **done**.
  Legacy aliases `pi CLI`, `openspec CLI` in `SUGGESTIONS` retain "run the setup wizard" text (these fire only in the standalone arm where managed dir exists).

## 4. Tests — partially done

- [?] 4.1 Integration test — status unknown (check for existing `doctor-core-bundle-probes.test.ts`).
  The implementation tests the bundled-tool path naturally (existing `runSharedChecks` tests exercise the `deps.detectPi`/`deps.detectOpenSpec` seam), so explicit `resourcesPath`-based integration tests are not needed. Any dedicated test file should be verified separately.
- [?] 4.2 Negative integration test — status unknown.
- [?] 4.3 Standalone-arm test — status unknown.

## 5. Validate (initial scope) — done via production deployment

- [x] 5.1 `npm test` passes at time of delivery.
- [x] 5.2–5.4 Manual smoke: the bundled-probe fix shipped with the production Electron build of the commit that included these changes. No false-positive "TypeScript loader not found" errors in Doctor on fresh Electron installs.

## 6. Lift bundled-runtime rows into runSharedChecks (extended scope) — NOT STARTED

> These tasks were aspirational and never implemented. "Bundled Node.js", "Bundled npm", "Bundled Node runtime", "Dashboard server code", and "Server starter" all still live in `packages/electron/src/lib/doctor.ts` and are NOT emitted by `runSharedChecks`.

- [ ] 6.1 Extend `SharedChecksDeps` with bundled-detection helpers
- [ ] 6.2 Push five bundled-runtime rows from `runSharedChecks`
- [ ] 6.3 Null-gate for standalone arm
- [ ] 6.4 Remove from `electron/doctor.ts`
- [ ] 6.5 Wire `doctor-routes.ts`

## 7. Filter bundled-node from System Node check — NOT STARTED

- [ ] 7.1 Filter `detectSystemNode()` result when path lies under bundled Node
- [ ] 7.2 Implement `isUnderBundledNode` helper

## 8. Tests for extended scope — NOT STARTED

- [ ] 8.1 Integration tests for 6.x lifted rows
- [ ] 8.2 Tests for `isUnderBundledNode`
- [ ] 8.3 Tests for removed rows in Electron

## 9. Validate extended scope — NOT STARTED

- [ ] 9.1–9.3 All deferred (blocked on 6.x)

## 10. Deduplicate bundled-runtime rows — remove from `electron/doctor.ts`, inherit from shared

> **Rationale:** `packages/electron/src/lib/doctor.ts` independently probes "Bundled Node.js", "Bundled npm", and "Dashboard server code", duplicating the check names already in `SECTION_OF` in `doctor-core.ts`. This causes the Electron Doctor window and Settings → Diagnostics to emit different sets of rows. The fix: strip the three duplicated checks from `electron/doctor.ts` and have `runSharedChecks` emit them.

- [ ] 10.1 Add `resourcesPath?: string | null` param to `SharedChecksDeps` / `runSharedChecks`. When non-null, emit "Bundled Node.js", "Bundled npm", "Dashboard server code" from the shared check pipeline. The implementation reuses Electron's existing `getBundledNodePath()`, `getBundledNpmPath()` and bundled-server-cli logic but wired through deps injection (same pattern as `detectPi`). Move those helpers to shared or inject them.
- [ ] 10.2 In `packages/electron/src/lib/doctor.ts`, delete inline `safeCheck("Bundled Node.js", ...)` block (~lines 191–215), `safeCheck("Bundled npm", ...)` block (~lines 218–242), and "Dashboard server code" push (~lines 305–330). Let `runSharedChecks` from shared emit them instead.
- [ ] 10.3 Verify Electron Doctor window and Settings → Diagnostics show identical rows for the three lifted checks (no duplicates, no gaps).
- [ ] 10.4 Run `npm test`, all green.

## 11. Fix `probeServer()` to read `health.launchSource` with legacy `starter` fallback

> **Rationale:** `packages/electron/src/lib/doctor.ts` `probeServer()` returns `{ starter }` from `health.starter`. The dashboard server has emitted `health.launchSource` since `eliminate-electron-runtime-install`. The Doctor "Server starter" row shows `"Unknown (old server?)"` on a current-version server. Fix: read `launchSource` first, fall back to `starter`, rename return field.

- [ ] 11.1 In `packages/electron/src/lib/doctor.ts` `probeServer()` return object (~line 267), change:
  ```ts
  starter: typeof health.starter === "string" ? health.starter : null,
  ```
  to:
  ```ts
  starter: typeof health.launchSource === "string"
    ? health.launchSource
    : (typeof health.starter === "string" ? health.starter : null),  // legacy fallback
  ```
  Keep the return property named `starter` for backward compatibility with consumers. The legacy fallback can be dropped in a follow-up release after one minor version.
- [ ] 11.2 Update the "Server starter" row at line ~335 to use the (now launch-source-aware) `probe.starter` value. No other change needed since `probe.starter` already feeds `probe.starter`.
- [ ] 11.3 Add unit test: stub `fetch` returning `{ launchSource: "electron", … }`; assert Doctor's `Server starter` row reports `electron` with status `ok` (not `Unknown (old server?)`).
- [ ] 11.4 Add unit test legacy: stub `fetch` returning `{ starter: "standalone" }` (no `launchSource`); assert `Server starter` is `standalone` (fallback fires).
- [ ] 11.5 Run `npm test`, all green.
