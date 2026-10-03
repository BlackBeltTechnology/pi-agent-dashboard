# model-tracker.ts — index

Diff-and-send trackers for model / session name / git info / pi version / cwd-missing. Exports `sendModelUpdateIfChanged`, `sendSessionNameIfChanged`, `sendGitInfoIfChanged`, `sendPiVersionIfChanged`, `sendCwdMissingIfChanged`, `resetReconnectCaches`, `readPkgVersionByWalkUp(pkgName, resolveEntry, readFile?, fileExists?, matchName?)` (`matchName` defaults to exact `pkgName`), `readRunningPiVersion`. `readRunningPiVersion(argv1 = process.argv[1], fs?)` reads the version of the pi the bridge runs INSIDE by walking up from `dirname(argv1)` to the nearest `package.json` whose name passes `isPiCodingAgentName` (any `*/pi-coding-agent`); whole body try/catch → `undefined` (missing argv[1], bun binary, unreadable manifest) and NEVER a by-name `node_modules` resolution — a hoisted newer copy must not mask an old running pi. Consumed by `slash-dispatch.ts` as the >= 0.84.2 gate. See change: retire-slash-dispatch-via-expand-prompt-templates. Suppressed redundant sends across reconnects. `sendGitInfoIfChanged` also gathers `gatherGitStatus` and includes `gitStatus` in `git_info_update` (dedup via `lastGitStatusJson`; omitted on inconclusive probe). See change: add-session-uncommitted-indicator-and-commit.

`sendGitInfoIfChanged` = ONE change-detector: `prStatus.observe(generation)`, diffs + always sends full cached PR tuple (`lastGitPrJson`). `resetReconnectCaches` resets `lastGitPrJson`. See change: redesign-composer-session-strip.

`sendPiVersionIfChanged` default reader → argv-anchored `readRunningPiVersion` (feeds server below-floor flag). `defaultReadPiVersion` (by-name, hoisted-copy hazard) removed. See change: update-pi-core-1-0-adopt-apis.

pi-version dedup key = `sessionId + version` (`lastPiVersionKey`); `resetReconnectCaches` clears it — server keeps `piVersion`/`piBelowFloor` in memory only. See change: update-pi-core-1-0-adopt-apis (review B1/B2).

`readRunningPiVersion` match is scope-agnostic via shared `isPiCodingAgentName`; `PI_PKG_NAMES` removed. A running legacy fork reports its real version → server below-floor flag. Exact-name mode of `readPkgVersionByWalkUp` unchanged. See change: drop-mariozechner-pi-fork.
