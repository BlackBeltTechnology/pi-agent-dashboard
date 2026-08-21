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

Each switch **removes all other string representations** of that package across versioned/unversioned npm entries and local paths from any checkout, timestamped-backs-up every file it edits (`*.bak-switch-*`), and re-validates JSON before writing. A matching structured entry stops before mutation so its filters are not lost.

## Procedure

1. `status` — see current source per package. Mixed string and structured object entries are supported; structured target rows print `structured (manual)`.
2. `local <pkg>` or `npm <pkg>` — flip it. Script guarantees single-source for string-form entries. If the target itself is structured, the command stops before mutation so its filters are not discarded; preserve those fields while switching it manually.
3. **Re-load:** `packages[]` is read at session **init**, so the change takes effect on the
   **next session start**. Respawn sessions or `npm run reload` (reload alone may not re-resolve
   the package list in an already-running process — fresh session is the guaranteed path).

## Pitfalls

- **Bridge plugins (flows/goal/automation) are dashboard-managed** via `dashboardPluginBridges` /
  `_dashboardManagedPackages`. This skill does NOT toggle those — leave them to the dashboard UI.
- **Structured `packages[]` entries are valid pi settings.** Older script versions called `startsWith` on every entry and crashed during `status`. The current script applies string checks only to strings, reports a matching object as `structured (manual)`, and refuses to switch that target automatically because removing the object would lose its `extensions`/`skills`/`prompts` filters. Completion check: `status` exits 0 against mixed string/object settings and prints the source map.
- **Published entries can carry `@<version>`, and local entries can point at another checkout.** Source matching uses npm package identity plus the `/packages/<dir>` suffix, not only the current repository prefix. After a switch, inspect `~/.pi/agent/settings.json` and require exactly one target source before reload. Restore the pre-switch snapshot if duplicates remain; do not continue to the fresh-Pi gate with conflicting sources.
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
