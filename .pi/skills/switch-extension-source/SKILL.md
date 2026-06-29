---
name: switch-extension-source
description: Switch a monorepo extension/skill package between its published npm source and its local working-tree source, guaranteeing exactly one source per package. Use when "my edits don't take effect", "load local extension", "test the published npm build", or reconciling dev vs distribution package sources.
license: MIT
compatibility: Requires npx tsx. Edits ~/.pi/agent/settings.json + .pi/settings.json.
metadata:
  author: pi-dashboard
  version: "1.0"
---

Toggle a monorepo extension between **npm (published)** and **local (working tree)** source.

## Why this exists

On a dev machine you want extensions to load your **live working tree** so edits take effect.
Distribution users consume the **published npm** package. Both can be wired at once across two
config layers, and whichever pi resolves last wins — non-deterministic ("I edited it but nothing
changed"). This skill enforces exactly **one source per package**.

```
  GLOBAL ~/.pi/agent/settings.json   "packages": [...]
    npm   -> "npm:<npmName>"
    local -> "<repoRoot>/packages/<dir>"      (dir path; pi resolves package.json "pi")

  PROJECT <repo>/.pi/settings.json   "packages":[{ source, extensions:["+packages/<dir>/<entry>"] }]
    local overlay -> only with --overlay; loads ONLY inside this repo; needs pi.extensions
```

`local` (default) = global dir path → loads in **every** session everywhere.
`local --overlay` = project overlay → loads **only when running pi inside this repo**.

## Commands

```bash
npx tsx ./scripts/switch-source.ts status               # where each installed pkg loads from
npx tsx ./scripts/switch-source.ts local <pkg>          # -> local working tree (global path)
npx tsx ./scripts/switch-source.ts local <pkg> --overlay# -> local, this-repo-only (extensions only)
npx tsx ./scripts/switch-source.ts npm   <pkg>          # -> published npm build
```

`<pkg>` = monorepo dir name (`kb-extension`) OR npm name (`@blackbelt-technology/pi-dashboard-kb-extension`).

Each switch **removes all other representations** of that package, timestamped-backs-up every file it
edits (`*.bak-switch-*`), and re-validates JSON before writing.

## Procedure

1. `status` — see current source per package.
2. `local <pkg>` or `npm <pkg>` — flip it. Script guarantees single-source.
3. **Re-load:** `packages[]` is read at session **init**, so the change takes effect on the
   **next session start**. Respawn sessions or `npm run reload` (reload alone may not re-resolve
   the package list in an already-running process — fresh session is the guaranteed path).

## Pitfalls

- **Bridge plugins (flows/goal/automation) are dashboard-managed** via `dashboardPluginBridges` /
  `_dashboardManagedPackages`. This skill does NOT toggle those — leave them to the dashboard UI.
- **npm copy is a frozen snapshot**, not a symlink to your monorepo. After `npm` mode your
  working-tree edits do NOT load until you `local` again.
- **`--overlay` needs `pi.extensions`** — skill-only packages (pi.skills, no extensions) can't use
  the overlay form; use plain `local` (global dir path).
- Same package wired in both layers = non-deterministic load order. Always end with `status` showing
  one source.

## Verification

- `npx tsx ./scripts/switch-source.ts status` shows the target package at exactly one source.
- `python3 -c "import json; json.load(open('<file>'))"` confirms both settings files are valid JSON.
- Respawn a session; the extension loads from the chosen source.
