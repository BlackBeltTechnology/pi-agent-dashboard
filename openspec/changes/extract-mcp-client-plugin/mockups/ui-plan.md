# UI plan — extract-mcp-client-plugin

Surfaces → tokens → states. Token authority: `packages/client/src/index.css` (theme-system). Class harvest: `KbSettingsPanel.tsx`, `FolderKbSection.tsx`.

## Surfaces

| # | Surface | Slot / route | Mockup |
|---|---|---|---|
| S1 | Global MCP settings | `settings-section` → `/settings/plugins/mcp-client` | `global-settings.html` |
| S2 | Server editor (drawer, inside S1) | same route, `?server=<name>` | `global-settings.html` (right column) |
| S3 | Folder MCP page | `shell-overlay-route` `/folder/:encodedCwd/mcp` | `folder-page.html` |
| S4 | Folder pill | `sidebar-folder-section` + `worktree-card-section` | `folder-page.html` (top strip) |
| S5 | apple-tools panel (shrunk) | `settings-section` `/settings/plugins/apple-tools` | `folder-page.html` (bottom card) — shows the handoff link only |

## Tokens (no raw hex in mockups)

| Role | Token |
|---|---|
| page bg | `--bg-primary` |
| panel / list row bg | `--bg-secondary` |
| card / input bg | `--bg-tertiary` |
| badge bg | `--bg-surface` |
| heading / body / label | `--text-primary` / `--text-secondary` / `--text-tertiary` |
| hairline | `--border-subtle`; section rule `--border-primary` |
| focus | `--focus-ring`, `--accent` |
| ok / warn / error text | `--severity-success-fg` / `--severity-warning-fg` / `--severity-error-fg` (+ matching `-bg`/`-border`) |
| primary CTA | indigo-500 family (matches KbSettingsPanel primary button) |
| mono values | `font-mono text-[12px]` |

Type scale reused verbatim: section eyebrow `text-[10px] uppercase tracking-wide font-bold`, row title `text-sm font-medium`, meta `text-[11px]`, pill `text-[10px] font-semibold tabular-nums`.

## Layer model → UI vocabulary

| adapter layer | label in UI | editable? |
|---|---|---|
| `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json` | **Shared** (badge, lock icon) | no — "Open file" only |
| `~/.pi/agent/mcp.json` | **Pi global** | yes (S1) |
| `<cwd>/.mcp.json` | **Shared · folder** | no |
| `<cwd>/.pi/mcp.json` | **Pi folder** | yes (S3) |

Provenance badge on every server row. A shared server can still be **overridden** at a Pi layer (disabled / directTools) — row shows both badges: `Shared` + `override`.

## States per surface

S1 list: loading (skeleton rows) · empty (no servers → "Add server" CTA + doc link) · populated · adapter-missing (banner: "pi-mcp-adapter not installed" + Install button, list disabled) · adapter-below-floor (banner: version + Upgrade) · file-parse-error (row-level, shows path + line) · unsaved-edits (sticky footer Save/Discard, discard-confirm on route leave per settings-panel spec).

S2 editor: transport tabs (`stdio` / `http`) — Hick's Law, hide the other transport's fields · secret fields masked with reveal toggle · inline error at field + top summary on save · read-only variant for Shared servers (fields rendered as text, "Override at Pi global" split-button).

S3 folder page: same list, scoped; each row shows *effective* value with "inherited from Pi global" hint; folder override chip removable (→ undo toast, not confirm). Cwd not in `knownFolderCwds` → 403 empty state.

S4 pill: `N servers` · `·` · `M off` (warning color) · `!` on parse error (error color) · `→` opens S3.

## Rules cited

- One primary action per screen (H8) — S1: "Add server"; S2: "Save".
- Label above field, never placeholder-as-label (NN/g web-form-design).
- Inline validate on blur/submit + linked error summary (Baymard; GOV.UK error-summary).
- Prefer undo over confirm; confirm only destructive (NN/g) — remove override = undo toast; delete server = confirm.
- Progressive disclosure for the ~30-field server entry (Hick's) — "Advanced" disclosure below the 6 core fields.
- Recognition over recall (H6) — provenance badge + file path visible on the row, not in a tooltip.
- Color not sole channel (WCAG 1.4.1) — status uses icon + text with color.
- 44px targets on mobile for row actions (Fitts).
