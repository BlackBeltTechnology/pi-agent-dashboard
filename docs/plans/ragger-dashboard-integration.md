# Ragger Dashboard Integration — Implementation Plan

Status: partially implemented and updated to reflect the shipped schema direction.

## Goal

Expose ragger's local RAG data (workspaces, search, indexing, stats) to the pi-agent-dashboard web UI, using a **hybrid approach**:

1. **Extension UI System** (schema-driven `GenericExtensionDialog`) for workspace CRUD management
2. **Server-side REST proxy** for search and file-level operations that need richer rendering
3. **Schema extensions** to the Generalized Extension UI System so future extensions can build richer UIs without dashboard code changes
4. **Status-bar projection** so extensions can surface lightweight session-aware controls outside the modal

---

## Repositories Affected

| Repo | Role | Scope |
|------|------|-------|
| `pi-agent-dashboard` | Web dashboard monorepo | Server proxy, schema extensions, new view renderers, shared types |
| `pi-ragger` | pi extension | Add `ui:list-modules` / `ui:get-data` / action handlers |
| `ragger` (Python) | RAG backend | Added supporting API endpoints such as workspace file listing for the dashboard integration |

---

## Phase 0: Extend the Generalized Extension UI Schema

> **Design principle**: Every new view type and field type we add must be generic enough for any future extension to use, not just ragger.

### 0.1 New View Types in `UiView`

Current: `"table" | "grid" | "form"`

Add:

```typescript
export interface UiView {
  id: string;
  type: "table" | "grid" | "form" | "search" | "detail" | "metrics";
  title?: string;
  dataEvent?: string;
  updateEvent?: string;
  fields?: UiField[];
  actions?: UiAction[];
  itemActions?: UiAction[];
  
  // NEW: search view config
  searchConfig?: {
    placeholder?: string;
    queryParam?: string;          // param name for search query (default: "query")
    resultDataEvent?: string;     // dataEvent for search results
    resultFields?: UiField[];     // fields to display in results
    resultActions?: UiAction[];   // actions per result row
    debounceMs?: number;          // default 300
  };
  
  // NEW: detail view config
  detailConfig?: {
    sections?: UiDetailSection[];
  };
  
  // NEW: metrics view config
  metricsConfig?: {
    cards?: UiMetricCard[];
  };
}
```

### 0.2 New View Type: `search`

A search view provides:
- A search input with debounce
- Real-time results rendered as a list/table
- Configurable result fields and actions

**Use cases**: Ragger search, log search, file search, any extension that needs query → results flow.

**Rendering** (`GenericExtensionDialog`):
```
┌─────────────────────────────────────┐
│ 🔍 [search input____________] [Go] │
├─────────────────────────────────────┤
│ Result 1: path/to/file.ts          │
│   preview text here...             │
│   [Open] [Copy]                    │
├─────────────────────────────────────┤
│ Result 2: path/other.py            │
│   preview text here...             │
│   [Open] [Copy]                    │
└─────────────────────────────────────┘
```

**Data flow**:
1. User types query → debounced `ui:get-data` with `{ event: resultDataEvent, query }`
2. Extension populates `data.items` with results
3. Results rendered using `resultFields` + `resultActions`

### 0.3 New View Type: `metrics`

A metrics view displays stat cards in a grid:

```typescript
interface UiMetricCard {
  key: string;            // data key to read value from
  label: string;
  icon?: string;
  format?: "number" | "bytes" | "percent" | "duration" | "text";
  color?: string;         // accent color hint
  suffix?: string;        // e.g. "files", "chunks"
}
```

