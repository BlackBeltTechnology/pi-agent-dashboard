# Doctor Skill

Modular diagnostic skill. Diagnoses why broken in pi-agent-dashboard:
- pi-flows
- Anthropic-messages bridge
- model resolution
- pi install
- peer
- plugin-bridge
- build-reload

Ships in `packages/extension/.pi/skills/doctor/`. Extension present in every install topology.

## Architecture

- `SKILL.md` = thin router. Owns no capability knowledge. Derives symptom map + sweep DAG from module front-matter. Adding module MD auto-registers it, no router edit.
- 7 capability modules under `modules/`: env-node, pi-resolution, peers, plugins-bridges, build-reload, install-topology, model-resolution.
- Each module = uniform 5-part contract: SCOPE, KNOWLEDGE, CHECKS, FIX ROUTING, DERIVES-FROM. Plus `<module>.knowledge.hash` sidecar.
- `_lib/` shared check primitives. Mechanical only; knowledge + fix prose stays in modules.

### _lib/ primitives

| File | Purpose |
|------|---------|
| `front-matter.ts` | Parse module front-matter. |
| `router.ts` | `routeSymptom()`, `buildSweepOrder()`, `planSweep()`. |
| `checks.ts` | Wraps shared `resolvePiPackage` / `resolvePiPackageEntry` / `listPiPackages` / `sourcesMatch` / `parseSourceKey`. No reimplementation. |
| `server-tier.ts` | Server-enriched tier. `/api/health` + `/api/pi-core/versions`. Degrade to `{ok:false}` on down. |
| `provenance.ts` | Label facts file-derived vs server-enriched. `serverUnavailable`. |
| `knowledge-hash.ts` | `extractSemanticTokens`, `checkDrift`. |
| `derive-tokens.ts` | Derive semantic tokens from live sources. |
| `regenerate.ts` | `--check` reports drift; `--write [module]` rewrites sidecars. |

## Routing

3 modes:

| Mode | Trigger | Action |
|------|---------|--------|
| Symptom | symptom phrase | `routeSymptom()` → one module. |
| Named capability | capability name | Read that module MD. |
| Full sweep | no hint / "full" | `buildSweepOrder()` orders env→pi→peers→plugins→build→runtime. |

`planSweep()` short-circuits. Lower-layer failure (missing pi) reported as ROOT CAUSE. Suppresses dependents. Dependent not re-reported as broken bridge.

## Module dependency edges (depends-on)

| Module | depends-on |
|--------|-----------|
| env-node | none |
| pi-resolution | env-node |
| install-topology | env-node |
| peers | pi-resolution |
| plugins-bridges | peers |
| build-reload | install-topology |
| model-resolution | pi-resolution + plugins-bridges |

## Shell-first checks

Read files + `createRequire` first. Work with dashboard server DOWN.

`/api/health` + `/api/pi-core/versions` = additive server-enriched tier via `server-tier.ts`. Degrade to `{ok:false}` on down, never throw.

`provenance.ts` labels every fact file-derived vs server-enriched. `serverUnavailable` true when no server-enriched fact.

## Multi-location pi

`pi-resolution` reports N pi installs:
- CLI binary
- repo node_modules
- managed
- nvm-global
- per-session-cwd `createRequire`

Flags divergence. Flags any location below `piCompatibility.minimum` floor. Floor read from `packages/server/package.json`.

## Peers + name-skew

`probePeer()` tier-1 `createRequire(cwd)` / tier-2 pi `packages[]`.

`detectNameSkew()` reports live package name + dead aliases. Example: legacy `@pi/anthropic-messages` vs current `@blackbelt-technology/pi-anthropic-messages`.

Unresolved peer → dependent bridge `waiting_peers`.

## Two-tier self-update

### Tier 1 — derive-on-run

Versions / peer-names / paths read live every run. Never rot.

### Tier 2 — knowledge-hash

Per-module `<module>.knowledge.hash` over derives-from SEMANTIC TOKENS. Package names + semver, not raw bytes.

`extractSemanticTokens` stable across whitespace. Peer rename / floor bump drifts. `checkDrift` compares live vs stored. Drift flags authored prose possibly stale.

### Regenerate

- `tsx _lib/regenerate.ts --check` reports drift.
- `--write [module]` rewrites sidecars from live sources.
- Never edits authored prose. `doctor --regenerate <module>` proposes prose edits for confirmation. Never silent overwrite.

## AGENTS.md convention

Source-of-truth change maps to one module to regenerate:

| Source-of-truth change | Regenerate module |
|------------------------|-------------------|
| peer rename | peers |
| pi floor bump | pi-resolution |
| new install platform | install-topology |
| new bridge/plugin slot | plugins-bridges |

## Distribution

Registered in `packages/extension/package.json` `pi.skills[]` + `files[]`. `npm pack` includes `.pi/skills/doctor/**`. Auto-loads by NL trigger like sibling extension skills.

## Relation to other skills

Does not replace:
- `debug-dashboard` (runtime how-to)
- `ci-troubleshoot` (CI/release)
- Electron doctor window

Narrates + derives. May call those surfaces.

## Origin

Productizes prototype `FLOWS_HANDOFF_CHECKLIST.md`. See change: add-modular-doctor-skill.
