# Server / Extension / Shared — User-Facing String Audit

**Recommended pattern**: emit a stable `code`/`error` snake_case token alongside every user-facing `message`. Client maps code to `t()`. Messages without a code cannot be translated without coupling the client to English server strings.

**Total user-facing strings**: ~65
**Files affected**: 15
**With mappable code**: ~22 (34%)
**Without mappable code**: ~43 (66%)

---

## packages/server/src/spawn-preflight.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 61 | message | `Path is not a directory: ${cwd}` | yes + `DIR_NOT_DIRECTORY` |
| 64 | message | `Cannot stat path: ${err.message}` | yes + `DIR_NOT_DIRECTORY` |
| 71 | message | `Directory is not writable: ${cwd}` | yes + `DIR_NOT_WRITABLE` |

## packages/server/src/process-manager.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 392 | message | `Directory does not exist: ${cwd}` | yes + `DIR_MISSING` |
| 430 | message | `Pi session spawned in tmux ...` | no |
| 433 | message | `Failed to spawn session: ${err.message}` | yes + `TMUX_MISSING` |
| 442 | message | `Pi session spawned via WSL tmux` | no |
| 444 | message | `Failed to spawn via WSL tmux: ${err.message}` | yes + `TMUX_MISSING` |
| 451 | message | `Windows Terminal (wt.exe) not found` | yes + `WT_MISSING` |
| 471 | message | `Failed to launch Windows Terminal: ${r.error}` | yes + `SPAWN_ERRNO` |
| 477 | message | `Pi session spawned in Windows Terminal` | no |
| 555 | message | `Failed to spawn RPC keeper: ${...}` | no |
| 577 | message | `Pi session spawned via RPC keeper ...` | no |

## packages/server/src/model-proxy/auth-gate.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 51 | message | `Authorization header required` | yes + `AUTH_REQUIRED` |
| 57 | message | `Authorization must be Bearer token` | yes + `AUTH_MALFORMED` |
| 65 | message | `Empty bearer token` | yes + `AUTH_MALFORMED` |
| — | message | `Only proxy API keys ... accepted` | yes + `PROXY_KEY_REQUIRED` |
| — | message | `API key has been revoked` | yes + `AUTH_REVOKED` |
| — | message | `API key has expired` | yes + `AUTH_EXPIRED` |
| — | message | `Invalid API key` | yes + `AUTH_REQUIRED` |
| — | (no message) | scope denied (403) | yes + `SCOPE_INSUFFICIENT` |

## packages/server/src/routes/model-proxy-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 140 | message | `messages is required` | no |
| 149 | message | `model is required` | no |
| 157 | message | `Model not found: ${resolved.label}` | no |
| 246 | message | `No response from model` | no |
| 282 | message | `Model not found: ${resolved.label}` | no |
| 366 | message | `No response from model` | no |
| 146 | message | `pi-ai unavailable` | yes + `MODEL_PROXY_RUNTIME_MISSING` |

## packages/server/src/routes/provider-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 98 | message | `Provider "${name}" baseUrl points back …` | yes + `RECURSIVE_PROXY` |
| 108 | error | `Provider "${name}" has no saved API key` | no (field is `error`, not `code`) |

## packages/server/src/routes/git-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 893 | message | `cwd required` | yes + `cwd_invalid` |
| 899 | message | `cwd is not a directory` | yes + `cwd_invalid` |
| 902 | message | `cwd does not exist` | yes + `cwd_invalid` |

## packages/server/src/routes/system-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 558 | message | `Re-extract only available when started by Electron …` | no |
| 563 | message | `Re-extraction scheduled. Electron will restart …` | no |

## packages/server/src/routes/models-introspection-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 64 | message | `pi-ai is not installed or cannot be resolved` | no |

## packages/server/src/routes/model-proxy-diagnostics-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 26 | message | `Failed to resolve model proxy registry` | no |

## packages/server/src/routes/model-proxy-refresh-routes.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 20 | message | `Failed to refresh model proxy registry` | no |

## packages/server/src/browser-handlers/session-action-handler.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 275 | message | `Session not found` | no |
| 284 | message | `Session file is unknown (pre-migration)` | no |
| 288 | message | `Session is already active` | no |
| 292 | message | `Session is already being resumed` | no |
| 337 | message | (forwards degradeResult.message) | no |
| 349 | message | `Fork from entry failed: ${err.message}` | no |
| 674 | message | `Session not found` | no |
| 693 | message | `WebSocket closed (no PID available)` | no |
| 721 | message | `Process already exited` | no |
| 725 | message | `Process terminated${suffix}` | no |

