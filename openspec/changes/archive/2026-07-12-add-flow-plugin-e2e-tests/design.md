## Context

The flows / subagents / anthropic-bridge plugins each have two halves: a client
render surface (bundled into the web client) and a bridge extension that runs in
the pi session (probes peers, forwards `flow:*`/subagent events). The existing
Playwright harness (`tests/e2e/`, Docker at `:18000`) drives a real pi RPC
session via a **model faux** (`qa/fixtures/faux-provider.ext.ts`, `faux/faux-1`
selected by `[[faux:...]]` sentinels) and asserts rendered UI. It exercises the
render path only.

pi-flows independently ships a **flow-native faux harness** via its `./testing`
subpath export (`@blackbelt-technology/pi-flows/testing`): `runFauxFlow`,
`runFaux`, `spawnFaux` drive the REAL engine loops (DAG scheduling, decision/
fork/loop routing, finish latch, retry, abort) against a scripted pi-ai faux
provider, in-process, zero network. It solves the nested-pi-ai-registry problem
itself (`resolveNestedCompatPath`) and exposes `onAgentStarted`/`onAgentComplete`
— the exact lifecycle the dashboard bridge forwards.

Field failures were all in activation/resolution: the published bridge probing
a renamed peer, `waiting_peers`, `bridgeLoadedFrom` invisible to pi, availability
gate closed, model resolution failing at spawn.

## Goals / Non-Goals

**Goals:**
- Cover the activation/resolution path the render-only harness misses.
- Use the two faux mechanisms at the layer each fits: pi-flows `/testing` for
  engine + bridge-forward + reducer (in-process); dashboard model-faux + real
  engine for browser activation + render.
- Turn each investigated field bug into a named, cheap-to-run regression test.
- Keep the fast layers (L1/L2) hermetic — no browser, no network, no LLM.

**Non-Goals:**
- Re-testing pi-flows engine internals (owned by pi-flows' own `/testing`
  suites). The dashboard consumes the harness, not re-implements its assertions.
- Any production/runtime behavior change to the plugins or extensions.
- Real-LLM or credentialed test paths.

## Decisions

**D1. Three test layers.**
- L1 unit (vitest): probe order, tier-1/tier-2, listener fallback, reducer
  seed-on-start, `sourcesMatch`. Fastest regression anchors.
- L2 integration (vitest, server-side): a CONTRACT-PINNED reducer test. Event
  types are derived from the bridge `FLOW_EVENT_MAP` (not hand-typed strings),
  driven through the flows-plugin reducer, asserting `FlowState` for the core
  lifecycle AND that the reducer never throws on any mapped event. No runtime
  dependency on pi-flows.
- L3 e2e (Playwright, Docker): the real engine event source. Real pi-flows,
  agents → `faux/faux-1`, run through the dashboard run-flow surface, assert
  render + bridge status. Real-engine fidelity lives HERE, where pi-flows is
  genuinely installed.

**D2. L2 takes NO runtime dependency on `@blackbelt-technology/pi-flows/testing`
(amended after implementation).**
The original plan imported `runFauxFlow` into the dashboard's vitest. Discovered
reality: pi-flows is NOT in the dashboard's `node_modules` (it lives only in
pi's global `settings.json#packages[]` as a dir path), and its `./testing`
export points at RAW TS SOURCE that pulls the whole engine +
`@earendil-works/pi-ai` providers/faux + compat + a nested-registry resolver
(`resolveNestedCompatPath`) needing `@earendil-works/pi-coding-agent`. Importing
it into unit tests would require `vitest server.deps.inline`, engine transitive
deps, and pi-ai/pi-coding-agent version alignment — fragile cross-repo coupling
in the FAST layer. Decision: keep L1/L2 hermetic and dependency-free; the
CONTRACT PIN is `FLOW_EVENT_MAP` (fixtures derive their event names from it, so
a pi-flows rename that updates the map propagates to the fixture, and a reducer
that stops handling a core event fails). The real engine is exercised at L3
(Docker), where it is actually installed. Alternative (option 1: npm dep +
inline transform) rejected as fragile for a unit layer; (option 2: `file:`
sibling dep) rejected as CI-non-portable.

**D3. Faux role-preset in the harness.**
Ship a preset mapping every role (planning/coding/fast/research/compact/vision)
→ `faux/faux-1` so any flow's agents resolve to faux without per-spec role
wiring. This also exercises the `model:resolve` path (a field-bug class).
Alternative (per-spec role setup) rejected as repetitive and error-prone.

**D4. Docker peer-presence variants via env, not compose overlays.**
`docker/test-up.sh` reads a `PI_TEST_PEERS` selector (`both` | `no-am` |
`legacy` | `bad-registration`) and installs/registers peers accordingly.
Alternative (one compose overlay per variant) rejected — multiplies files and
duplicates the base; env keeps one harness, parametrized.

**D5. Start L3 with a synthetic 2-agent flow, add a real flow later.**
A minimal synthetic flow nails the harness machinery without coupling to any
real flow's agent set; a real flow (e.g. invoicebot) is added afterward as a
world regression. Alternative (start with a real flow) rejected — couples the
first test to unrelated flow authoring.

## Risks / Trade-offs

- [pi-flows `/testing` API drift across versions] → pin the dev-dep; L2 fails
  loudly (compile/shape) on drift, which is the desired signal, not silent skew.
- [nested pi-ai registry mismatch in CI layout] → `runFauxFlow` already resolves
  the correct compat copy; L2 CI job must install pi-coding-agent as a resolvable
  dep (same requirement the harness documents).
- [Docker L3 flakiness / first-run image build] → reuse existing globalSetup
  health-gate + `.e2e-managed` marker; keep L3 count small, push detail to L1/L2.
- [legacy-name variant is contrived] → it is a regression guard for the shipped
  scoped-first probe; keep it minimal, documented as a rename-skew anchor.

## Migration Plan

Additive test/fixture/harness change; no deploy, no rollback surface. Land L1
first (no new deps), then L2 (adds the dev-dep), then L3 (adds harness variants).

## Open Questions

- Should the subagents plugin get an L2 integration layer, or is L1 (event map)
  + L3 (render) sufficient given it has no engine of its own?
- Does the faux role-preset live in the Docker image or is it injected by the
  spec's session-spawn helper? (Image-baked is simpler; helper-injected is more
  explicit per test.)
