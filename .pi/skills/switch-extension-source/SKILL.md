---
name: switch-extension-source
description: Switch a monorepo extension/skill package between its published npm source and its local working-tree source, guaranteeing exactly one source per package. Use when "my edits don't take effect", "load local extension", "test the published npm build", or reconciling dev vs distribution package sources.
license: MIT
compatibility: Requires npx tsx. Edits ~/.pi/agent/settings.json; only cleans up (never adds to) .pi/settings.json.
metadata:
  author: pi-dashboard
  version: "1.0"
---

Toggle a monorepo extension between **npm (published)** and **local (working tree)** source.

## Why this exists

> **GUI equivalent:** Settings → Packages exposes a per-row **Reset to published version** action
> (change: reset-override-to-npm) that resets a local/git-installed row back to its canonical
> `npm:<name>` — install-first / remove-second, confirm-gated. It is the one-click UI analog of
> `switch <pkg> npm` here; keep the two semantically aligned (both drop the local `packages[]`
> registration only, never the working-tree files).

On a dev machine you want extensions to load your **live working tree** so edits take effect.
Distribution users consume the **published npm** package. Both can be wired at once across two
config layers, and whichever pi resolves last wins — non-deterministic ("I edited it but nothing
changed"). This skill enforces exactly **one source per package**.

```
  GLOBAL ~/.pi/agent/settings.json   "packages": [...]
    npm   -> "npm:<npmName>"
    local -> "<repoRoot>/packages/<dir>"      (dir path; pi resolves package.json "pi")

  PROJECT <repo>/.pi/settings.json   cleanup only — never added to, never created
    strips old "+packages/<dir>/<entry>" paths; prunes entries left with an empty filter
```

`local` = global dir path → loads in **every** session everywhere. There is no project-only mode:
the old overlay flag was removed (a `+path` filter can only re-enable files already in the root
manifest, so it never loaded anything new) and now exits 1 pointing at plain `local`.

## Commands

```bash
npx tsx ./scripts/switch-source.ts status               # where each installed pkg loads from
npx tsx ./scripts/switch-source.ts local <pkg>          # -> local working tree (global path)
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
- **An empty project filter shadows global packages.** pi resolves project `packages[]` before
  global and keeps the first entry per extension file path. `{"source":"..","extensions":[]}` in
  `.pi/settings.json` disables the root manifest's `packages/extension/src/bridge.ts`, so the global
  bridge entry (same file) is ignored → every session in the repo hits `REGISTER_TIMEOUT`. The
  script prunes such entries on every switch; `node scripts/check-pi-settings-paths.mjs` (CI) rejects
  a committed one.
- Same package wired in both layers = non-deterministic load order. Always end with `status` showing
  one source.

## Verification

- `npx tsx ./scripts/switch-source.ts status` shows the target package at exactly one source.
- `python3 -c "import json; json.load(open('<file>'))"` confirms both settings files are valid JSON.
- Respawn a session; the extension loads from the chosen source.
