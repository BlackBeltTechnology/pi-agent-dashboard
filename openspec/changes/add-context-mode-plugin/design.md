## Context

This change implements the consumer side of `wire-tool-renderer-slot`. It ships a complete dashboard renderer pack for the `context-mode` pi extension's ~11 MCP tools. The plugin is the first concrete application of the plugin tool-renderer surface and serves as the reference implementation for future MCP-extension renderer plugins.

The user (Robert) chose during exploration:
- **Two changes, sequenced** — slot wiring (A) lands first; this plugin (B) consumes it.
- **Loose prop contract** — the plugin slot's expanded optional props (`status`, `result`, `toolDetails`) are consumed where useful, ignored where not.
- **Keep `shouldRender`** — replayed sessions retain `ctx_*` calls after the extension is uninstalled; renderers gracefully hide.
- **Monorepo placement** — sibling of `honcho-plugin` and `subagents-plugin` under `packages/`.
- **New capability** named `pi-dashboard-context-mode-plugin`.
- **Honcho `shouldRender` ergonomics lifted verbatim** — sync `/api/health`-fed cache, closed-by-default, refreshed on `plugin-config-update`.

## Goals

1. Every `ctx_*` tool call in a dashboard chat surface renders with a purpose-built card instead of `GenericToolRenderer`'s raw JSON dump.
2. The three high-value tools (`ctx_execute`, `ctx_batch_execute`, `ctx_search`) get bespoke designs; the remaining 8 share a `CodeOutputCard` primitive.
3. The plugin auto-activates when `context-mode` is present in `~/.pi/agent/settings.json#packages[]` and gracefully no-ops when absent.
4. No new visual primitives — every renderer composes tokens and components already in the dashboard.

## Non-goals

- **Generic `ctx_*`-prefix family renderer** (single component matching all `ctx_*` names). Out of scope — `wire-tool-renderer-slot` keeps per-tool claims explicit, and the structural differences between `ctx_execute`, `ctx_batch_execute`, and `ctx_stats` make one component awkward.
- **Re-rendering pi's TUI output as text.** The plugin builds purpose-built React UIs from `args` + `result`. TUI renderers stay in the extension for pi's terminal surface.
- **Server-side plugin surface.** No `/api/plugins/context-mode/*` routes, no plugin server entry.
- **Renderers for `mcp__pi__*` and other MCP-prefixed tools from other extensions.** Out of scope; would be a separate plugin (`pi-dashboard-pi-web-access-plugin`, etc.) once `wire-tool-renderer-slot` lands.
- **Hot-replacing built-in renderers.** Even though `wire-tool-renderer-slot` makes plugin claims win for any `toolName`, this plugin only claims `ctx_*` names. No claim collides with `read`/`bash`/`edit`/`write`/`Agent`/`ask_user`.

## Decision 1 — Renderer inventory & priority tiers

| Tool | Tier | Rationale |
|---|---|---|
| `ctx_execute` | **Bespoke** | Code is the payload; lack of syntax highlighting is severe. |
| `ctx_batch_execute` | **Bespoke** | Multi-command + multi-query structure; biggest `GenericToolRenderer` pain. |
| `ctx_search` | **Bespoke** | Queries + ranked hits structure needs tabbed / accordion presentation. |
| `ctx_execute_file` | CodeOutputCard | Like `ctx_execute` + path chip. |
| `ctx_fetch_and_index` | CodeOutputCard | URL pill + source + preview text. |
| `ctx_index` | CodeOutputCard | Source label + brief confirmation. |
| `ctx_stats` | CodeOutputCard | KPI grid (Phase-2 candidate for bespoke). |
| `ctx_doctor` | CodeOutputCard | Status checklist (Phase-2 candidate for bespoke). |
| `ctx_upgrade` | CodeOutputCard | One-line "command to run". |
| `ctx_purge` | CodeOutputCard + destructive callout | Action warns user. |
| `ctx_insight` | CodeOutputCard | One-line confirmation. |

The `CodeOutputCard` is a small reusable component owned by the plugin: title header (`toolName` + args summary), optional code/text body, optional output panel. It is **not** exported as a dashboard primitive — it stays internal to the plugin.

Phase 1 ships **all 11 renderers**. The "bespoke vs CodeOutputCard" distinction is the design effort, not the shipping cadence — leaving 8 of 11 tools in `GenericToolRenderer` would defeat the change's purpose.

## Decision 2 — `ctxExtensionPresent` sync cache (lifted from honcho)

Module-level cache:

```ts
// src/client/hooks.ts (mirrors honcho-plugin/src/client/hooks.ts)
let extensionPresentCache = false;   // closed-by-default — no cold-boot flicker

export function getCtxExtensionPresentSync(): boolean {
  return extensionPresentCache;
}

async function refreshExtensionPresentCache(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) { extensionPresentCache = false; return false; }
    const body = await res.json();
    const ctx = (body?.plugins ?? []).find(
      (p: { id?: string }) => p?.id === "context-mode",
    ) as { requirements?: { piExtensions?: { name: string; satisfied: boolean }[] } } | undefined;
    const ext = ctx?.requirements?.piExtensions ?? [];
    const target = ext.find((r) => r.name === "context-mode");
    extensionPresentCache = Boolean(target?.satisfied);
    return extensionPresentCache;
  } catch {
    extensionPresentCache = false;
    return false;
  }
}

void refreshExtensionPresentCache();   // initial probe at module load

if (typeof window !== "undefined") {
  window.addEventListener("plugin-config-update", () => {
    void refreshExtensionPresentCache();
  });
}
```

