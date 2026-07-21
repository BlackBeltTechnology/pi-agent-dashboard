# model-tracker.ts — index

Diff-and-send trackers for model / session name / git info / pi version / cwd-missing. Exports `sendModelUpdateIfChanged`, `sendSessionNameIfChanged`, `sendGitInfoIfChanged`, `sendPiVersionIfChanged`, `sendCwdMissingIfChanged`, `resetReconnectCaches`. Suppressed redundant sends across reconnects. `sendGitInfoIfChanged` also gathers `gatherGitStatus` and includes `gitStatus` in `git_info_update` (dedup via `lastGitStatusJson`; omitted on inconclusive probe). See change: add-session-uncommitted-indicator-and-commit.
