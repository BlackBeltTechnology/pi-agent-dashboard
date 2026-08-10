# i18n Audit — `packages/client/src/lib/`

**Files scanned:** all 110 entries in `/tmp/lib.txt`, excluding `i18n.tsx` (the translation engine itself). Skip verdicts: pure logic/type files with zero displayed strings.

---

## Files with Untranslated User-Facing Strings

### A. Display labels & text (visible in UI)

| file | line | category | string |
|------|------|----------|--------|
| `session-status-visuals.ts` | ~26-30 | label | `sourceLabels: { tui: "TUI", dashboard: "Headless", tmux: "tmux", zed: "Zed", terminal: "Terminal" }` |
| `session-display-name.ts` | ~13 | label | `msg.slice(0, 50) + "..."` (hardcoded truncation) |
| `document-title.ts` | 16 | label | `"PI Dashboard"` (bare string) |
| `document-title.ts` | 23-25 | label | `` `${name} — PI Dashboard` `` / `` `${dir} — PI Dashboard` `` |
| `tool-summary.ts` | ~12-35 | label | `toolSummaries` map: `"Read "+path`, `"$ "+cmd`, `"Edit "+path`, `"Write "+path`, etc. |
| `format.ts` | ~5 | status | `WEEKDAYS = ["Sunday","Monday","Tuesday",..."Saturday"]` |
| `format.ts` | ~41 | status | `"Yesterday "+time` |
| `format.ts` | ~62-69 | status | `formatRelativeTime`: `"0s"`, `"3m"`, `"2h"`, `"1d"` |
| `themes.ts` | ~end | label | Theme names: `"Base"`, `"Dracula"`, `"Nord"`, `"GitHub"`, etc. |
| `linkify-tool-output.ts` | ~784 | label | `` `\n+${suppressed} more links suppressed` `` |

### B. Error messages (throw / reject / notify)

| file | line | category | string |
|------|------|----------|--------|
| `spawn-error-toast-bus.ts` | 52 | toast | `` `Spawn failed at ${cwd}: ${code} — ${message}` `` |
| `package-queue.ts` | 194 | error | `"Network error"` |
| `package-queue.ts` | 221 | error | `"Server busy"` |
| `package-queue.ts` | 236 | status | `"Running…"` |
| `package-queue.ts` | 282,302 | error | `"Operation failed"` |
| `package-queue.ts` | 294 | status | `"Done"` |
| `package-queue.ts` | ~288 | toast | `` `${msg.action} complete (${n} sessions reloaded)` `` |
| `event-reducer.ts` | 1090 | error | `"Provider error"` |
| `gateway-api.ts` | 93 | error | `"Failed to connect tunnel"` |
| `gateway-api.ts` | 98 | error | `"Failed to disconnect tunnel"` |
| `gateway-api.ts` | 53,55 | error | `"enroll failed"` |
| `gateway-api.ts` | 77 | error | `"config write failed"` |
| `server-switch.ts` | 62 | error | `` `Couldn't reach ${target.host}: ${reason}` `` |
| `staging-socket.ts` | ~59 | error | `"Staging socket timed out after …ms"` |
| `staging-socket.ts` | ~59 | error | `"Staging socket error"` |
| `staging-socket.ts` | ~66 | error | `"Staging socket closed before open"` |
| `editor-api.ts` | 41 | error | `"Network error"` |
| `move-tracker.ts` | 136 | error | `"Move failed"` |
| `plugins-api.ts` | ~80 | error | `` `Cannot enable plugin: missing deps ${blockers}` `` |
| `plugins-api.ts` | ~69 | error | `"GET /api/plugins failed: …"` etc. |

### C. API-client English errors (throw → may reach user toast/alert)

