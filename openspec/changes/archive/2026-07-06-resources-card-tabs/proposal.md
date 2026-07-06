## Why

The Resources surface renders skills / extensions / prompts as a **nested
collapsible tree** where hierarchy carries the meaning: a row's position under
`LOCAL`/`GLOBAL` encodes its scope, its position under a loose group vs a `📦`
package encodes its source, and its type is a group header. With 33+ skills the
tree is slow to scan — every category is collapsed by default, one type's items
are buried under another, and reading "what is this / where does it come from"
means expanding three levels. The tree also cannot surface a subagent
(`.pi/agents/*.md`): pi's resource scanner emits only `skill | extension |
prompt | theme`, so agents are invisible today (an agent literally named
`AGENTS` just sorts to the top of the Skills list).

## What Changes

- **Flatten the tree into per-type card pages.** The single `Resources` page is
  replaced by dedicated left-nav pages: **Skills · Agents · Extensions ·
  Prompts · Themes**, each rendering a responsive **card grid** instead of a
  tree. The facts the tree encoded by position move onto each card as badges:
  **scope** (`local`/`global`), **source** (`loose` vs `📦 pkg-name`), the file
  **path** (monospace line), and the existing activation **toggle**.
- **Add a new `agent` resource type.** The scanner enumerates `.pi/agents/*.md`
  (local) and `~/.pi/agent/agents/*.md` (global), parsing `model` and `tools`
  from frontmatter. Agent cards show `◆ model` + `🔧 tools` badges.
- **Type-specific card treatments.** Theme cards render a palette **swatch
  strip** (bg / surface / accent / text) instead of a description-only row;
  agent cards add the model/tools badges. Skills/Extensions/Prompts use the
  base card.
- **Delete the combined `Resources` page.** No aggregate/landing page remains;
  the left-nav goes straight to per-type pages on both surfaces.
- **Mirror onto both surfaces via one shared component.** A new `ResourceCard` +
  `ResourceCardGrid` replaces `MergedScopeSection` (`resource-tree.tsx`) on both
  **Directory Settings** (scope local+global → `All/Local/Global` filter) and
  the global **Settings** panel (global-only → static `◇ global` pill, no scope
  filter, pages under a new `Resources` nav group).
- **Packages unchanged.** The Packages page keeps its existing manage surface;
  package-contributed resources appear on their type page with a `📦 pkg-name`
  badge, so nothing is hidden and no manage action moves.

Grounded via `frontend-mockup-loop` — interactive mockups of both surfaces and
all five type pages live in `mockup/` (`index.html` = Directory Settings,
`settings.html` = global Settings).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-resource-scanning`: adds `agent` as a scanned resource type (local +
  global discovery from `agents/*.md`) and extends metadata parsing to read
  `model` and `tools` from agent frontmatter.
- `pi-resources-view` / `directory-settings-page`: the browse surface changes
  from a scope-grouped collapsible tree to per-type card-grid pages; the single
  `Resources` page is split into `Skills / Agents / Extensions / Prompts /
  Themes` pages with a search + scope filter.
- `settings-panel`: the global Settings nav gains a `Resources` group exposing
  the same five per-type card pages (global scope only); the page-id registry
  enumerates the new ids.

## Impact

- **Shared** (`packages/shared/src/rest-api.ts`): add `"agent"` to
  `PiResource.type`; add optional `model?`, `tools?` to `PiResource` (agent
  metadata). Add `agents: PiResource[]` to `PiResourceScope`.
- **Server** (resource scanner): enumerate `agents/*.md` at local + global
  scope; parse `model`/`tools` frontmatter; include agents in the `/api/…`
  resources payload. No route shape change beyond the additive fields.
- **Client**:
  - NEW `ResourceCard.tsx` (base card + agent/theme variants) and
    `ResourceCardGrid.tsx` (grid + search filter + scope segmented control).
  - `DirectorySettings.tsx`: drop the `resources` nav item, add five per-type
    pages under a `RESOURCES` group; delete the combined `ResourcesPage`.
  - `SettingsPanel.tsx`: add a `Resources` nav group with the five pages
    (global scope); extend `VALID_SETTINGS_TABS`.
  - `resource-tree.tsx` (`MergedScopeSection` + friends): retired once both
    surfaces move to cards (the `ActivationToggle` + `ResourceReloadBanner`
    primitives are reused by the card).
- **Tests**: `PiResourcesView.*` and directory-settings resource tests migrate
  from tree assertions to card/grid assertions; new scanner tests for the agent
  type + model/tools parsing; new settings-panel nav tests for the Resources
  group.

## Discipline Skills

None of the `eng-disciplines` skills apply — a client-render change plus an
additive, read-only server scan of local files. No auth / untrusted input, no
latency budget, no new external call, no irreversible/migration step. Design was
grounded via `frontend-mockup-loop`.
