---
name: dashboard-plugin-scaffold
description: >
  Scaffold a new pi-dashboard plugin in the dashboard monorepo, OR augment an
  existing pi-extension project on disk with dashboard plugin contributions.
  Hybrid skill: a single ask_user batch up front, then prescriptive steps the
  agent follows. Use when the user asks to "create a dashboard plugin", "add
  dashboard support to my extension", "scaffold a plugin", or similar.
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Dashboard Plugin Scaffold

Two modes, one skill. Mode `new` scaffolds `packages/<id>-plugin/` inside the dashboard monorepo. Mode `augment` retrofits an existing pi-extension at the current working directory with a `pi-dashboard-plugin` manifest field and a `src/dashboard/` React subtree. An augmented project lives outside the dashboard monorepo, so its client is **runtime-delivered**: a prebuilt bundle (`dist/client/`) built with the SDK preset, loaded by the stock dashboard.

> **Server TypeScript must be erasable.** The dashboard server loads a plugin's `server` entry with Node's strip-only TypeScript loader, so plugin server code must not use `enum`, runtime `namespace`, or constructor parameter properties, and must import type-only symbols with `import type`. A plugin that does fails to load in isolation (the error names the file). The templates already comply; keep them that way when editing.

## Step 1 — Up-front ask_user batch

Use the `ask_user` tool, method `batch`, with these questions in order:

