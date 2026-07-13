---
name: doctor
description: >-
  Diagnose why pi-flows, the Anthropic-messages bridge, model resolution, a pi
  install, a peer, a plugin/bridge, or a build/reload is broken in the
  pi-agent-dashboard. Derives every fact live (works with the server down),
  reports pi across ALL install locations, detects peer name-skew, and routes
  each failure to the topology-correct fix. Use on "flow won't show",
  "bridge waiting_peers", "pi version mismatch", "I built it but it's still
  broken", "which pi is this using", "agent model fails at spawn", "diagnose the
  dashboard", "doctor".
license: MIT
---

# doctor — modular diagnostic skill

This SKILL.md is a **thin router**. It owns NO capability knowledge. Every
diagnostic fact lives in a self-contained capability module under `modules/`,
read on demand. The router derives its symptom map and sweep order from each
module's front-matter (`symptoms:`, `depends-on:`) — so **adding a module MD
auto-registers it with no edit here**.

## Modules

Each `modules/<id>.md` follows a uniform 5-part contract: **SCOPE · KNOWLEDGE ·
CHECKS · FIX ROUTING · DERIVES-FROM** (+ a `<id>.knowledge.hash` sidecar).

| id | scope |
|---|---|
| `env-node` | Node runtime + OS/platform baseline |
| `pi-resolution` | every pi install location, divergence + floor |
| `peers` | pi-flows + anthropic peer, tier-1/tier-2, name-skew |
| `plugins-bridges` | bridge registration (packages[] vs dashboardPluginBridges) + activation |
| `build-reload` | three-component rebuild/reload gaps |
| `install-topology` | npm-global / Electron / Docker / dev + topology fixes |
| `model-resolution` | model:resolve handler, roles/preset, @role resolvability |

## How to route

The router logic lives in `_lib/router.ts` (load modules, build the symptom
map, topo-sort the sweep DAG, plan short-circuit). Use it — do not hand-keep a
catalog.

1. **Symptom phrase** (e.g. "flow won't show") → `routeSymptom(modules, phrase)`
   returns exactly one module id. Read that module MD and run its CHECKS.
2. **Named capability** (e.g. "check peers") → read `modules/peers.md` directly.
3. **Full sweep** (no hint, or "full") → `buildSweepOrder(modules)` orders
   modules env → pi → peers → plugins → build → runtime. Run in order; when a
   module fails, `planSweep(modules, failed)` marks every dependent module
   `suppressed` so a lower-layer failure (missing pi) is reported as the ROOT
   CAUSE and NOT re-reported as a broken bridge.

## Fact provenance (server up or down)

Checks are **shell-first**: they read files + `createRequire` and work with the
dashboard server DOWN. When the server is reachable, `_lib/server-tier.ts`
(`fetchHealth`, `fetchPiCoreVersions`) enriches the report as an ADDITIVE tier.
Every reported fact is labelled `file-derived` or `server-enriched`
(`_lib/provenance.ts`) so a partial (server-down) run is never mistaken for a
clean bill.

## Two-tier self-update

- **Tier 1 (derive-on-run)** — versions, peer names, resolved paths, the
  recommended set are read from live sources every run; they can never rot.
- **Tier 2 (knowledge-hash)** — each module stores `<id>.knowledge.hash` over
  the semantic tokens of its `derives-from` sources (`_lib/knowledge-hash.ts`).
  On run, `checkDrift(id, liveTokens, hashPath)` compares live vs stored; a
  mismatch flags that module's authored prose as possibly stale.

### `--regenerate <module>`

When a module's hash drifts:
1. Re-derive the module's tables from its live `derives-from` sources.
2. Propose edits to the module's authored prose **for confirmation** — never
   overwrite silently.
3. After confirmation, `writeStoredHash(hashPath, liveHash)` to clear the drift.

Regeneration is always confirmed. The AGENTS.md Documentation Update Protocol
maps each source-of-truth change to the single module to regenerate (peer
rename → `peers`; pi floor bump → `pi-resolution`; new install platform →
`install-topology`; new bridge slot → `plugins-bridges`).

## Report format

For each module report: `PASS / FAIL`, the resolved path(s) + version(s) per
tier, the provenance of each fact, and — on FAIL — the matching FIX ROUTING
remediation for the detected install topology. Never report a version without
the resolved path it came from.
