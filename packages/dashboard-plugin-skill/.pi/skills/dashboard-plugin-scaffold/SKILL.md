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

Two modes, one skill. Mode `new` scaffolds `packages/<id>-plugin/` inside the dashboard monorepo. Mode `augment` retrofits an existing pi-extension at the current working directory with a `pi-dashboard-plugin` manifest field and a `src/dashboard/` React subtree.

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

Skip questions 2-8 entirely if mode is `augment`. The augment-mode questions come **after** the analysis, in step 4b.

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

### 3a.3 Register the workspace

```bash
"$SKILL_PKG/src/scripts/register-workspace.sh" "<id>-plugin"
```

This is idempotent — re-running on an already-registered workspace is a no-op.

### 3a.4 Print next-steps

```
Next steps:
  1. cd $ROOT && npm install
  2. npm run build                 # build the client + plugin
  3. curl -X POST http://localhost:8000/api/restart   # restart dashboard server
  4. npm run reload                # reload all connected pi sessions
  5. Open the dashboard, navigate to your slot, see the scaffold render.
  6. Style plugin UI with host tokens only: read references/host-design.md
     (surfaces, severity/status, accent-text, both modes, no own theme/fonts).
```

Done with mode `new`.

---

## Step 3b — Augment mode preflight

### 3b.1 Verify cwd is a pi extension

```bash
[ -f package.json ] || { echo "No package.json at cwd" >&2; exit 1; }
PEER=$(jq -r '.peerDependencies["pi-coding-agent"] // .dependencies["pi-coding-agent"] // empty' package.json)
[ -n "$PEER" ] || { echo "package.json does not declare pi-coding-agent — not a pi extension" >&2; exit 1; }
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
  "addServer": <true if any proposal needs server hooks>
}
JSON
```

The renderer:

1. Adds `@blackbelt-technology/dashboard-plugin-runtime` and `@blackbelt-technology/pi-dashboard-shared` as `dependencies` (preserves existing deps; sorted alphabetically).
2. Injects the `pi-dashboard-plugin` manifest field into `package.json` (top-level, JSON-safe edit via `jq`).
3. Adds `./client`, `./server` (if applicable), `./bridge` (if applicable) entries to `exports`.
4. Sets `pi-dashboard-plugin.requiredApi` to `^0.x` (the v0.x lock).
5. Creates `src/dashboard/client.tsx` with stubs for each confirmed claim.
6. Creates `src/dashboard/server.ts` only if any proposal needed server hooks.

It does **NOT** modify any other source file.

### 3b.6 Print next-steps

```
Next steps:
  1. npm install
  2. npm run build                 # build your project
  3. Test in pi: pi  (the original TUI surface still works)
  4. Test in dashboard: until node_modules scan ships, link into the dashboard
     monorepo: cd <dashboard-repo> && npm link <your-package-path>
     OR clone your project into <dashboard-repo>/packages/ as a workspace.
  5. Style plugin UI with host tokens only: read references/host-design.md
     (surfaces, severity/status, accent-text, both modes, no own theme/fonts).
  6. When ready: npm publish
     (a future dashboard release will discover your package via node_modules)
```

Done with mode `augment`.

---

## Guardrails

- **Never run `npm publish`, `npm run build`, or restart the dashboard server**. The skill prints next-steps; the user runs them.
- **Never edit existing source files in augment mode** — only `package.json` (manifest injection) and new files under `src/dashboard/`.
- **Refuse to run augment mode if `pi-coding-agent` is not declared** as a dep or peerDep.
- **Refuse to run new mode outside the dashboard monorepo** (no `openspec/` in any ancestor).
- **Refuse to overwrite an existing `packages/<id>-plugin/`** in new mode.
- **Bridge entry defaults to OFF**. Only emit if the user explicitly opts in.
- **Per-callsite confirmation is mandatory** in augment mode — never inject a manifest claim derived from an un-confirmed callsite.

## References

- [`references/slot-taxonomy.md`](references/slot-taxonomy.md) — every supported slot id with prop contract
- [`references/manifest-schema.md`](references/manifest-schema.md) — PluginManifest / PluginClaim canonical schema
- [`references/plugin-context-api.md`](references/plugin-context-api.md) — client SDK (`usePluginConfig`, `useSessionState`, …)
- [`references/server-context-api.md`](references/server-context-api.md) — `ServerPluginContext`
- [`references/tui-to-dashboard-mapping.md`](references/tui-to-dashboard-mapping.md) — canonical TUI → dashboard mapping
- [`references/build-integration.md`](references/build-integration.md) — Vite plugin behavior, dev vs prod, tree-shaking
- [`references/host-design.md`](references/host-design.md) — host design tokens, severity/status, coloured text, both modes, no own theme/fonts, `product-ui` anti-slop profile
