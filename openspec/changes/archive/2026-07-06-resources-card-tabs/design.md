# Design — resources-card-tabs

Grounded via `frontend-mockup-loop`. Mockups: `mockup/index.html` (Directory
Settings, local+global) and `mockup/settings.html` (global Settings). Both drive
one shared card component.

## Core pivot: tree position → card badges

The tree encoded three facts by nesting position. Cards carry them explicitly:

| Tree encoded by position | Card element |
|---|---|
| under `LOCAL` / `GLOBAL` | `⬡ local` (green) / `◇ global` (purple) badge |
| loose group vs `📦 pkg` | `loose` badge / `📦 pkg-name` (orange) badge |
| resource type = group header | the **page** (nav tab) it lives on |
| path (only in file view) | monospace path line at card bottom |
| row toggle | toggle top-right of card |

Consequence: **scope stops being structural**, so on Directory Settings it
becomes an `All / Local / Global` segmented filter in the toolbar; a search box
filters by name/description. On global Settings scope is always global, so the
filter is dropped for a static `◇ global` pill.

## New `agent` resource type

Agents (`.pi/agents/*.md`, `~/.pi/agent/agents/*.md`) are not scanned today.

- **Shared**: `PiResource.type` gains `"agent"`; `PiResource` gains optional
  `model?: string` and `tools?: string`; `PiResourceScope` gains
  `agents: PiResource[]`.
- **Scanner**: mirror the existing skill discovery for the `agents/` directory,
  parsing YAML frontmatter `name` / `description` / `model` / `tools`. Missing
  `agents/` dir → empty array (same as missing `skills/`).
- **Card**: agent variant appends `◆ {model}` + `🔧 {tools}` badges (the two
  frontmatter fields that define a subagent).

Decision: reuse the frontmatter parser already used for `SKILL.md`; `model`/
`tools` are just two extra optional fields. No new parser.

## Shared component, two mount points

```
ResourceCard          — base (icon, name, desc, scope+source badges, path, toggle)
   ├─ agent variant   — + model / tools badges
   └─ theme variant   — + swatch strip (bg/surface/accent/text), replaces desc row
ResourceCardGrid      — auto-fill grid + search box + optional scope filter
   ├─ DirectorySettings (scope local+global) → scope filter shown
   └─ SettingsPanel     (scope global only)  → scope filter hidden, ◇ global pill
```

`resource-tree.tsx`'s `MergedScopeSection`/`ResourceItem`/`ResourceGroup`/
`PackageItem` are retired. The two reusable primitives it also exports —
`ActivationToggle` and `ResourceReloadBanner` — move into / are reused by the
card so activation behaviour (optimistic toggle + one-click session reload) is
unchanged.

## Nav placement

**Directory Settings** (flat nav): drop the single `resources` item; add a
`RESOURCES` group header with `Skills / Agents / Extensions / Prompts / Themes`,
each with a count pill. `DirectorySettingsPage` union gains the five ids; the
combined `ResourcesPage` component is deleted.

**Global Settings** (grouped nav): add a **new `Resources` group** — NOT folded
into the existing `Extensions` group, because that group already owns a
`Packages` item and would then contain both a group named "Extensions" and a
resource page named "Extensions" (name clash). `VALID_SETTINGS_TABS` +
`SettingsTab` enumerate the five new ids; each page mounts under the existing
single-`SettingsPanel` instance.

## Packages: untouched

Package management stays on the Packages page. A packaged skill/agent/etc. shows
on its type page with a `📦 pkg-name` badge (source), read-only — clicking opens
the file preview; no uninstall/version affordances leak onto the card. This
preserves the existing "Packages page is the only manage surface" invariant.

## What is explicitly out of scope

- No change to the packages manage flow, `/api/packages/*`, or install/move.
- No change to activation semantics (scope-derived `enabled`, reload banner).
- No aggregate "All resources" page (deleted by request).
- Dark-theme/empty-state/mobile-collapsed-nav polish tracked as implementation
  detail, not new requirements (cards inherit existing theme tokens + the
  responsive nav idioms already in both surfaces).

## Open questions

- Should Prompts/Themes cards be clickable to preview like Skills, or is the
  swatch/description enough? (Assumed: same click-to-preview as today.)
- Agent `tools` frontmatter can be a list or `all`; card renders a compact
  summary (e.g. `edit,read` or `all`) — exact truncation TBD in implementation.
