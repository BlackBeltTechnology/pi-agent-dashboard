# Clean up mechanical lint debt (cycles, undeclared deps, misused promises, client async)

## Why

Biome 2.5.1 is already installed and already ships the type-aware `types` domain
and the `project`/`suspicious` structural rules — the repo just never enabled
them. A probe with those rules on shows **169 latent findings** that today's
`quality:changed` oracle cannot see, because every rule it runs is single-file
and syntactic.

The ratchet doctrine (`docs/code-quality.md`) is one-way: **cleanup lands first,
severity flips second.** This change is the first of two cleanup rungs. It takes
the mechanical and lower-risk half so that `add-typeaware-lint-gate` can flip the
severities on a green tree.

One finding is not cosmetic: `packages/extension/src` does
`await import("@earendil-works/pi-ai")` at `provider-register.ts:652` and
`bridge.ts:1399` while declaring that dependency **only in the root manifest**.
`packages/extension` is public and root `files[]` ships its `src/`, so a consumer
installing the published package gets a dynamic import of a package its own
manifest never declares. It resolves today purely by hoisting. That is a live
violation of the standing `workspace-publishing` requirement *"Published tarballs
contain resolvable concrete semver dependencies"*.

## What Changes

Scope = every finding **except** the async-semantics work in `packages/server`
and `packages/extension`, which is deferred to
`cleanup-async-semantics-server-extension` (per-site judgement, hot WS/PTY paths).

- **Undeclared dependencies (2 real + 1035 false).** Add
  `correctness.noUndeclaredDependencies: "off"` to the **existing**
  `__tests__/**` override in `biome.json`. This alone removes 1035 findings
  (`vitest` in test files + `jszip` via mammoth), all artifacts of root-hoisted
  devDependencies against Biome's nearest-manifest resolution. Then fix the 2
  genuine ones: declare `@earendil-works/pi-ai` in
  `packages/extension/package.json` and `react` in `packages/shared/package.json`
  (type-only import in `dashboard-plugin/ui-primitives.ts`).
- **Import cycles (17).** Break `noImportCycles` violations: 13 in
  `packages/client`, 2 in `packages/server`, 2 in `packages/flows-plugin`.
- **Misused promises (11).** Fix `noMisusedPromises`: 6 `packages/electron`,
  3 `packages/client`, 2 `packages/server`.
- **Floating promises outside server+extension (88).** Fix
  `noFloatingPromises` in `packages/client` (70), `packages/flows-plugin` (7),
  `packages/roles-plugin` (5), `packages/shell` (3), `packages/electron` (1),
  `packages/subagents-plugin` (1), `packages/automation-plugin` (1).
- **No severity flips.** `biome.json` rule severities are NOT changed here beyond
  the test override. Turning these rules on is `add-typeaware-lint-gate`'s job,
  and it is blocked on this change plus its sibling.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — the `__tests__/**` override gains a second rule, and the
  ratchet's "cleanup lands first" precondition is discharged for these rules.
- `workspace-publishing` — the extension workspace is brought back into
  compliance with the existing resolvable-dependency requirement.

## Non-Goals

- Enabling/flipping any rule severity (that is `add-typeaware-lint-gate`).
- Any `packages/server` or `packages/extension` floating-promise fix (that is
  `cleanup-async-semantics-server-extension`).
- Behaviour change. Every fix is expected to be behaviour-preserving; where a fix
  cannot be behaviour-preserving it is escalated to the sibling change, not
  guessed at here.
- Adding new lint engines (Semgrep/Knip) — `add-semgrep-knip-oracles`.

## Impact

- `biome.json` — one key added to the existing `__tests__/**` override.
- `packages/extension/package.json`, `packages/shared/package.json` — one
  dependency declaration each.
- `packages/client/**` (~86 sites), `packages/electron/**` (7),
  `packages/flows-plugin/**` (9), `packages/roles-plugin/**` (5),
  `packages/shell/**` (3), `packages/server/**` (4 — cycles + misused only, no
  floating), `packages/subagents-plugin/**` (1), `packages/automation-plugin/**` (1).
- No runtime API, protocol, or persistence change.

## Open Questions

- **Is "client-side is low risk" actually true at n=70?** The slice was chosen on
  the premise that the blast radius was the WS server; the measured distribution
  is the opposite (client 70, server 16). A floating promise in a React event
  handler is usually benign, but 70 sites is enough that a blanket `void` would
  be a silent-failure factory. Each site needs a per-site call:
  `await` / `void` / `.catch()`.
- **Do any of the 17 import cycles encode real coupling** that should be broken
  structurally rather than by moving a type? A cycle between client modules may
  be a symptom the `event-reducer` decomposition is incomplete.

## Discipline Skills

- `code-quality` — this is the skill's whole-repo cleanup mode; the fix batches
  and the revert-on-red test gate come from it.
- `review-code` — 169 mechanical edits across 8 packages is exactly the diff
  shape where a rubber-stamp is most likely; review before commit.
- `systematic-debugging` — if a fix turns a test red, root-cause it rather than
  reverting to `void` to make the linter quiet.
- `code-simplification` — breaking an import cycle by adding an indirection layer
  is usually the wrong fix; prefer moving the shared type.
