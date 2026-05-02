## Why

The archived change `2026-04-26-dashboard-plugin-architecture` defined a two-tier rendering model and a plugin manifest format, and `packages/dashboard-plugin-runtime/` ships the loader, slot registry, and React context. `packages/demo-plugin/` exists as a fixture. What is missing is the on-ramp:

1. A pi-extension author who already has a working extension project on disk has no guided path from "my extension uses `ctx.ui.select`, `pi.registerTool`, and a custom TUI component" to "and now it also contributes a dashboard plugin." Today they would have to read the archived design.md, the runtime sources, and the demo-plugin code — then hand-write a manifest, scaffold a `client.tsx`, decide which TUI calls map to which dashboard slots, and figure out the Vite + workspace wiring.

2. A dashboard contributor who wants to add a brand-new plugin in this monorepo has to copy `packages/demo-plugin/`, rename, and cargo-cult the manifest. There is no canonical scaffolding flow.

Both flows are repetitive, error-prone, and the "what TUI surface ports to what dashboard slot" mapping is tribal knowledge living in `bridge.ts` (PromptBus patches), `dashboard-default-adapter.ts`, `tool-renderers/registry.ts`, and the slot taxonomy in `packages/shared/src/dashboard-plugin/`.

## What Changes

- **NEW**: A pi skill `dashboard-plugin-scaffold` shipped as a publishable pi-extension package `@blackbelt-technology/pi-dashboard-plugin-skill`. The skill is hybrid: an `ask_user` batch up front, then prescriptive markdown steps the agent follows.
- **NEW**: Skill mode `new` — scaffolds a fresh `packages/<id>-plugin/` inside the dashboard monorepo. Layout matches `packages/demo-plugin/` (the existing fixture). Renders templates for `package.json` (with `pi-dashboard-plugin` manifest), `src/client.tsx` (with stubs for every requested slot), `src/server/index.ts` (when the user opts in), `src/bridge/index.ts` (only when explicitly opted in — default off), `configSchema.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, and a starter test. Registers the workspace and prints next-steps (`npm install`, `npm run build`, `POST /api/restart`, `npm run reload`).
- **NEW**: Skill mode `augment` — runs in a pi session whose `cwd` is an existing pi-extension project. It (a) detects the build setup, (b) runs a grep prelude (`rg "ctx\.ui\.|pi\.registerTool|registerExtensionUI"`) to collect TUI/extension-UI callsites, (c) drives the agent to read each callsite and propose a port mapping using the canonical mapping table (below), (d) presents the analysis to the user and asks per-callsite whether to port, (e) injects the `pi-dashboard-plugin` manifest field into the existing `package.json`, (f) adds `@blackbelt-technology/dashboard-plugin-runtime` and `@blackbelt-technology/pi-dashboard-shared` as dependencies (the de-facto "SDK" — no new package), (g) scaffolds `src/dashboard/client.tsx` (and `src/dashboard/server.ts` if the project needs server hooks) with stubs derived from the analysis. Augmented projects MUST satisfy the forward-compat contract in design.md "Future Work: external plugin discovery" so the dashboard's eventual `node_modules` scan finds them without changes.
- **NEW**: Canonical TUI → dashboard mapping table (lives in the skill's `references/tui-to-dashboard-mapping.md`):
  - `ctx.ui.select / input / confirm / editor` → already routed via PromptBus → dashboard adapter; **no port needed** (works today). Skill flags these as "already-dashboard-aware."
  - `ctx.ui.multiselect` → routed via the bridge-attached prompt-bus (see `multiselect-polyfill.ts`); also "already-dashboard-aware."
  - `ctx.ui.custom<T>()` → **no-op in pi 0.70 RPC mode**. Requires a React port via a slot claim (`content-view` if it owns the screen, `anchored-popover` if it floats, `settings-section` if it's config UI).
  - `pi.registerTool({ name: X, ... })` → optionally claim `tool-renderer` for a richer rendering of `tool_call` events with `toolName: X`.
  - `pi.events.on("custom-event", ...)` (extension-UI probe) → already covered by `extension-ui-system` if the extension already implements it; the skill points the user at that path instead of porting.
  - Static config the extension reads from `~/.pi/agent/settings.json` → migrate to `plugins.<id>.*` via `usePluginConfig<T>()` + a `configSchema.json`.
- **NEW**: A reference catalog in the skill that maps every supported slot id (10 React-accepting slots) to: (a) when to use it, (b) the prop contract, (c) example template snippet, (d) ordering/multiplicity rules.
- **NOT INTRODUCED**: A new SDK package. The skill adds `dashboard-plugin-runtime` + `pi-dashboard-shared` as deps directly (per user decision; "sdk" is just documentation).
- **NOT INTRODUCED**: ts-morph-based AST analysis. The augment-mode analyzer is grep + LLM (Hybrid Level 3) — the skill markdown drives the agent to reason about each callsite using the canonical mapping table, and the user confirms every port.
- **NOT INTRODUCED**: Auto-publish, auto-PR, or any CI integration. The skill prints next-steps; the user runs them.
- **NOT INTRODUCED**: Code-mods that modify the runtime behavior of the existing pi extension. Augment is purely additive — the original TUI surface continues to work in pure-TUI sessions; the dashboard surface is a parallel subtree.

## Capabilities

### New Capabilities

- `dashboard-plugin-skill`: the on-ramp skill. Defines the two modes (`new`, `augment`), the interactive contract (`ask_user` batch up front, prescriptive steps after), the canonical TUI→dashboard mapping, the template set for new plugins, and the analysis + scaffold contract for augment.

### Modified Capabilities

None. The existing `dashboard-plugin-loader` and `dashboard-shell-slots` capabilities are referenced as the contract the scaffolded output conforms to; nothing in those specs changes.

## Impact

- **NEW package**: `packages/dashboard-plugin-skill/` (publishable pi-extension; ships the skill markdown + templates + reference docs). `private: false`. The package's `pi` field declares the skill so any pi session that installs it picks it up.
- `AGENTS.md` Key Files table — adds the new package and the skill location.
- `README.md` — adds a "Authoring a dashboard plugin" section pointing at the skill.
- `docs/architecture.md` — adds a note in the plugin-architecture section that the skill is the canonical on-ramp.
- No changes to `dashboard-plugin-runtime`, `shared/dashboard-plugin/`, or `demo-plugin`. The skill consumes those packages; it doesn't modify them.
- Forward-compat: the manifest the skill generates conforms to the format described in `dashboard-plugin-loader/spec.md`. When the future change adds `node_modules` scanning, augmented external extensions Just Work — no regeneration needed.

## References

- Archived design and slot taxonomy: `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md`
- Plugin loader + shell-slots specs: `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/specs/`
- Existing fixture: `packages/demo-plugin/`
- Runtime: `packages/dashboard-plugin-runtime/`
- PromptBus / dashboard adapter (the "already-dashboard-aware" TUI surface): `packages/extension/src/prompt-bus.ts`, `packages/extension/src/dashboard-default-adapter.ts`
- Skill convention reference: `.pi/skills/pi-dashboard/SKILL.md` (recipe-style), `.pi/skills/openspec-new-change/SKILL.md` (interactive style). The new skill is hybrid.
