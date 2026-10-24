# exec wrapper flows (task 2.2) — `packages/shared/src/platform/exec.ts` at H

Source: SARIF `codeFlows` of the local flag-on run at H (same results as the GitHub alerts).

| Alert | Wrapper line | Source (path:line) | Route tier | Class | Disposition |
|---|---|---|---|---|---|
| #31 | `execSync` :128 | `session/session-api.ts:270` (`POST /api/session/:id/archive`, `request.params.id`) → `browser-handlers/session-action-handler.ts:110` `findPidByMarker` → `process-identify.ts:64` | `control` | other | no fix: `shellQuote` (:213) allow-lists `[A-Za-z0-9._-]` or single-quote-escapes before the `grep`. `false-positive:` |
| #245 (line 147) | `execFileSync` :147 | `routes/git-routes.ts:1089` (`POST /api/git/worktree/pr` body) → `git-operations.ts:1574-1581`; `session/session-api.ts:305` (`POST /api/session/spawn` body) → `process-manager.ts:937,962` | `control` | other | no fix: argv, no shell. `gh pr create` takes title/body/branch as values after their flags; tmux takes `cwd` as the value of `-c`. `false-positive:` |
| #32 (line 212) | `spawn` :212 | `routes/git-routes.ts:404` (`POST /api/git/commit` body) → `git-operations.ts:316-333` `commitFiles` | `control` | other | no fix: argv, `--` before paths, `assertPathsInside` (:239) keeps each path inside cwd, message on stdin. `false-positive:` |
| #27 | `spawn` :212 (shell-from-environment) | `extension/src/server-launcher.ts:64` (`require.resolve` of the server package, repo-relative fallback) → `node-spawn.ts` | install-controlled | operator/install | `accepted-risk:` (`operator-authz:` is invalid on this rule) |

No "other" source is unsafe, so task 4.13 has no caller fix. Alert numbers: the table maps alerts to lines through the baseline line hashes (#31 → :128 `bb9e7184b11426d4`, #245 → :147 `7111598f00fc819`, #32 → :212 `e2874d87ed2c3647`).
