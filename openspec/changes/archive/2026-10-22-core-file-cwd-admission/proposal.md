> **In planning (plan-proposal).** Split out of `core-cwd-admission` (operator decision 2026-10-22); that change is archived (`archive/2026-10-22-core-cwd-admission`), so `admitRouteCwd`, `sendAdmissionUnavailable` and the `cwd_unknown` / `cwd-admission-unavailable` wire contract exist. Operator decisions 2026-10-22: CodeQL containment modelling → follow-up change `codeql-file-containment-barrier` (C); live preview runs full admission per asset (A); package and canvas-types cwd routes are gated here (A); `triage-codeql-alert-debt` also waits on the follow-up (A); doubt-review cycle 1 sites `/api/resources/toggle`, `/api/openspec/groups*` and `watch_files` are included; cycle 2: workspace folders join the shared known set (operator).

## Why

Core file-family routes gate a caller `cwd` on exact live-session membership (`sessionManager.listAll().some(s => s.cwd === cwd)`, e.g. `packages/server/src/routes/file-routes.ts:353`). Consequences:

- **Bug:** pinned folders and worktrees / subdirectories of known repositories are admitted by plugin, git and openspec routes but refused by file routes. Folder-pane Open/Reveal (`gateFilePath`) and previews for a pinned folder without a live session fail (`scope-anchor-editor-pane-controls` design notes this).
- **Spec drift:** `tool-output-linkification` already says resolve-mention admits pinned directories; the code admits sessions only.
- **Ungated cwds:** `/api/packages/*` (7 routes, including local-scope installs/removes), `/api/canvas-types` GET/PATCH and `/api/resources/toggle` (both write `<cwd>/.pi/settings.json`) forward a caller `cwd` with no gate at all.
- **Other exact-membership gates:** `/api/openspec/groups*` (worktrees, subdirectories and workspace folders cannot be grouped) and the `watch_files` browser message (aligned for consistency; its only client sends session cwds).
- **Addons:** `/api/addons/*` admits against `directoryService.knownDirectories()` (pins ∪ non-ended sessions), a third known set.
- **CodeQL:** the ad-hoc check is invisible to CodeQL. Admission via the modelled `admissionAllows` closes the cwd-only sinks. The `path`-fed sinks (`path.resolve(cwd, relPath)` → async containment, unmodelled) stay open until `codeql-file-containment-barrier`.

## What Changes

- File-family routes admit `cwd` through `admitRouteCwd` + `admissionAllows` (the shared guard from `core-cwd-admission`): `/api/file`, `/api/file/digest`, `/tree`, `/exists`, `/raw`, `/render`, `/md-candidates`, `/md-read`, `/write`, `/resolve-mention`, office/EML/sheet routes (`gateOfficeFile`, `gateFilePath`), `POST /api/open-in-system`, `POST /api/reveal-in-file-manager`, `GET /api/grep`, editor-pane handler saves (`file-write-binary-routes.ts`), live-preview `start-static` and its per-asset proxy re-check, `/api/openspec/groups*`, and the `watch_files` browser message.
- **Widening (operator 2026-10-20):** pinned folders, and worktrees / subdirectories whose main checkout is a known folder, are admitted on these routes.
- **Known set gains workspace folders (operator 2026-10-22):** `listKnownFolderCwds` = sessions ∪ pins ∪ workspace folders, for every admitted route (plugin, git, ungated openspec, file, package, canvas, resources, watch). Without it, workspace-only folders would lose the package/canvas/resources routes they reach today. Gated openspec writes keep exact sessions ∪ pins. **Tightening** follows `admitCwd`: sibling-worktree-only and main-checkout-of-a-known-worktree cwds are refused (unchanged rule from `core-cwd-admission`).
- Refusals keep each route's status and `error` string (`"unknown session path"`, `"unknown cwd"` on exists) and add `code: "cwd_unknown"`. Indeterminate admission → shared 503 body.
- `/api/file/exists` keeps its operator prompt for a refused cwd; an indeterminate verdict answers 503 and never prompts.
- Containment anchors on admitted routes include both the request spelling and the canonical cwd (`token.canonCwd`), including the mention resolver; layered containment and path grants stay authoritative.
- Live-preview per-asset re-check runs full admission on every asset; the `live-server-preview` 10 ms bound applies to direct-match cwds, derived worktrees are bounded by the admission deadline.
- `/api/addons/*` receives the shared known set (`knownCwds`).
- `/api/packages/{installed,install,remove,update,move,reset-to-npm,check-updates}`, `/api/canvas-types` GET/PATCH and `POST /api/resources/toggle` admit a supplied `cwd` (refusal: 403 `cwd_unknown`, D4 body of `core-cwd-admission`). No `cwd` keeps today's fallback.
- Planning commit adds the stub change `codeql-file-containment-barrier` (blocked by this change) and makes `triage-codeql-alert-debt` wait on it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `core-cwd-admission`: new requirements for file-family, groups/watch, package, canvas-types and resource-toggle routes; 503, release and known-set requirements extended.
- `kb-plugin-cwd-guard`, `kb-folder-slot`, `folder-project-identity`, `plugin-cwd-admission`, `addons-folder-view`: known set includes workspace folders.
- `agent-artifact-serving`: `/api/file/raw` cwd gate wording.
- `file-and-url-preview`: `/api/file/raw` cwd gate (`:97-103`) and EML unknown-cwd scenario (`:445`).
- `open-in-editor`: absolute-path containment wording (`:27`).
- `editor-pane-file-handlers`: save gate (`:58`).
- `editor-file-search`: grep cwd gate (`:68-91`).
- `internal-monaco-editor-pane`: `/api/file` + `/api/file/raw` gate wording (`:254`), system-open gate (`:652`), digest "same session check" wording.
- `tool-output-linkification`: resolve-mention cwd gate (`:388-405`).
- `file-read-containment`: per-site anchor sets gain the canonical cwd (`:10`, `:43`); wire-shape scenario allows the admission `code`.
- `live-server-preview`: static re-check overhead bound split by admission path.
- `openspec-change-grouping`: cwd validation uses the shared guard.

## Impact

- Server (`packages/server/src/`): `routes/file-routes.ts`, `routes/grep-routes.ts`, `routes/file-write-binary-routes.ts`, `routes/package-routes.ts`, `routes/canvas-types-routes.ts`, `routes/resource-activation-routes.ts`, `routes/openspec-group-routes.ts`, `routes/live-server-routes.ts` (503 headers), `lib/resolve-file-mention.ts` (canonical anchor), `access/cwd-verdict.ts` (doc note), `server.ts` (live-preview gates, `watch_files`, deps wiring). `lib/route-admission.ts`: `listKnownFolderCwds` adds workspace folders; `routes/addons-routes.ts` wiring; `openspec-routes.ts` exports `isGlobalOpenSpecParent`.
- Client: `FilePreviewOverlay.friendlyReadError` maps `cwd-admission-unavailable`; i18n keys already exist. Accepted as is: a 503 digest shows the changed-on-disk banner (spec fail-safe); editor-pane save 503 reads as busy; package and canvas UIs show the raw refusal text.
- MCP tool callers of these routes see the new 503 / `cwd_unknown` text.
- No data migration. Deploy: server restart + client build. Rollback: revert.

## Discipline Skills

- `security-hardening`: widening admission on read/write file routes, live preview, package installs and canvas writes.
- `doubt-driven-review`: widening and containment-anchor decisions.
- `performance-optimization`: async admission on the `/api/file` hot path and per-asset live-preview checks (D6 bench).
- `review-code`: before commit.