**Rendering**:
```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ 📁 142     │ │ 📄 1,847   │ │ 🕐 2m ago  │ │ 🤖 nomic   │
│ Files      │ │ Chunks     │ │ Last Index │ │ Embedding   │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

**Data flow**: Same `dataEvent` pattern as table — extension returns a single object (not array) with keys matching metric card `key` values.

### 0.4 New View Type: `detail`

A detail view renders sections of key-value pairs for a single item:

```typescript
interface UiDetailSection {
  title?: string;
  fields: UiField[];
}
```

Useful for "click into a row" drill-down without needing a custom component.

### 0.5 New Field Types

Current: `"text" | "number" | "boolean" | "select" | "code" | "datetime" | "textarea"`

Add:

| Type | Rendering | Use Case |
|------|-----------|----------|
| `"badge"` | Colored pill/tag | File extensions, status labels |
| `"progress"` | Progress bar (0-100) | Indexing progress |
| `"snippet"` | Code block with syntax highlight | Search result previews |
| `"link"` | Clickable link/path | File paths, URLs |
| `"bytes"` | Human-readable size | File sizes |

### 0.6 New Action Properties

```typescript
interface UiAction {
  // ... existing ...
  loading?: boolean;           // Show spinner on button
  refreshAfter?: boolean;      // Auto-refresh parent view after action completes
  navigateTo?: string;         // Navigate to viewId after success (alternative to ui:navigate emit)
}
```

### 0.7 Files Changed (Phase 0)

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Add `searchConfig`, `detailConfig`, `metricsConfig`, new field types, `UiMetricCard`, `UiDetailSection` |
| `packages/client/src/components/GenericExtensionDialog.tsx` | Add `renderSearch`, `renderMetrics`, `renderDetail` methods + new field renderers |
| `docs/extension-ui-system.md` | Document new view types and field types |

---

## Phase 1: pi-ragger Extension UI Registration

Enhance `pi-ragger/index.ts` to register dashboard UI modules.

### 1.1 Module: Ragger Manager (workspace CRUD)

Triggered by `/ragger` command. Views:

**View: `status` (metrics)**
```
Cards: Connection Status | Workspaces | Embedding Model | Chat Model
```
Data event: `ragger:status`
Data: `{ connected: bool, workspaceCount: number, embeddingModel: string, model: string }`

**View: `workspaces` (table)**
```
| Name | Files | Chunks | Extensions | Last Indexed | Actions |
|------|-------|--------|------------|-------------|---------|
| default | 142 | 1847 | .ts,.py,.md | 2m ago | [Re-index] [Search] [Delete] |
```
Data event: `ragger:list-workspaces`
Update event: `ragger:change`

**View: `index` (form)**
```
Workspace Name: [________]
Path:           [________]
Replace:        [✓]
[Cancel] [Index]
```

**View: `search` (search)**
```
🔍 [search ragger workspace_____________] 
→ results with snippet previews, path, score
```
Result data event: `ragger:search`
Result fields: `relative_path`, `score`, `language`, `content_preview`

### 1.2 Event Handlers

```typescript
// Data providers
pi.events.on("ui:get-data", async (data) => {
  if (data.event === "ragger:status")     → fetch /health
  if (data.event === "ragger:list-workspaces") → fetch /workspaces
  if (data.event === "ragger:search")     → fetch /workspaces/search
});

// Action handlers
pi.events.on("ragger:index-request", ...)   → POST /workspaces/index
pi.events.on("ragger:delete-request", ...)  → DELETE /workspaces/:name
pi.events.on("ragger:search-request", ...)  // handled by search view data flow
```

### 1.3 Files Changed (Phase 1)

| File | Change |
|------|--------|
| `pi-ragger/index.ts` | Add `ui:list-modules`, `ui:get-data`, action handlers (~150 lines) |

---

## Phase 2: Server-Side Ragger Proxy

For operations that benefit from server-side caching or don't go through the extension (e.g., polling, direct browser access):

### 2.1 Ragger Client (`packages/server/src/ragger/ragger-client.ts`)

```typescript
class RaggerClient {
  private baseUrl: string;
  