| file | line | category | string |
|------|------|----------|--------|
| `git-api.ts` | 25 | error | `"failed to list changed files"` |
| `git-api.ts` | 46 | error | `"commit failed"` |
| `git-api.ts` | 73 | error | `"failed to list branches"` |
| `git-api.ts` | 103 | error | `"checkout failed"` |
| `git-api.ts` | 113 | error | `"init failed"` |
| `git-api.ts` | 122 | error | `"stash pop failed"` |
| `git-api.ts` | 183 | error | `"failed to list worktrees"` |
| `git-api.ts` | 329 | error | `"init failed"` |
| `git-api.ts` | 469 | error | `"failed to list PRs"` |
| `known-servers-api.ts` | 11,19,26,34 | error | `"failed to list known servers"`, `"failed to add server"`, `"failed to remove server"`, `"failed to discover servers"` |
| `paired-devices-api.ts` | 16 | error | `"failed to list paired devices"` |
| `paired-devices-api.ts` | 24 | error | `"failed to revoke device"` |
| `pairing-api.ts` | 62 | error | `"approve failed"` |
| `tools-api.ts` | 35,40,~48 | error | `"request failed"`, `"failed to list tools"`, `"failed to fetch tool"`, `"failed to set override"`, etc. |
| `browse-api.ts` | ~53 | error | `` `browse failed (HTTP ${status})` `` |
| `browse-api.ts` | ~73 | error | `"classify failed"` |
| `browse-api.ts` | ~83 | error | `"mkdir failed"` |
| `doctor-api.ts` | ~30 | error | `` `GET /api/doctor returned ${status}` `` |
| `doctor-api.ts` | ~36 | error | `"GET /api/doctor returned an invalid shape"` |
| `gateway-setup.ts` | ~35-83 | label | Step titles: `"Install the zrok client"`, `"Enable this environment"`, etc. |
| `fetch-json.ts` | ~55 | error | `"HTTP ${status} (unexpected content-type: …)"` (dynamic but English; displayed to users) |

### D. Files confirmed **no** user-facing strings (skip)

`DisplayPrefsContext`, `SessionAssetsContext`, `api-context`, `auto-init-worktree`, `back-target`, `chat-selection-copy`, `chat-virtual-rows`, `clipboard`, `coalesce-live-events`, `collapse-retried-errors`, `command-filter`, `context-gradient`, `context-usage`, `cwd-visibility`, `device-auth`, `diff-tree`, `draft-storage`, `extract-urls`, `file-icon`, `folder-encoding`, `fx-visibility`, `gateway-config-ops`, `gateway-endpoints`, `gateway-providers`, `git-status-cache`, `group-tool-bursts`, `group-tool-calls`, `history-back`, `installed-list-helpers`, `lineDelta`, `link-origin`, `loading-history`, `mdi-icon-lookup`, `message-history`, `message-queue`, `mobile-depth`, `model-proxy-api`, `monaco-theme`, `move-tracker`, `nav-tracker`, `openspec-board-*`, `openspec-config-api`, `openspec-group-palette`, `openspec-groups-api`, `openspec-tasks-api`, `package-classifier`, `pair-protocol`, `parse-host-input`, `pi-core-api`, `preview-dispatch`, `prompt-answer-encoder`, `prompt-component-registry`, `providers-api`, `rail-width`, `recovery-offer-bus`, `rehydrate-session`, `replay-cache`, `replay-persist`, `resources-api`, `route-builders`, `selectViewedSessionId`, `selectedSessionId`, `session-card-time`, `session-filter-storage`, `session-grouping`, `session-list-scroll`, `sidebar-dnd`, `split-state`, `syntax-theme`, `tool-install-deeplink`, `tree-visible`, `truncate-path`, `use-editors`, `use-loopback-link-open`, `useSplitRatio`, `worktree-init-bus`, `worktree-init-store`, `wrap-ascii-tables`

---

## Summary

| metric | count |
|--------|-------|
| **Files with displayed strings** | **20** |
| **Total untranslated string sites** | **~70** |
| **Display labels / status text** | ~18 |
| **Error messages (thrown or toasted)** | ~42 |
| **API-error fallbacks (English, user-visible)** | ~18 |
| **Pure logic files (no strings, skip)** | 89 |