## packages/server/src/localhost-guard.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 134 | reason | `Source IP not loopback, not in trustedNetworks…` | no |

## packages/server/src/spawn-register-watchdog.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 205 | message | `Pi session spawned but never registered (timeout …)` | no |

## packages/server/src/git-operations.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 1620 | message | `PR #${prNumber} not found` | yes + `error: "pr_not_found"` (not standard `code` field) |

## packages/server/src/model-proxy/registry-singleton.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 136 | reason | `Model registry not yet initialized` | no |

## packages/shared/src/doctor-core.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 179 | message | `Command not found` | no (`kind: "not-found"` is a category, not an i18n code) |
| 190 | message | `Permission denied` | no |
| 206 | message | `Command did not respond within ${n}s` | no |
| 217 | message | `Command exited with status ${status}` | no |
| 228 | message | `Command failed` | no |
| 259 | message | `Check failed to run` | no |
| 300 | message | `An assumed-safe operation failed` | no |
| 611 | message | `Attached dashboard server is unreachable …` | no |
| 622 | message | `Server and app bundle both v${health.version}` | no |
| 646 | message | `Dashboard server reports v${...}; app bundle v${...}` | no |
| 738 | message | `Not found on PATH (bundled Node will be used)` | no |
| 771 | message | `Library not found — dashboard cannot spawn sessions` | no |
| 798 | message | `Not on $PATH — pi won't run from fresh terminal` | no |
| 1158 | message | `Healthy — ${n} recycle(s) so far` | no |
| 1179 | message | `Legacy directory at … — no longer used…` | no |
| 612 | detail | `GET /api/health returned no response …` | no |
| 739 | detail | `PATH searched without success` | no |
| 772 | detail | `Searched override, bundled, managed install…` | no |
| 799 | detail | `Dashboard-spawned sessions still work …` | no |
| 823 | detail | `Searched override, bundled, managed install…` | no |
| 850 | detail | `Optional. Needed only for openspec manually…` | no |
| 948 | detail | `Looked under ${...}, bundled, and on PATH` | no |
| 973 | detail | `GET http://localhost:8000/api/health returned …` | no |
| 1049 | detail | `Searched override, managed install, and PATH` | no |
| 1121 | detail | `The host process does not run an in-process …` | no |
| 1131 | detail | `Click the 🌐 Tunnel button to start one` | no |

## packages/shared/src/zrok-env.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 70 | reason | `No zrok environment file at ${v2Path} or ${v1Path}` | no |
| 83 | reason | `Could not read ${chosen.path}: ${err.message}` | no |
| 96 | reason | `Malformed JSON in ${chosen.path}: ${err.message}` | no |
| 114 | reason | `Missing required field(s) in ${chosen.path}: …` | no |

## packages/shared/src/role-name-validation.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 28 | reason | `Name cannot be empty` | no |
| 32 | reason | `Use letters, digits, - or _ only…` | no |
| 36 | reason | `Role "${trimmed}" already exists` | no |

## packages/shared/src/platform/runner.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 258 | message | `Recipe produced empty argv` | no |
| 347 | message | `Recipe produced empty argv` | no |

## packages/extension/src/bridge.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 770 | message | `Flow "${msg.flowName}" deleted.` | no (notification — `level: "info"`) |
| 957 | message | `Index out of range` | no (tool error response, `status: "error"`) |
| 973 | message | `Index out of range` | no |

## packages/extension/src/server-launcher.ts

| Line | Field | String | hasCode |
|------|-------|--------|---------|
| 135 | message | `Server started` | no (returned to extension caller, logged) |
| 147 | message | `Server process exited (code=…) before health check` | no |

---

## 5 Example Rows (high priority — no code)

| File | Field | String |
|------|-------|--------|
| `session-action-handler.ts:275` | `message` | `"Session not found"` — WS to client, no code |
| `model-proxy-routes.ts:157` | `message` | `"Model not found: ${label}"` — HTTP 404, no code |
| `doctor-core.ts:179` | `message` | `"Command not found"` — doctor panel, no code |
| `session-action-handler.ts:725` | `message` | `"Process terminated"` — WS to client, no code |
| `zrok-env.ts:70` | `reason` | `"No zrok environment file at ..."` — tunnel UI, no code |

**Recommendation**: two-phase — (1) add `code`/`error` keys to all browser-handler WS messages and model-proxy-routes HTTP responses (biggest client-facing surface, ~15 strings, zero codes today), then (2) audit doctor-core rows — they're verbose English in the third-party UI panel. Phase 1 is critical (untranslated strings appear as English toasts/errors in an otherwise-i18n client). Phase 2 is nice-to-have (doctor panel is developer-facing but still English-only).