  async getHealth(): Promise<RaggerHealth>
  async listWorkspaces(): Promise<RaggerWorkspace[]>
  async getWorkspaceStats(name: string): Promise<RaggerWorkspaceStats>
  async indexWorkspace(name: string, path: string, replace: boolean): Promise<RaggerWorkspaceStats>
  async search(name: string, query: string, k: number): Promise<RaggerSearchResult>
  async deleteWorkspace(name: string): Promise<void>
  async listFiles(name: string): Promise<RaggerFile[]>
}
```

Reads `ragger.baseUrl` from dashboard config (`~/.pi/dashboard/config.json`):
```json
{
  "ragger": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:8170",
    "pollIntervalMs": 30000
  }
}
```

### 2.2 Ragger Poller (`packages/server/src/ragger/ragger-poller.ts`)

Periodic polling (like OpenSpec poller) that:
- Checks ragger server health
- Caches workspace list + stats
- Broadcasts `ragger_status_update` to subscribed browsers when data changes

### 2.3 REST Routes (`packages/server/src/routes/ragger-routes.ts`)

All localhost-guarded:

```
GET  /api/ragger/status                    → cached health + workspace summary
GET  /api/ragger/workspaces                → list all workspaces with stats
GET  /api/ragger/workspaces/:name          → single workspace details
GET  /api/ragger/workspaces/:name/files    → indexed file manifest
POST /api/ragger/workspaces/index          → trigger indexing (proxied)
POST /api/ragger/workspaces/search         → proxy search
DELETE /api/ragger/workspaces/:name        → delete workspace (proxied)
```

### 2.4 WebSocket Broadcast

```typescript
// browser-protocol.ts additions
interface RaggerStatusUpdateMessage {
  type: "ragger_status_update";
  connected: boolean;
  workspaces: RaggerWorkspace[];
}
```

### 2.5 Files Created (Phase 2)

| File | Purpose |
|------|---------|
| `packages/server/src/ragger/ragger-client.ts` | HTTP client for ragger FastAPI |
| `packages/server/src/ragger/ragger-poller.ts` | Periodic polling + change detection |
| `packages/server/src/routes/ragger-routes.ts` | REST endpoints |

### 2.6 Files Modified (Phase 2)

| File | Change |
|------|--------|
| `packages/server/src/server.ts` | Register ragger service + routes |
| `packages/shared/src/browser-protocol.ts` | Add `ragger_status_update` message type |
| `packages/shared/src/types.ts` | Add `RaggerWorkspace`, `RaggerHealth`, etc. |
| `docs/architecture.md` | Document ragger proxy data flow |

---

## Phase 3: Dashboard Client Components

### 3.1 Ragger Status Badge (sidebar)

A small indicator in the session sidebar (similar to OpenSpec badge):
- Green dot + "RAG" when connected
- Red dot when disconnected
- Click → opens ragger management dialog (via `/ragger` command → GenericExtensionDialog)

This is **automatic** — no new component needed. The Extension UI System handles it once `ui:list-modules` registers the `/ragger` command.

### 3.2 Server-Proxy Search (optional enhancement)

If we want a richer search experience than what `GenericExtensionDialog` provides (e.g., full-width search panel with syntax-highlighted snippets), we add:

| File | Purpose |
|------|---------|
| `packages/client/src/components/RaggerSearchPanel.tsx` | Full search panel using server proxy |
| `packages/client/src/hooks/useRagger.ts` | Hook for ragger API calls via server proxy |

This is **Phase 3b** — optional, only if the schema-driven search view isn't sufficient.

---

## Implementation Order

```
Phase 0 (schema extensions)
  ├─ 0.1 Add types to shared/src/types.ts
  ├─ 0.2 Implement renderSearch in GenericExtensionDialog
  ├─ 0.3 Implement renderMetrics in GenericExtensionDialog
  ├─ 0.4 Implement renderDetail in GenericExtensionDialog
  ├─ 0.5 Add new field type renderers (badge, progress, snippet, link, bytes)
  └─ 0.6 Update docs/extension-ui-system.md

Phase 1 (pi-ragger extension)
  ├─ 1.1 Add ui:list-modules handler with all 4 views
  ├─ 1.2 Add ui:get-data handlers (health, workspaces, search)
  └─ 1.3 Add action handlers (index, delete)

Phase 2 (server proxy)
  ├─ 2.1 RaggerClient HTTP wrapper
  ├─ 2.2 Ragger poller (health + workspace cache)
  ├─ 2.3 REST routes
  └─ 2.4 Wire into server.ts + browser protocol

