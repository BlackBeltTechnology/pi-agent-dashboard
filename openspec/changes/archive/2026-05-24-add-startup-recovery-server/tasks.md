## 1. Recovery server module

- [x] 1.1 Create `packages/server/src/recovery-server.ts` importing only node built-ins (`node:http`, `node:child_process`, `node:url`, `node:path`, `node:os`, `node:fs`).
- [x] 1.2 Export pure helper `parseModuleNotFoundError(err): string | null` handling `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, and `Cannot find module|package 'X'` phrasings.
- [x] 1.3 Export pure predicate `isModuleNotFoundError(err): boolean`.
- [x] 1.4 Export pure classifier `detectInstallLayout(scriptPath?): "electron" | "npm-global" | "monorepo" | "unknown"`.
- [x] 1.5 Export pure mapper `suggestedReinstallCommand(layout): string`.
- [x] 1.6 Export pure renderer `buildRecoveryHtml(info)` with HTML-entity escaping for `missingModule`, `suggestedFix`, and `error.stack`.
- [x] 1.7 Export `startRecoveryServer(info)` that:
  - binds `info.port` via `http.createServer`
  - serves `GET /` and `GET /index.html` → `buildRecoveryHtml(info)`
  - serves `GET /api/health` → `{ ok: false, mode: "recovery", missingModule, error, suggestedFix, layout }`
  - serves `POST /api/recovery/retry` → respawn detached + `process.exit(0)`
  - serves `POST /api/recovery/reinstall` → spawn `npm install [-g …]`, return last 30 output lines
  - falls through to recovery HTML for unknown routes
  - writes `~/.pi/dashboard/last-recovery.json` snapshot (best-effort, non-fatal on error)
  - exits with code `2` on `EADDRINUSE` (no infinite recovery loop)

## 2. CLI integration

- [x] 2.1 Replace `import { createServer, type ServerConfig }` in `packages/server/src/cli.ts` with type-only `import type { createServer as _CreateServerType, ServerConfig }`.
- [x] 2.2 Add `import { startRecoveryServer, isModuleNotFoundError, parseModuleNotFoundError } from "./recovery-server.js"` at the top of `cli.ts`.
- [x] 2.3 Inside `runForeground(config)`, dynamic-import `./server.js` in a try/catch. On `isModuleNotFoundError(err)` → `startRecoveryServer({ port, error, missingModule })`; return a never-resolving Promise. Other errors re-throw.

## 3. Tests

- [x] 3.1 Unit tests for `parseModuleNotFoundError` (bare module, absolute path, `Cannot find package`, legacy `MODULE_NOT_FOUND`, null/undefined safety).
- [x] 3.2 Unit tests for `isModuleNotFoundError` (positive + negative).
- [x] 3.3 Unit tests for `detectInstallLayout` (npm-global, monorepo, unknown).
- [x] 3.4 Unit tests for `suggestedReinstallCommand` per layout.
- [x] 3.5 Unit tests for `buildRecoveryHtml` including XSS-escape contract.
- [x] 3.6 Integration tests for `startRecoveryServer` on an ephemeral port: `GET /` returns HTML, `GET /api/health` returns recovery JSON, unknown route falls through to HTML.

## 4. Documentation

- [x] 4.1 Add `packages/server/src/recovery-server.ts` row to `docs/file-index-server.md` (caveman style, path-alphabetical).
- [x] 4.2 Add `packages/server/src/__tests__/recovery-server.test.ts` row to `docs/file-index-server.md`.
- [x] 4.3 Append note to existing `cli.ts` row in `docs/file-index-server.md` documenting the dynamic-import + recovery delegation.

## 5. Validation

- [x] 5.1 `npx vitest run packages/server/src/__tests__/recovery-server.test.ts` → 19/19 pass.
- [x] 5.2 Live restart of the dashboard via `POST /api/restart` succeeds (happy path unaffected).
- [x] 5.3 Manual smoke: rename `node_modules/fastify` aside, restart, verify recovery page binds port 8000 and the Reinstall button restores the install. *(Deferred — destructive on the active install; recommended for QA before archive.)*