```ts
// src/client/shouldRender.ts
export function ctxExtensionPresent(/* _props */): boolean {
  return getCtxExtensionPresentSync();
}
```

The 11 claims all reference `shouldRender: "ctxExtensionPresent"` in the manifest. When `context-mode` is absent, every claim's `shouldRender` returns false → the resolution chain from `wire-tool-renderer-slot` falls through to `GenericToolRenderer`.

## Decision 3 — Each renderer consumes the optional `result` and `status` props

Plugin renderers consume the expanded optional props introduced by `wire-tool-renderer-slot`:

- `result?: string` — drives the stdout panel; renders empty state during `status === "running"`.
- `status?: "running" | "complete" | "error"` — drives the loading spinner and error styling.
- `toolDetails?: Record<string, unknown>` — not currently used by `ctx_*` tools (pi-side context-mode `details` is always `{}`) but consumed defensively so future structured output is automatically picked up.
- `images?: ChatImage[]` — not relevant; ignored.
- `context?: ToolContext` — read `context.sessionId` and `context.cwd` when needed (e.g. for any future "Open in editor" affordance); otherwise ignored.

## Decision 4 — No new visual primitives

Every renderer composes:

- **Theme tokens**: `var(--bg-secondary)`, `var(--text-secondary)`, `var(--text-tertiary)`, `var(--border-subtle)`, `text-code` (12px utility from `unify-tool-renderer-code-font-size` if it merges first; otherwise `text-xs`).
- **Syntax highlighting**: ideally a wrapper exported from the dashboard (investigate during implementation); fallback is `react-syntax-highlighter` bundled inside this plugin.
- **Icons**: `@mdi/react` + `@mdi/js` (`mdiCodeBraces`, `mdiDatabase`, `mdiMagnify`, `mdiCheckCircleOutline`, `mdiAlert`, `mdiOpenInNew`, etc.).
- **Plugin's own internal primitives** (`CodeOutputCard`, `LanguagePill`, `KbBadge`) — not exported.

No new CSS variables, no Tailwind config additions, no global styles.

## Decision 5 — Phase 1 vs. Phase 2

**Phase 1 (this change)**: ship all 11 renderers. The 3 bespoke designs get full UX attention; the 8 CodeOutputCard renderers get the shared primitive plus minimal tool-specific styling (chips, badges, callouts).

**Phase 2 (separate follow-up change, not this one)**: bespoke designs for `ctx_stats` (real KPI grid with sparkline), `ctx_doctor` (full checklist styling matching `DiagnosticsSection`), and `ctx_fetch_and_index` (rich URL + preview pane). Punted until usage shows whether the Phase-1 CodeOutputCard fallback is good enough.

## Alternatives considered

1. **Ship as part of `context-mode` upstream** instead of in this monorepo. Rejected — would require `context-mode` to ship a React bundle, dramatically expanding its surface area. Robert chose the dashboard-side plugin path.
2. **Single "MCP family renderer" component** that handles all `mcp__*` and `ctx_*` tools via prefix matching. Rejected for the reasons in Decision 1 above (and in `wire-tool-renderer-slot`'s design.md).
3. **Server-side rendering** (server inspects the tool call and ships pre-rendered HTML). Rejected — couples dashboard server to context-mode internals; React-only client rendering keeps the contract clean and the surface small.
4. **Use `toolDetails` for richer structured output instead of parsing `result` text**. Inviting but requires changes in `context-mode` upstream (it currently returns `details: {}`). Out of scope; revisit when / if upstream ships richer details.

## Open questions

1. **`react-syntax-highlighter` peer dep** — does the dashboard expose a shared `SyntaxHighlighter` wrapper the plugin can lift, or do we bundle our own? `ReadToolRenderer` uses it; ideal to share. Investigate during 4.1; if dashboard exposes a wrapper, lift it; otherwise bundle our own with the same theme.
2. **`CtxPurgeRenderer` content** — does the destructive callout show `args.scope` (`"session"` / `"project"`) + `args.sessionId`? Yes per Decision 1; lock during 5.7 implementation.
3. **`CtxStatsRenderer` KPI layout** — vertical KPI rows vs horizontal grid? Depends on dashboard's existing KPI vocabulary in `DiagnosticsSection` or similar. Survey existing surfaces during 5.4.
4. **`CtxBatchExecuteRenderer` result parsing** — `ctx_batch_execute` returns indexed search results per query. Does the response include parseable per-query section headers, or do we need a heuristic? Investigate during 4.2 with real fixtures.
