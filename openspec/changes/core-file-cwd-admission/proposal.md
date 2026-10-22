> **STUB — not yet planned.** Split out of `core-cwd-admission` during its doubt-review cycle 1 (operator decision 2026-10-22). Run `plan-proposal` before implementation. Depends on `core-cwd-admission` (`dependencies.yaml`). `specs/agent-artifact-serving/spec.md` is a draft carried over and still uses the pre-split wording.

## Why

Core file-family routes gate a caller `cwd` on live-session membership (`sessionManager.listAll().some(s => s.cwd === cwd)`), an ad-hoc check CodeQL cannot see. `codeql-baseline.json` books 14 `js/path-injection` entries on `packages/server/src/routes/file-routes.ts` plus lib sinks they feed (`browse.ts`, `lib/grep.ts`, `md-candidates.ts`, `office-preview.ts`, `writable-md-target.ts`, `resolve-file-mention.ts`). Pinned folders and worktrees are admitted by plugin routes but refused by file routes.

## What Changes

- File-family routes admit `cwd` through the shared `admitCwd` + `admissionAllows` guard (via `admitRouteCwd` from `core-cwd-admission`).
- **Widening (accepted by the operator 2026-10-20):** pinned folders and worktrees / subdirectories of known repositories are admitted.
- Layered file-read containment and path-anchor grants stay authoritative. Only the cwd gate changes.

## Capabilities

### New Capabilities
<!-- none expected -->

### Modified Capabilities
- `agent-artifact-serving` (draft in `specs/`): the `/api/file/raw` cwd gate.
- To draft: `file-and-url-preview` (`:97` "cwd must match a known session cwd", `:99-103`), `open-in-editor` (`:27`), `editor-pane-file-handlers` (`:58` save gate), `file-read-containment` (`:10`; the cwd anchor follows the admitted cwd, so the effective anchor inputs widen).

## Impact

TBD at planning.

## Carried findings from `core-cwd-admission` doubt-review cycle 1 (resolve during planning)

1. **Site inventory.** `file-routes.ts` gates: `resolveScopedMdPath :175` (sync, global scope without cwd), `gateFilePath :364`, `gateReadPath :406`, `gateOfficeFile :501`, `/api/file/tree :905`, `md-candidates :1011`, `resolve-mention :1164`, `raw :1203`, `render :1431`, and `exists :1081-1101` (already admits pinned dirs; the only unknown-cwd verdict site). Also `grep-routes.ts:51` and `file-write-binary-routes.ts:380` (editor-pane saves).
2. **Live preview.** `server.ts:3246-3249` (`start-static`) and `:3262-3263` (a quiet re-check on every proxied asset) call the exported `gateFilePath`. Decide on widening, token release and per-asset admission cost.
3. **Raw vs canonical anchor.** `evaluateContainment(resolved, [cwd, …])` receives the raw `cwd` (`file-routes.ts:368,412,505,911,1222,1438`). Decide which form layered containment uses, and add symlinked-cwd regressions per anchor.
4. **`exists` verdict + indeterminate.** `resolveCwdVerdict` can return `indeterminate` (`access/cwd-verdict.ts:96-98`). `issueHeldAdmission` maps every non-admit result to refuse. Branch to 503 before minting.
5. **Async ripple.** `resolveScopedMdPath` becomes async (callers `:207`, `:1039`). The global branch stays unchanged.
6. **`/api/packages/installed`** (`package-routes.ts:99-101`) forwards an ungated `cwd` to `listInstalled`. Trace it and gate it, or book it as residue.
7. **Latency.** `/api/file` is the hot path. Reuse the bench and budget from `core-cwd-admission` D5.
8. **Residue hand-off.** `triage-codeql-alert-debt` currently waits only on `core-cwd-admission`. Decide whether it also waits on this change.

## Discipline Skills

- `security-hardening`: widening admission on read/write file routes and live preview.
- `doubt-driven-review`: widening and containment-anchor decisions.
- `performance-optimization`: async admission on `/api/file` and per-asset preview checks.
- `review-code`: before commit.
