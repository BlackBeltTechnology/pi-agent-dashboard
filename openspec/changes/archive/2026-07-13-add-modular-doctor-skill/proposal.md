## Why

Diagnosing why pi-flows, the Anthropic-messages bridge, or model resolution is
broken currently takes a manual, expert-only investigation across many
disconnected surfaces. A single real incident required tracing: two live pi
versions (CLI vs server), pi-flows loaded from a local checkout vs npm, a peer
that fails tier-1 `createRequire(cwd)` but resolves via tier-2 pi `packages[]`,
a published bridge probing a package name (`@pi/anthropic-messages`) that no
longer exists on npm after a rescope, a frozen npm dashboard (`0.5.4`) 649
commits behind develop, and the "I built the client but never reloaded the
bridge" three-component rebuild trap.

The raw machinery to check these already exists but is scattered and not
agent-facing: `/api/health`, `/api/pi-core/versions`, `pi-version-skew.ts`,
`recommended-extensions.ts`, the Electron doctor window, and the resolution
primitives in `packages/shared/src` (`resolvePiPackage`, `listPiPackages`,
`sourcesMatch`, `parseSourceKey`). There is NO skill that unifies them into a
diagnose → explain → fix flow, is aware of resolution across multiple install
locations, and knows the cross-platform install topologies (npm-global,
Electron bundle, Docker, dev checkout).

The existing diagnostic skills stop short: `debug-dashboard` covers runtime
"why isn't X working" and `ci-troubleshoot` covers CI/release, but neither owns
the external-module topology, multi-location version resolution, or the
peer/plugin/bridge health that this incident exercised.

A hand-written `FLOWS_HANDOFF_CHECKLIST.md` already prototypes exactly this
knowledge. This change productizes it as a first-class, modular, self-updating
doctor skill so any user — not just an expert — can surface a broken package,
plugin, or pi installation and get an exact fix.

## What Changes

- Add a new **modular doctor skill**: one skill with a thin router `SKILL.md`
  plus N self-contained capability MDs, each read on demand.
- The router maps a symptom phrase or capability name to one module, or runs a
  full sweep in dependency order (env → pi → peers → plugins → build → runtime)
  with lower-layer short-circuit (a missing pi does not get reported as a
  broken bridge).
- Each capability MD follows a uniform 5-part contract: **scope · knowledge ·
  checks · fix-routing · derives-from (+ per-module knowledge-hash)**.
- Initial module catalog: `env-node`, `pi-resolution`, `peers`,
  `plugins-bridges`, `build-reload`, `install-topology`, `model-resolution`.
- Checks are **derive-on-run and shell-first** so the doctor works even when the
  dashboard server is down (files + `createRequire` first; `/api/*` endpoints as
  a bonus tier when the server is up). Checks wrap the existing `shared/`
  resolution primitives and server endpoints rather than reimplementing them.
- **Multi-location pi awareness**: the doctor reports N pi installs (CLI, repo
  `node_modules`, managed, nvm-global, per-session-cwd resolution) and flags
  divergence, not a single version string.
- **Two-tier self-update**: (1) derive-on-run facts (versions, peer names,
  resolved paths, recommended set) can never rot because they read live sources;
  (2) a per-module knowledge-hash over each module's `derives-from` sources
  detects drift in the authored prose and triggers a `--regenerate <module>`
  loop (re-derive + flag stale prose for confirmation; never a silent
  self-rewrite).
- Ship the skill in `packages/extension/.pi/skills/` so every dashboard install
  loads it automatically (the extension is the only package present in every
  topology).
- Add an AGENTS.md convention (Documentation Update Protocol row) coupling
  source-of-truth changes to the module that must regenerate (peer rename →
  `peers`, pi floor bump → `pi-resolution`, new install platform →
  `install-topology`, etc.).

## Capabilities

### New Capabilities
- `doctor-skill`: A modular, self-updating diagnostic skill (router + capability
  MDs) that surfaces broken pi / package / plugin / bridge / model-resolution
  state across install topologies, derives its facts from live sources of truth,
  and routes each failure to an exact fix.

### Modified Capabilities
<!-- none: no existing spec-level requirements change -->

## Impact

- **New skill package content**: `packages/extension/.pi/skills/doctor/` —
  `SKILL.md` (router) + capability MDs + a shell-first check library + per-module
  knowledge-hash sidecars.
- **Reuses (no change to signatures)**: `packages/shared/src/pi-package-resolver.ts`
  (`resolvePiPackage`, `resolvePiPackageEntry`, `listPiPackages`),
  `source-matching.ts` (`sourcesMatch`, `parseSourceKey`),
  `recommended-extensions.ts`, `flows-anthropic-bridge-plugin/src/peer-probe.ts`
  constants; consumes `/api/health`, `/api/pi-core/versions`, `pi-version-skew`.
- **Distribution**: because it ships inside the extension package, it reaches
  every install (npm, Electron, Docker, dev) with no separate install step.
- **Docs**: root `AGENTS.md` gains one convention line + a Documentation Update
  Protocol row; a `docs/` doctor topic doc via the caveman-style delegation rule.
- **No application-code behavior change**: the skill is additive knowledge +
  read-only checks + fix guidance. No runtime endpoint or protocol change.

## Discipline Skills

- `observability-instrumentation`: the doctor's entire purpose is making broken
  runtime state visible and diagnosable — checks must emit clear, labelled
  evidence (file-derived vs server-enriched).
- `doubt-driven-review`: the router auto-derivation, sweep short-circuit, and
  the confirmed self-update loop are non-trivial and must be stress-tested
  before they stand.
- `code-simplification`: keep the router thin and the shared check `_lib`
  minimal; resist duplicating knowledge across modules.
