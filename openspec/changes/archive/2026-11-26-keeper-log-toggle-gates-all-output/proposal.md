# Proposal

## Why

The Settings > Developer toggle "Capture pi session output (debug)" (`keeperLog.capturePiOutput`) reads as the master off switch for keeper logging. When off, it only discards pi's stdout/stderr. Every headless spawn still writes `keeper-<id>.log` (keeper lifecycle lines) and creates a `keeper-launch-<id>.log` that is almost always empty and is never cleaned up. One install has 2493 empty launch files going back months. Off should mean off.

## What Changes

- **BREAKING (behavior):** When `keeperLog.capturePiOutput` is `false` (the default), a new headless session creates **no** keeper log files: no `keeper-<id>.log` and no `keeper-launch-<id>.log`. The keeper's lifecycle `log()` lines, its rotation machinery, and the server-side launch-stderr capture are all off.
- The server sets `PI_KEEPER_CAPTURE_PI_OUTPUT` from config alone, and removes it when the toggle is off. A value inherited from the server's own environment can no longer turn logging on behind the toggle.
- When the toggle is `true`, behavior is unchanged: lifecycle lines and pi output go to `keeper-<id>.log` with in-place rotation, and keeper startup stderr goes to `keeper-launch-<id>.log`.
- The keeper crash-window error (`PI_CRASHED`) keeps the exit code and now matches the setting. With the toggle off, it says to enable the toggle and start a new session. With it on, it names both log files, since startup errors land in the launch log.
- Fix: the server closes its own launch-log descriptor after spawning the keeper. Today it leaks one fd per headless spawn.
- The Settings hint (en / hu / zh-CN) says that off means new sessions write no keeper logs. The config key name is unchanged; no migration.
- Existing empty `keeper-launch-*.log` files are **not** deleted by code. The startup sweep keeps its never-unlink rule. The CHANGELOG entry gives a one-time manual cleanup command (POSIX + PowerShell).
- Debug runbooks (`docs/faq.md`, `debug-dashboard` known-issues) say to enable the toggle before reading keeper logs.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `rpc-keeper-sidecar`: the capture env var gates all keeper log output and is sanitized by the server; rotation applies only when capture is on; the launch log exists only when capture is on and its fd is not leaked; the `PI_CRASHED` message depends on the setting.
- `headless-spawn`: the keeper's pi stdio routing to `logFd` is conditional on capture, not unconditional.
- `process-manager`: keeper crash detection promises the exit code and file names (capture on) or the remedy (capture off). The never-implemented stderr-tail promise is dropped.
- `shared-config`: `keeperLog.capturePiOutput` gates all keeper log output, not only pi output.
- `settings-panel`: the toggle help text says off means new sessions write no keeper log files. The requirement is renamed and corrected to the Developer section, where the toggle already lives.

## Impact

- `packages/server/src/rpc-keeper/keeper.cjs`: open the log, create rotation, and start the rotation timer only when capture is on; otherwise `log()` is a no-op.
- `packages/server/src/rpc-keeper/keeper-manager.ts` (`spawnKeeperFor`): open the launch log only when capture is on; close the parent fd after spawn.
- `packages/server/src/spawn-process/process-manager.ts` (`spawnHeadlessViaKeeper`): set or delete the env var explicitly; the `PI_CRASHED` message depends on the setting.
- `packages/client/src/components/settings/SettingsPanel.tsx` (inline English default), `packages/client/src/lib/i18n/i18n-hu.ts`, `i18n-zh-CN.ts`: hint text.
- Tests: in `rpc-keeper/__tests__/keeper.test.ts`, about 11 existing tests read the log without the capture env and must opt in. That includes the rotation tests E1/E2, and one test (`:475`) that pins the old behavior and gets inverted. The harness scrubs inherited env. Also affected: `server/src/__tests__/keeper-manager.test.ts` (launch log, fd close), `__tests__/process-manager-keeper-spawn.test.ts` (env sanitizing, message), `shared/src/__tests__/config-keeper-log.test.ts`, and `client/src/lib/__tests__/ui-copy-no-spawn.test.ts` (copy guard).
- Docs: `docs/faq.md` (keeper-log diagnostic entries), `.pi/skills/debug-dashboard/references/known-issues.md`, `docs/architecture.md` RPC keeper section, CHANGELOG, nearest `AGENTS.md` rows.
- Trade-off: with the toggle off, a headless session that dies early leaves nothing on disk. The `PI_CRASHED` message says how to get evidence next time.
- Out of scope: the `spawn-error-persistence` banner copy for `PI_CRASHED` ("See log below"). Today the headless path already supplies no captured stderr, so this change does not alter it.

## Discipline Skills

- `doubt-driven-review`: the default-on diagnostics are removed, and the keeper's startup path changes (a crash there breaks every headless session).
- `observability-instrumentation`: the `PI_CRASHED` message is the only remaining evidence path when the toggle is off; it must stay actionable.