Phase 3 (client enhancements — optional)
  ├─ 3.1 Sidebar badge (automatic via Phase 1)
  └─ 3.2 Full search panel (if schema search isn't enough)
```

### Testing Strategy

| Phase | How to test |
|-------|-------------|
| 0 | Unit tests for new view renderers with mock schemas; visual test with pi-scheduler adding a metrics view |
| 1 | `pi -e pi-ragger/index.ts` → `/ragger` in dashboard → verify modal renders |
| 2 | Start ragger-server → `curl /api/ragger/status` → verify proxy |
| 3 | Full E2E: ragger-server + pi + dashboard browser → search from UI |

---

## Ragger Schema Registration (Pseudocode)

Here's the complete `ui:list-modules` registration that pi-ragger will use:

```typescript
pi.events.on("ui:list-modules", (data: any) => {
  data.modules.push({
    id: "ragger",
    title: "Ragger — Local RAG",
    icon: "databaseSearch",
    command: "/ragger",
    initialViewId: "status",
    views: [
      // ── Metrics overview ──
      {
        id: "status",
        type: "metrics",
        title: "Overview",
        dataEvent: "ragger:status",
        metricsConfig: {
          cards: [
            { key: "connected", label: "Status", icon: "lanConnect", format: "text" },
            { key: "workspaceCount", label: "Workspaces", icon: "folderMultiple", format: "number" },
            { key: "embeddingModel", label: "Embeddings", icon: "brain", format: "text" },
            { key: "model", label: "Chat Model", icon: "robotOutline", format: "text" },
          ]
        },
        actions: [
          { label: "Workspaces", icon: "folderMultiple", emit: "ui:navigate", params: { viewId: "workspaces" } },
          { label: "Search", icon: "magnify", emit: "ui:navigate", params: { viewId: "search" } },
        ]
      },
      // ── Workspace table ──
      {
        id: "workspaces",
        type: "table",
        title: "Workspaces",
        dataEvent: "ragger:list-workspaces",
        updateEvent: "ragger:change",
        fields: [
          { key: "workspace", label: "Name", type: "text" },
          { key: "file_count", label: "Files", type: "number" },
          { key: "chunk_count", label: "Chunks", type: "number" },
          { key: "indexed_extensions", label: "Extensions", type: "badge" },
          { key: "last_indexed_at", label: "Last Indexed", type: "datetime" },
        ],
        itemActions: [
          { label: "Re-index", icon: "refresh", emit: "ragger:reindex-request", primaryParam: "workspace" },
          { label: "Search", icon: "magnify", emit: "ragger:navigate-search", primaryParam: "workspace" },
          { label: "Files", icon: "fileMultiple", emit: "ragger:navigate-files", primaryParam: "workspace" },
          { label: "Delete", icon: "trashCanOutline", emit: "ragger:delete-request", primaryParam: "workspace", variant: "danger", confirm: "Delete this workspace?" },
        ],
        actions: [
          { label: "Index New", icon: "plus", emit: "ui:navigate", params: { viewId: "index" }, variant: "primary" },
        ]
      },
      // ── Index form ──
      {
        id: "index",
        type: "form",
        title: "Index Workspace",
        fields: [
          { key: "workspace", label: "Workspace Name", type: "text", required: true, placeholder: "default" },
          { key: "path", label: "Path to Index", type: "text", required: true, placeholder: "/path/to/codebase" },
          { key: "replace", label: "Replace Existing", type: "select", options: [
            { label: "Yes — full reindex", value: true },
            { label: "No — incremental", value: false },
          ] },
        ],
        actions: [
          { label: "Cancel", emit: "ui:navigate", params: { viewId: "workspaces" } },
          { label: "Start Indexing", icon: "database", emit: "ragger:index-request", variant: "primary" },
        ]
      },
      // ── Search ──
      {
        id: "search",
        type: "search",
        title: "Search",
        searchConfig: {
          placeholder: "Search indexed code...",
          resultDataEvent: "ragger:search",
          resultFields: [
            { key: "relative_path", label: "File", type: "link" },
            { key: "score", label: "Score", type: "number" },
            { key: "language", label: "Language", type: "badge" },
            { key: "content_preview", label: "Preview", type: "snippet" },
          ],
          resultActions: [
            { label: "Copy Path", icon: "contentCopy", emit: "ragger:copy-path", primaryParam: "relative_path" },
          ],
          debounceMs: 300,
        }
      },
      // ── File list (detail/table for a workspace) ──
      {
        id: "files",
        type: "table",
        title: "Indexed Files",
        dataEvent: "ragger:list-files",
        fields: [
          { key: "relative_path", label: "Path", type: "link" },
          { key: "extension", label: "Type", type: "badge" },
          { key: "language", label: "Language", type: "text" },
          { key: "chunk_count", label: "Chunks", type: "number" },
        ],
        actions: [
          { label: "Back", icon: "arrowLeft", emit: "ui:navigate", params: { viewId: "workspaces" } },
        ]
      },
    ]
  });
});
```

---

## Summary: New vs Modified Files

### New Files (8)

| # | File | Phase |
|---|------|-------|
| 1 | `packages/server/src/ragger/ragger-client.ts` | 2 |
| 2 | `packages/server/src/ragger/ragger-poller.ts` | 2 |
| 3 | `packages/server/src/routes/ragger-routes.ts` | 2 |

### Modified Files (7)

| # | File | Phase | Change |
|---|------|-------|--------|
| 1 | `packages/shared/src/types.ts` | 0 | New view types, field types, metric/detail configs |
| 2 | `packages/client/src/components/GenericExtensionDialog.tsx` | 0 | renderSearch, renderMetrics, renderDetail, new field renderers |
| 3 | `docs/extension-ui-system.md` | 0 | Document new schema features |
| 4 | `pi-ragger/index.ts` | 1 | Add ui:list-modules, ui:get-data, action handlers |
| 5 | `packages/server/src/server.ts` | 2 | Register ragger service + routes |
| 6 | `packages/shared/src/browser-protocol.ts` | 2 | Add ragger_status_update message |
| 7 | `docs/architecture.md` | 2 | Document ragger proxy flow |

### Optional Files (Phase 3b)

| # | File | Purpose |
|---|------|---------|
| 1 | `packages/client/src/components/RaggerSearchPanel.tsx` | Full-width search panel |
| 2 | `packages/client/src/hooks/useRagger.ts` | Hook for ragger REST API |

**Total: 3 new files, 7 modified files.** (down from 10+10 in the original plan thanks to the schema-driven approach)
