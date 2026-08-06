# Add Semgrep and Knip as new-shape local oracles

## Why

After the first four rungs, the local gate covers syntax, types, behaviour,
promise semantics, module structure, and semantic review. Two blind spots remain,
and neither has a substitute among the tools the project already owns.

**Security semantics.** Biome is a linter, not a taint engine — it cannot follow
untrusted data to a dangerous sink, and no amount of rule configuration will make
it. This repo is not a low-risk target for that gap: it spawns `pi` processes,
parses WebSocket frames from remote clients, serves files over HTTP, brokers
zrok tunnels to the public internet, handles bearer/device auth and provider API
keys, and — per `ship-change`'s own guardrail — **explicitly treats CodeRabbit
review text as untrusted input**. A project that has already written down "this
input is untrusted" and has no tool that can trace it is carrying a known,
unmeasured risk.

**Dead code.** Nine packages, heavy AI-authored churn, and a documentation
doctrine that requires a per-file row for every file. Orphaned modules and unused
exports accumulate silently, and each one costs twice: once in the tree, once in
the `AGENTS.md` row that must be maintained for it. Nothing currently detects
them.

This is the last rung deliberately: both tools are new dependencies with new
failure modes and new false-positive profiles, and neither is worth its noise
budget until the cheaper gates are green.

## What Changes

- **Add Semgrep** as a local SAST gate, scoped to changed files. Start from the
  registry rulesets (`p/typescript`, `p/nodejs`, `p/react`, and the
  command-injection and path-traversal packs) rather than authoring custom rules
  on day one. Run it offline against pinned rulesets — no cloud dependency, no
  telemetry, no account required for the gate to function.
- **Triage the baseline before gating.** Semgrep's first run on an established
  codebase produces a mixed bag. Findings are triaged into fix-now, suppress
  with a written reason, or drop-the-rule — and only then does the gate become
  blocking. Ungated noise is how a security tool gets ignored.
- **Add Knip** for unused files, exports, and dependencies across the workspace.
  Knip is whole-graph, so it does **not** join the per-change `quality:changed`
  loop; it runs in CI/nightly where its runtime is free and its findings can be
  batched.
- **Feed Knip's orphans back to the doc tree.** An orphan module and an orphan
  `AGENTS.md` row are the same drift measured from opposite ends. Knip's output
  should be reconcilable with `kb dox lint`'s orphan report rather than being a
  second, unrelated list.
- **Cleanup lands separately.** Consistent with the ratchet: whatever baseline
  debt these tools surface is fixed in its own follow-up change, not bundled into
  the change that installs the tool.

## Capabilities

### New Capabilities

- `sast-scanning` — the Semgrep gate: rulesets, scope, offline operation,
  suppression policy, and when it blocks.
- `dead-code-detection` — the Knip gate: scope, where it runs, and how its
  findings reconcile with the documentation tree.

### Modified Capabilities

- `code-quality-loop` — the oracle gains a second engine class (taint analysis)
  and a whole-graph check that deliberately does not run per-change.
- `ci-cd-pipeline` — Knip and the whole-repo Semgrep pass need a home in CI or
  nightly.
- `kb-dox-tree` — orphan reconciliation between the module graph and the doc tree.

## Non-Goals

- Semgrep Pro / cloud, the AppSec Platform, or any account-gated feature. The
  gate must work offline with pinned rulesets.
- Authoring custom Semgrep rules in this change — adopt the registry first, and
  only write custom rules once the registry's signal is understood.
- Fixing the baseline debt either tool surfaces (separate cleanup change).
- Adding Knip to the per-change loop. It is whole-graph; forcing it into
  `--changed` scope would make it both slow and wrong.
- Replacing CodeRabbit's security review. Semgrep finds patterns; the reviewer
  finds intent. They are complementary.

## Impact

- `package.json` — two new devDependencies plus scripts.
- New config: `knip.json`, `.semgrep.yml` (or equivalent pinned ruleset config).
- `.github/workflows/ci.yml` and/or `nightly.yml` — a home for the whole-graph
  passes.
- `quality:changed` — gains a changed-scope Semgrep step once its baseline is
  triaged.
- **Runtime cost** on every change (~30s Semgrep) and in CI (~10s Knip).
- Semgrep requires **Python 3.10+** on every machine running the gate — a new
  non-Node toolchain prerequisite for local dev, CI, and the Docker harness.

## Open Questions

- **Is the Python prerequisite acceptable?** It affects local dev, CI runners,
  the docker image, and the cross-platform VM smoke matrix. The Docker-based
  Semgrep invocation avoids the host dependency but costs startup time and
  complicates the changed-files scope. This should be settled before adoption,
  not after.
- **What is Semgrep's actual signal on this codebase?** The security argument
  above is a reasoned prior, not a measurement. Unlike every other rung in this
  ladder — each of which was scoped against probe output — **this change is
  unmeasured.** A spike that runs the rulesets and reports the true-positive rate
  should precede implementation; if the finding count is near zero, the honest
  outcome is to drop Semgrep rather than adopt it for the narrative.
- **Does Knip understand this workspace?** Dynamic imports, the generated plugin
  registry, jiti-loaded server sources, pi extension entry points, and Electron
  bundling are all shapes Knip commonly mis-reads as orphans. The config effort
  may exceed the value.
- **Does the Docker harness need either tool**, or do they stay host-side?

## Discipline Skills

- `security-hardening` — the Semgrep half is a security gate; the skill owns the
  threat-model framing that decides which rulesets matter for this attack surface.
- `doubt-driven-review` — two new dependencies, a new language runtime, and a new
  class of CI failure; the Semgrep-value question above should be settled
  adversarially before the dependency lands.
- `performance-optimization` — ~30s added to every local change is a real budget;
  measure it rather than assuming it is fine.
- `code-simplification` — if Knip's config grows to fight false positives, that
  is evidence to drop it, not to keep tuning.
