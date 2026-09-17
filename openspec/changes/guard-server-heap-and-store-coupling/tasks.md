## 1. Preconditions

- [ ] 1.1 Confirm both dependencies have landed — `grep -n "maxTotalEventBytes" packages/shared/src/memory-limits.ts` returns the field plus a non-zero default, and the shared `serverHeap` default reads `1536`. If either is missing, STOP: every mechanism here keys on them.
- [ ] 1.2 Confirm the sibling's consolidation shipped as designed (its D8 + task 8.5: `bin/pi-dashboard.mjs` parses `config.json`, wrapper literal asserted against the shared default) and record the shared default's module path — this change READS it and must not re-consolidate it.
- [ ] 1.3 Record the sibling's provenance-marker env-var name and the exact strip helper it added at the session-spawn site; the terminal strip and every strip test below reuse them rather than re-deriving a detector.

## 2. Shared constants and the coupling guard

- [ ] 2.1 Export `HEAP_MB_PER_BUDGET_MIB = 1.33`, `BASELINE_MB = 112`, `CRASH_RATIO = 0.82` from shared with doc comments naming each origin; verify a test imports all three.
- [ ] 2.2 Implement the guard helper in shared per D1 — takes the budget in the BYTE denomination and divides by `1024²` internally, returns a discriminated result (`none` | `unbounded` | `over` with a heap-equivalent MB figure), never throws, never blocks a save.
- [ ] 2.3 Test the just-below boundary — budget `862` MiB, ceiling `1536` · guard evaluated · returns no warning (`1258.46 ≤ 1259.52`) · see `packages/shared/src/__tests__/binary-lookup-spawn-env.test.ts` for the shared-unit harness shape (test-plan #E1)
- [ ] 2.4 Test the just-above boundary — budget `863` MiB, ceiling `1536` · guard evaluated · returns a warning (`1259.79 > 1259.52`) (test-plan #E2)
- [ ] 2.5 Test the unlimited case — `maxTotalEventBytes` `0`, ceiling `1536` · guard evaluated · result kind is `unbounded` and carries NO numeric heap figure (test-plan #E3)
- [ ] 2.6 Test the default pairing — budget `768` MiB, ceiling `1536` · guard evaluated · no warning (test-plan #E4)
- [ ] 2.7 Test the over-budget report — budget `2048` MiB, ceiling `1536` · guard evaluated · warning carries heap-equivalent `≈2724` MB, not the raw `2048` (test-plan #E5)
- [ ] 2.8 Test the byte denomination — `maxTotalEventBytes` `805306368` (bytes), ceiling `1536` · guard evaluated at its public boundary · no warning, proving the conversion happens inside the guard (test-plan #E6)
- [ ] 2.9 Test the ceiling term just below — budget `768` MiB, ceiling `1382` · guard evaluated · warning (test-plan #E7)
- [ ] 2.10 Test the ceiling term just above — budget `768` MiB, ceiling `1383` · guard evaluated · no warning (test-plan #E8)
- [ ] 2.11 Test the constants contract — the guard's own test file · imports the three constants · none of the three literals is re-derived anywhere in the test (test-plan #E9)
- [ ] 2.12 Test hostile input — `maxTotalEventBytes` negative, `NaN`, or absent · guard evaluated · returns a result and does NOT throw (test-plan #X4)

## 3. Build-time ordering invariant

- [ ] 3.1 Add the invariant as a vitest assertion in shared's suite (D2) — NOT a module-scope throw, which would brick the browser bundle instead of failing CI; the failure message names both defaults and the fix.
- [ ] 3.2 Pin the browser-safe split — the ceiling default is importable as a VALUE from the client bundle and `config.ts` re-exports it, so the panel guard, the invariant and the launchers read one constant.
- [ ] 3.3 Test the missing-budget arm — shared server default `1536`, memory-limits default with no `maxTotalEventBytes` · assertion runs · assertion fails (test-plan #E10)
- [ ] 3.4 Test the unlimited-budget arm — shared server default `1536`, `maxTotalEventBytes: 0` · assertion runs · assertion fails (test-plan #E11)
- [ ] 3.5 Test the bounded arm — shared server default `1536`, `maxTotalEventBytes: 805306368` · assertion runs · assertion passes (test-plan #E12)
- [ ] 3.6 Test the inert arm — shared server default `8192`, no `maxTotalEventBytes` · assertion runs · assertion passes, since the invariant binds only below `8192` (test-plan #E13)
- [ ] 3.7 Prove the assertion fails closed — temporarily set the budget default to `0` · run the suite · the invariant test goes RED; revert after (test-plan #E14)
- [ ] 3.8 Test the browser-safe split — import the ceiling-default module from a jsdom/browser-condition context · import succeeds and pulls in no `node:` built-in · see `packages/client/src/lib/__tests__/i18n-orphans.test.ts` for the client-side unit harness shape (test-plan #E15)

## 4. Settings panel disclosure

- [ ] 4.1 Wire the guard into `packages/client/src/components/settings/SettingsPanel.tsx` so both the Server heap field and the Memory Limits budget field render the warning, recomputing when EITHER field changes.
- [ ] 4.2 Add i18n keys for the two warning shapes (unbounded vs. heap-equivalent) to every locale file.
- [ ] 4.3 Test both-field placement — unsafe pairing (budget `0`, ceiling `1536`) · panel renders · a warning node is present under the server-heap field AND under the budget field · see `packages/client/src/components/settings/__tests__/settings-bespoke-validation.test.tsx` (test-plan #F1)
- [ ] 4.4 Test the unbounded copy — `maxTotalEventBytes` `0` · panel renders · text describes the store as unbounded and contains no heap-figure number (test-plan #F2)
- [ ] 4.5 Test the finite copy — budget `2048` MiB, ceiling `1536` · panel renders · text contains the heap-equivalent `≈2724` MB, not the raw `2048` (test-plan #F3)
- [ ] 4.6 Test the silent default — default pairing `768`/`1536` · panel renders · no warning node under either field (test-plan #F4)
- [ ] 4.7 Test cross-field recompute — panel at the default pairing · operator edits ONLY the ceiling to `1382` · the warning appears under BOTH fields (test-plan #F5)
- [ ] 4.8 Test locale parity — every locale file · parity test runs · both warning keys exist in every locale · see `packages/client/src/lib/__tests__/i18n-orphans.test.ts` (test-plan #F7)
- [ ] 4.9 Author the e2e non-blocking check — dashboard settings against the docker harness (port read from `.pi-test-harness.json`, never hardcoded) · operator sets budget `0` and saves · Save stays enabled, the save succeeds, the value survives a reload with the warning still shown · see `tests/e2e/blackhole-settings.spec.ts` (test-plan #F6)
- [ ] 4.10 Manually verify the warning reads as advisory rather than as a blocking error on the Server settings page (test-plan: manual-only)

## 5. Electron launch stamp

- [ ] 5.1 Stamp the configured ceiling in `packages/electron/src/lib/launch-source.ts` (D3), reading `~/.pi/dashboard/config.json` with the same `JSON.parse`-in-a-`try` shape the wrapper uses, and suppressing the stamp when an operator pin is already present — argv outranks `NODE_OPTIONS`, so an unconditional stamp would silently override the pin.
- [ ] 5.2 Test the stamp — `config.json` with `serverHeap.maxOldSpaceMb: 2048` · Electron builds the server spawn env · the spawn carries a `2048` ceiling · see `packages/server/src/__tests__/spawn-env-electron-parity.test.ts` (test-plan #E20)
- [ ] 5.3 Test the operator pin — Electron launch env already pins `--max-old-space-size=4096` · Electron builds the spawn env · the pin is neither replaced nor outranked by a higher-precedence argv flag (test-plan #E21)
- [ ] 5.4 Test the config fault — `config.json` absent or malformed · Electron builds the spawn env · falls back to the shared default ceiling and does NOT fail the launch (test-plan #X1)

## 6. Restart re-stamp

- [ ] 6.1 Re-apply the configured ceiling to `spawnArgs` in `packages/server/src/spawn-process/restart-helper.ts` (D5) — it currently builds `spawnArgs` from CLI args only (`restart-helper.ts:102`) and never carries `process.execArgv`, so an argv ceiling is dropped on every restart; read the value from config at restart time, not from the live `process.execArgv`.
- [ ] 6.2 Author the qa smoke for restart preservation — server booted under ceiling `1536` · `POST /api/restart` · the respawned process runs under `1536`, not the runtime default · see `qa/tests/02-server-start.sh` (test-plan #E22)
- [ ] 6.3 Author the qa smoke for config re-read — booted at `1536`, `config.json` edited to `2048` afterwards · `POST /api/restart` · the respawned process runs under `2048`, the NEW value (test-plan #E23)
- [ ] 6.4 Author the qa smoke for the config fault — `config.json` deleted between boot and restart · `POST /api/restart` · the respawn succeeds under the shared default rather than hanging or exiting non-zero (test-plan #X2)

## 7. Terminal strip

- [ ] 7.1 Strip the dashboard's own stamped token from the terminal env in `packages/server/src/terminal/terminal-manager.ts:264` (D4), keying on the sibling's provenance marker rather than sniffing the flag, and drop the marker variable itself from the terminal env.
- [ ] 7.2 Test the marker-matched strip — `NODE_OPTIONS="--enable-source-maps --max-old-space-size=1536"` plus a marker naming that exact token · terminal env built · env is exactly `--enable-source-maps`, rest verbatim · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` and `terminal-manager.test.ts` (test-plan #E16)
- [ ] 7.3 Test the operator pin — `NODE_OPTIONS="--max-old-space-size=4096"`, no marker · terminal env built · the flag is preserved unchanged (test-plan #E17)
- [ ] 7.4 Test the value collision — operator-set `--max-old-space-size=1536` with no marker · terminal env built · the flag is preserved, proving the strip keys on the marker and never on the value (test-plan #E18)
- [ ] 7.5 Test the marker leak — server running under a stamped ceiling · terminal env built · the provenance marker variable is absent from the terminal env (test-plan #E19)
- [ ] 7.6 Test the stale marker — marker names `--max-old-space-size=1536` but `NODE_OPTIONS` carries `4096` · terminal env built · nothing is stripped, since a mismatch means the operator owns the flag (test-plan #X3)

## 8. Docs and closeout

- [ ] 8.1 Delegate to DocScribe: document the coupling guard and its constants, the CI-gate invariant, the four stamp points (wrapper, bridge, Electron, restart), and the DISCLOSED terminal-headroom regression — noting it applies to the standalone-wrapper path only; verify the page exists and the regression is stated explicitly.
- [ ] 8.2 Update the nearest directory `AGENTS.md` rows for every touched file (`packages/shared/src`, `packages/client/src/components/settings`, `packages/electron/src/lib`, `packages/server/src/spawn-process`, `packages/server/src/terminal`) with `See change: guard-server-heap-and-store-coupling`; verify `kb dox lint` reports no stale/missing rows.
- [ ] 8.3 Run the full suite once to a log and verify green: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`.
- [ ] 8.4 Run `review-code` on the diff and `doubt-driven-review` on the invariant and the restart re-stamp before commit; verify findings are resolved or explicitly deferred.