| # | Method | Title | Notes |
|---|---|---|---|
| 1 | select | "Mode" | options: `["new — scaffold a fresh packages/<id>-plugin/ in this dashboard monorepo", "augment — retrofit an existing pi-extension at cwd with dashboard plugin contributions"]` |
| 2 | input | "Plugin id (kebab-case)" | (mode `new` only) — validated `^[a-z][a-z0-9-]*$`, must not collide with existing `packages/<id>-plugin/` |
| 3 | input | "Display name" | (mode `new` only) — free text, e.g. `"Acme Plugin"` |
| 4 | input | "Priority (default 100; lower = earlier)" | (mode `new` only) — integer string |
| 5 | multiselect | "Slot claims" | (mode `new` only) — options: see `references/slot-taxonomy.md` for the 10 React slots |
| 6 | confirm | "Scaffold a server entry (REST routes + WS handlers)?" | (mode `new` only) — default `true` |
| 7 | confirm | "Scaffold a bridge entry (pi extension that loads in every pi session)?" | (mode `new` only) — default `false`, high blast radius |
| 8 | confirm | "Scaffold a configSchema.json?" | (mode `new` only) — default `true` |
| 9 | select | "Embedded app scope" | (mode `new` only) — options: `["none — no embedded app", "global — one app, not tied to a folder", "project-type — an app on every folder of a project type (marker files)", "project-specific — an app on one project (a declared project id)"]`. See [Embedded app scope](#embedded-app-scope-mode-new). |
| 10 | input | "Project type (^[a-z][a-z0-9-]{0,63}$)" | scope `project-type` only |
| 11 | input | "Marker patterns, one per line (1–16; max 3 segments, `*` inside a segment only, no `**`, no `.git`/`node_modules`)" | scope `project-type` only, e.g. `model/*.judo` |
| 12 | input | "Project id (^[a-z][a-z0-9-]{0,63}$)" | scope `project-specific` only |
| 13 | input | "Absolute folder to write the project id into (empty = do not write)" | scope `project-specific` only |

Skip questions 2-13 entirely if mode is `augment`; skip 10-13 unless the scope needs them. The augment-mode questions come **after** the analysis, in step 4b.

## Step 2 — Branch on mode

If the user picked **`new`**, jump to [Step 3a — New mode](#step-3a--new-mode).

If the user picked **`augment`**, jump to [Step 3b — Augment mode preflight](#step-3b--augment-mode-preflight).

---

## Step 3a — New mode

### 3a.1 Validate inputs

```bash
# Confirm the dashboard monorepo root by walking up for openspec/ + packages/
ROOT=$(pwd)
while [ "$ROOT" != "/" ] && [ ! -d "$ROOT/openspec" ]; do ROOT=$(dirname "$ROOT"); done
[ -d "$ROOT/openspec" ] || { echo "Not inside the dashboard monorepo (no openspec/ dir found)" >&2; exit 1; }
[ -d "$ROOT/packages" ] || { echo "Monorepo missing packages/ dir" >&2; exit 1; }

# Validate id
echo "<id>" | grep -qE '^[a-z][a-z0-9-]*$' || { echo "id must be kebab-case" >&2; exit 1; }

# Refuse collision
[ ! -d "$ROOT/packages/<id>-plugin" ] || { echo "packages/<id>-plugin already exists" >&2; exit 1; }
```

Substitute `<id>` with the user-provided id throughout.

Validate the app-scope answers (questions 9-13) against the same rules the dashboard applies — the renderer re-checks and prints **every** violation. On any violation: report them all and **stop**; write nothing and **do not re-ask** (no extra prompt beyond the final summary confirm).

### 3a.2 Run the renderer

The renderer lives in this skill's parent package as a bin script:

```bash
# Locate the bin script (works whether the skill is installed globally or per-workspace)
SKILL_PKG=$(node -e "console.log(require.resolve('@blackbelt-technology/pi-dashboard-plugin-skill/package.json'))" | xargs dirname)
RENDERER="$SKILL_PKG/src/bin/scaffold.ts"

# Pass answers as JSON via stdin
cat <<JSON | node --import "$(node -e "import('@blackbelt-technology/pi-dashboard-shared/jiti-register.ts')")" "$RENDERER"
{
  "mode": "new",
  "id": "<id>",
  "displayName": "<displayName>",
  "priority": <priority>,
  "slots": [<slotsJsonArray>],
  "server": <true|false>,
  "bridge": <true|false>,
  "configSchema": <true|false>,
  "appScope": <omit | {"scope":"global"} | {"scope":"project-type","type":"<type>","markers":["<marker>", …]} | {"scope":"project-specific","projectId":"<id>","folderPath":"<abs or omit>"}>,
  "outDir": "$ROOT/packages/<id>-plugin"
}
JSON
```

The renderer writes:

```
packages/<id>-plugin/
  package.json                     (with pi-dashboard-plugin manifest)
  tsconfig.json
  vitest.config.ts
  README.md
  configSchema.json                (only if user opted in)
  src/
    client.tsx                     (one section per claimed slot)
    server/index.ts                (only if user opted in)
    bridge/index.ts                (only if user opted in)
  test/
    index.test.ts
```

With an `appScope` other than `none` the renderer also writes `src/app/app.tsx` (a `defineDashboardApp` app) and `src/app/AppRoute.tsx` (a lazy route rendering `<EmbeddedApp>`), and adds the matching claims — see [Embedded app scope](#embedded-app-scope-mode-new).

### 3a.3 Register the workspace

```bash
"$SKILL_PKG/src/scripts/register-workspace.sh" "<id>-plugin"
```

This is idempotent — re-running on an already-registered workspace is a no-op.

### 3a.3b Final summary confirm, then write the project id (scope `project-specific` only)

Show the final summary (files written, claims, scope). For `project-specific` **without** a folder path, warn: *the app matches no folder until the id is declared in a folder's `.pi/dashboard/project.json`*. Ask the one existing final confirm. Only after it is accepted and a folder path was given:

```bash
node --import "$(node -e "import('@blackbelt-technology/pi-dashboard-shared/jiti-register.ts')")" "$SKILL_PKG/src/bin/scaffold.ts" --write-project-id "<folder>" "<id>"
```

It prints one JSON result line. It creates `<folder>/.pi/dashboard/project.json` (`schemaVersion: 1`) or merges the id into the existing one (adds `schemaVersion: 1` only when absent, keeps every other field) via temp file + rename. It **refuses** (exit 1, file unchanged) on a symlinked file/`.pi`/`.pi/dashboard`, a non-regular, oversized (> 64 KiB) or non-object file, a `schemaVersion` other than 1, or a different existing `id` — report the reason (for a different id: it must be changed by hand). A refusal does not undo the scaffold.

### 3a.4 Print next-steps

```
Next steps:
  1. cd $ROOT && npm install
  2. npm run build                 # build the client + plugin
  3. pi-dashboard restart                # restart dashboard server (a bare curl to /api/restart is refused)
  4. npm run reload                # reload all connected pi sessions
  5. Open the dashboard, navigate to your slot, see the scaffold render.
  6. Style plugin UI with host tokens only: read references/host-design.md
     (surfaces, severity/status, accent-text, both modes, no own theme/fonts).
```

Done with mode `new`.

---

## Embedded app scope (mode `new`)

Answer 9 chooses the embedded app, derived from `packages/demo-plugin/src/demo-app/`:

| Scope | Claims | Notes |
|---|---|---|
| `none` | — | no app; the output is unchanged |
| `global` | `shell-overlay-route` `/<id>/*?`, `depth: 1`, `presentation: "content"` | no folder entry |
| `project-type` | route `/folder/:encodedCwd/<id>/*?` (`depth: 2`, `parentPath: "/folder/:encodedCwd"`) + state-only `sidebar-folder-section` | manifest `projectTypes: [{ type, markers }]`; predicate `is<Id>Folder = folderHasProjectType("<type>")`; route passes `projectScope={{ type }}` |
| `project-specific` | same two claims | predicate `folderHasProjectId("<id>")`; route passes `projectScope={{ id }}` |

Scoped apps get **no** `standaloneUrl` and no standalone entry. `requiredApi` stays `^0.x`. The folder entry and the route's `projectScope` keep a deep link on a non-matching folder from mounting the app (*Not available for this folder*). A declared `id` is unauthenticated — never grant privileged data by project id alone.

---

## Step 3b — Augment mode preflight

### 3b.1 Verify cwd is a pi extension

```bash
[ -f package.json ] || { echo "No package.json at cwd" >&2; exit 1; }
PEER=$(jq -r '[(.peerDependencies // {}), (.dependencies // {})] | add | keys[] | select(test("^(@[^/]+/)?pi-coding-agent$"))' package.json | head -1)
[ -n "$PEER" ] || { echo "package.json does not declare pi-coding-agent as a dependency or peerDependency — not a pi extension" >&2; exit 1; }
```

### 3b.2 Run the grep prelude

```bash
SKILL_PKG=$(node -e "console.log(require.resolve('@blackbelt-technology/pi-dashboard-plugin-skill/package.json'))" | xargs dirname)
"$SKILL_PKG/src/scripts/grep-tui-surface.sh" > /tmp/tui-callsites.json
cat /tmp/tui-callsites.json
```

The output is a deterministic JSON list `{ "callsites": [...] }`. Each entry has `{ file, line, callsite, category }` where category is `tui-prompt`, `tui-custom`, `tool-register`, `extension-ui`, or `banned` (session-replacement calls).

### 3b.3 Drive the analysis (LLM step)

For each callsite (skip those with `category: "banned"` after surfacing the bridge invariant warning):

1. Read ±20 lines around the callsite.
2. Match against `references/tui-to-dashboard-mapping.md` (the canonical mapping table).
3. Emit a port proposal:
   ```ts
   {
     file: string,
     line: number,
     callsite: string,
     mappedSlot: SlotId | null,             // null = already-dashboard-aware
     status: "needs-port" | "optional-port" | "already-dashboard-aware",
     componentSuggestion: string | null,
     notes: string,
   }
   ```

Collate into a markdown table. Show it to the user.

### 3b.4 Per-callsite confirmation (ask_user)

Filter to proposals with `status` of `needs-port` or `optional-port`. Use:

```
ask_user method=multiselect
  title="Which TUI callsites should port to the dashboard?"
  options=[<proposal[i].file:proposal[i].line — proposal[i].callsite → proposal[i].mappedSlot>, …]
```

Then confirm:

```
ask_user method=confirm
  title="Proceed with manifest injection and src/dashboard/ scaffold?"
```

### 3b.5 Run the renderer

```bash
cat <<JSON | node ... "$SKILL_PKG/src/bin/scaffold.ts"
{
  "mode": "augment",
  "outDir": ".",
  "confirmedProposals": [<proposal[i] for each user-checked option>],
  "addServer": <true if any proposal needs server hooks>,
  "styles": <true if the project's dashboard UI uses Tailwind utility classes; default false>
}
JSON
```

The renderer **throws before writing anything** (the bin exits 1 and names the missing `pi-coding-agent` peerDep) when `package.json` does not declare `pi-coding-agent` (or a scoped fork) as a dependency or peerDependency. Otherwise it:

1. Adds `@blackbelt-technology/dashboard-plugin-runtime` and `@blackbelt-technology/pi-dashboard-shared` as `dependencies` (preserves existing deps; sorted alphabetically).
2. Injects the `pi-dashboard-plugin` manifest field into `package.json` (top-level, JSON-safe edit).
3. Adds `./client` (and `./server` if applicable) entries to `exports`.
4. Sets `requiredApi` to `^0.x`, `hostApi` to `^<major>.<minor>.0` of the current `PLUGIN_HOST_API_VERSION`, and adds the `pi-dashboard-plugin` keyword (existing keywords kept).
5. Makes the project runtime-deliverable: manifest `clientBundle: "./dist/client/index.js"` (a dedicated client dir; the server entry stays in `src/dashboard/`, outside it), `clientStyles: "./dist/client/client.css"` when `styles` is true, a `build:dashboard` script (`vite build --config vite.dashboard.config.ts --configLoader runner`), devDependencies for it (`vite`, `react`, `@types/react`; plus `tailwindcss`, `@tailwindcss/vite` when `styles`; the author's pins win), and, if `files` is an explicit list, `dist/client/` and `src/dashboard/`.
6. Creates `vite.dashboard.config.ts` (the SDK preset: every import-map specifier external, no React in the bundle).
7. Creates `src/dashboard/client.tsx` with stubs for each confirmed claim.
8. Creates `src/dashboard/server.ts` only if any proposal needed server hooks.

It does **NOT** modify any other source file. The bin prints the next-steps (3b.6) after it finishes.

### 3b.6 Print next-steps

The bin prints these (`src/next-steps.ts`); relay them verbatim. **Never run them yourself.**

```
Next steps:
  1. npm install
  2. npm run build                 # build your project (the TUI surface still works in pi)
  3. npm run build:dashboard       # build the dashboard client bundle into dist/client/
  4. npm publish                   # the package must carry dist/client/ and src/dashboard/
  5. Install it globally: `pi install npm:<package>` from a terminal (the dashboard shows it
     after a dashboard restart), or the dashboard Packages tab (shows it live).
  6. Until published: `npm link` it into the dashboard's packages/ layout, or clone it into
     <dashboard-repo>/packages/ as a workspace.
  7. Trust: the operator trusts the client bundle (and, for a server entry, grants server trust)
     from the Plugins tab on the dashboard host itself.
  8. Style plugin UI with host tokens only: read references/host-design.md
```

Done with mode `augment`.

---

## Guardrails

- **Never run `npm publish`, `npm run build`, `npm run build:dashboard`, `pi install`, or restart the dashboard server**. The skill prints next-steps; the user runs them.
- **Never edit existing source files in augment mode** — only `package.json` (manifest injection) and new files (`src/dashboard/*`, `vite.dashboard.config.ts`).
- **Refuse to run augment mode if `pi-coding-agent` is not declared** as a dep or peerDep (the renderer enforces it and writes nothing).
- **Never trust on the user's behalf** — trusting a plugin's client bundle / server entry is the operator's action on the dashboard host.
- **Refuse to run new mode outside the dashboard monorepo** (no `openspec/` in any ancestor).
- **Refuse to overwrite an existing `packages/<id>-plugin/`** in new mode.
- **Bridge entry defaults to OFF**. Only emit if the user explicitly opts in.
- **Per-callsite confirmation is mandatory** in augment mode — never inject a manifest claim derived from an un-confirmed callsite.

## References

- [`references/slot-taxonomy.md`](references/slot-taxonomy.md) — every supported slot id with prop contract
- [`references/manifest-schema.md`](references/manifest-schema.md) — PluginManifest / PluginClaim canonical schema, incl. the lazy claim `module` field (heavy on-demand surfaces: don't also export the component from the main client entry; dashboard version floor)
- [`references/plugin-context-api.md`](references/plugin-context-api.md) — client SDK (`usePluginConfig`, `useSessionState`, …)
- [`references/server-context-api.md`](references/server-context-api.md) — `ServerPluginContext`
- [`references/tui-to-dashboard-mapping.md`](references/tui-to-dashboard-mapping.md) — canonical TUI → dashboard mapping
- [`references/build-integration.md`](references/build-integration.md) — Vite plugin behavior, dev vs prod, tree-shaking
- [`references/host-design.md`](references/host-design.md) — host design tokens, severity/status, coloured text, both modes, no own theme/fonts, `product-ui` anti-slop profile
