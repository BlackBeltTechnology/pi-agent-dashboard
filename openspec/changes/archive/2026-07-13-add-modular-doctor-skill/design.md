## Context

The dashboard already emits every fact a doctor needs, but across disconnected
surfaces: `/api/health` (mode, compatibility, plugin `bridgeLoadedFrom`),
`/api/pi-core/versions` (installed vs npm-latest, `installSource` global vs
managed), `pi-version-skew.ts` (`computeCompatibility`, floor `minimum 0.78.0`),
`recommended-extensions.ts` (20 entries + requirement probes), and the
resolution primitives in `packages/shared/src` (`resolvePiPackage`,
`resolvePiPackageEntry`, `listPiPackages`, `sourcesMatch`, `parseSourceKey`).
The Electron doctor window is platform-bound and not agent-facing.

Skills in this repo ship via a package's `.pi/skills/<name>/` directory plus its
`package.json` `files`/`pi` keys (8 packages already do this). The pi skill
convention is SKILL.md + detail files resolved relative to the skill dir and
read lazily. `plugin-registry.tsx` demonstrates the hash-driven regeneration
pattern (`PLUGIN_REGISTRY_HASH` over source manifests → regenerate on drift).

A hand-written `FLOWS_HANDOFF_CHECKLIST.md` in the repo root already encodes the
target knowledge and the tier-1/tier-2 resolution model as a prototype.

## Goals / Non-Goals

**Goals:**
- One skill, thin symptom/capability router, N uniform self-contained capability
  MDs read on demand.
- Derive-on-run, shell-first checks that work when the server is down; wrap
  existing primitives, never reimplement resolution.
- Report pi (and peers) across ALL install locations and flag divergence.
- Two-tier self-update: derive-on-run facts never rot; per-module knowledge-hash
  detects authored-prose drift and drives a confirmed `--regenerate <module>`.
- Ship in `packages/extension/.pi/skills/doctor/` so every install gets it.
- Uniform per-module MD contract so modules are added one file at a time without
  touching the router.

**Non-Goals:**
- No new runtime endpoint, protocol message, or application behavior change.
- No silent autonomous rewrite of authored prose (regenerate is confirmed).
- Not replacing `debug-dashboard` (runtime how-to) or `ci-troubleshoot`
  (CI/release) or the Electron doctor window; the skill narrates/derives, and
  may call those surfaces, but does not supersede them.
- Not a package installer/updater; it diagnoses and routes to the correct fix
  command per topology, it does not perform the fix.

## Decisions

### D1. Router is thin and auto-derives its catalog from module front-matter
Each capability MD carries front-matter keys `scope`, `symptoms:` (phrases),
`depends-on:` (module ids). The router builds its symptom→module map and the
sweep DAG from those keys, so adding a module auto-registers it. The router
holds NO capability knowledge itself (prevents a second rot surface).

### D2. Uniform 5-part MD contract
Every capability MD has: (1) SCOPE — one sentence; (2) KNOWLEDGE — authored
failure-mode map for this capability; (3) CHECKS — runnable probes; (4) FIX
ROUTING — symptom → remediation per install topology; (5) DERIVES-FROM — the
live sources it reads + its knowledge-hash sidecar.

### D3. Initial module catalog (7)
`env-node`, `pi-resolution`, `peers`, `plugins-bridges`, `build-reload`,
`install-topology`, `model-resolution`. Chosen to cover the exact surfaces the
real incident exercised.

### D4. Shell-first, server-bonus check tiers
Checks resolve facts from files + `createRequire` first (settings.json,
package.json, resolver primitives) so they run with the server down. When the
server is reachable, `/api/health` and `/api/pi-core/versions` enrich the
report as an additive tier, never a dependency.

### D5. Multi-location pi as first-class
`pi-resolution` reports N pi installs — CLI binary, repo `node_modules`, managed
`~/.pi-dashboard/node_modules`, nvm-global, and per-session-cwd
`createRequire` resolution — and flags divergence and any location below the
`piCompatibility` floor. A single version string is never sufficient.

### D6. Two-tier self-update with per-module knowledge-hash
Tier-1 (derive-on-run) needs no maintenance. Tier-2: each module stores a
`<module>.knowledge.hash` over its `derives-from` sources (mirrors
`PLUGIN_REGISTRY_HASH`). On run, a drift between live-hash and stored-hash marks
that module's authored prose as possibly-stale and offers `--regenerate
<module>` (re-derive tables + flag prose for confirmation). Regeneration is
never silent.

### D7. Home = extension package
Ship in `packages/extension/.pi/skills/doctor/` because the extension is the
only package present in every install topology (npm/Electron/Docker/dev), so the
doctor reaches every user with no extra install step.

### D8. Shared check lib, referenced not duplicated
Tier-1/tier-2 resolution is needed by both `pi-resolution` and `peers`. Extract
a `_lib/` check helper both call (honors the repo DRY rule). Module
self-containment is preserved at the KNOWLEDGE/FIX layer; only the mechanical
probe code is shared.

### D9. AGENTS.md convention is module-scoped
A Documentation Update Protocol row maps each source-of-truth change to the one
module to regenerate (peer rename/new peer → `peers`; pi floor bump →
`pi-resolution`; new install platform → `install-topology`; new bridge/plugin
slot → `plugins-bridges`). One source change → exactly one MD flagged.

## Risks / Trade-offs

- **Router auto-derivation vs. front-matter parsing cost** (D1): parsing every
  module's front-matter on each run is cheap (N small files) and avoids a
  hand-kept catalog that rots — accepted.
- **Shared lib vs. self-containment** (D8): sharing probe code slightly couples
  modules; mitigated by keeping only mechanical resolution in `_lib` and all
  knowledge/fix text in the module MD.
- **Knowledge-hash false positives**: a whitespace/refactor change in a
  derives-from source can drift the hash without changing meaning; mitigated by
  hashing extracted semantic tokens (peer names, version floor, manifest ids)
  rather than raw file bytes where practical.
- **Regenerate quality**: authored prose regeneration is agent-driven and
  gated behind explicit `--regenerate` + confirmation; no silent rewrite avoids
  prose degradation.
- **Server-down partiality**: with the server down the `/api/*` bonus tier is
  absent; the report clearly labels which facts are file-derived vs
  server-enriched so a partial run is not mistaken for a clean bill.
- **Distribution timing**: shipping in the extension means the doctor only
  reaches npm users after a dashboard release cut; until then it is available on
  dev/local checkouts (acceptable — the same release gap this skill diagnoses).
