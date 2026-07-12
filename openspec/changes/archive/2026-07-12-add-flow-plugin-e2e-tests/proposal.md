# Add e2e tests for flows / subagents / anthropic-bridge plugins + extensions

## Why

The three flow-adjacent plugins — `flows-plugin`, `subagents-plugin`,
`flows-anthropic-bridge-plugin` — plus their pi-session bridge extensions have
NO end-to-end coverage of their **activation/resolution** path. Every failure
observed in the field lived there, not in rendering: the published bridge
probing a renamed peer (`@pi/anthropic-messages` → dead name), `waiting_peers`
when a peer is unresolvable from cwd, `bridgeLoadedFrom: dashboardPluginBridges`
invisible to pi, the availability gate never opening, and model resolution
failing at agent spawn. The existing faux-model e2e harness only exercises
render, so these regressions ship undetected until a colleague on a fresh
install hits them.

## What Changes

- Adopt a **two-faux-mechanism, three-layer** test strategy:
  - **L1 (engine semantics)** — owned by pi-flows via its `./testing` export
    (`runFauxFlow`); the dashboard does NOT re-test engine internals.
  - **L2 (bridge forward + reducer)** — NEW server-side CONTRACT-PINNED reducer
    tests: event types derived from the bridge `FLOW_EVENT_MAP` (not hand-typed)
    drive the flows-plugin `flow-reducer`, asserting `FlowState` for the core
    lifecycle and that the reducer never throws on any mapped event. No browser,
    no LLM, and NO runtime dependency on pi-flows (see design D2 — the
    `/testing` import proved fragile cross-repo coupling; real-engine fidelity
    moves to L3).
  - **L3 (full activation + render)** — NEW Playwright specs against the Docker
    harness: real pi-flows engine with agents resolving to `faux/faux-1`,
    driven through the dashboard run-flow surface, asserting flow_* render +
    bridge status + `bridgeLoadedFrom`.
- L2 adds NO runtime dependency (amended; see design D2). The contract pin is
  the bridge `FLOW_EVENT_MAP`, imported from the extension package.
- Add a **flow/subagent faux-scenario family** and a **faux role-preset**
  (all roles → `faux/faux-1`) so flow agents resolve to faux without per-spec
  wiring.
- Add **Docker harness peer-presence variants** (both / missing-anthropic /
  legacy-name-only / bridge-registration) so L3 can assert the bridge state
  machine transitions.
- Add **L1 unit gaps** in `flows-anthropic-bridge-plugin`: scoped-name-before-
  legacy probe order (the rename-skew regression), tier-1-miss + tier-2-hit,
  flows-listener fallback; and flows-plugin `flow-reducer` seed-on-start.
- Anchor **each field bug from investigation as a named regression test**.

## Capabilities

### New Capabilities
- `flow-plugin-e2e`: End-to-end + integration test coverage for the flows,
  subagents, and anthropic-bridge dashboard plugins and their bridge
  extensions — the L1 probe/reducer unit gaps, the L2 bridge-forward/reducer
  integration layer driven by `pi-flows/testing`, and the L3 Playwright
  activation/render specs with the faux-model + real-engine harness, including
  the Docker peer-presence variants and faux flow/subagent scenario family.

### Modified Capabilities
<!-- None: no existing spec-level behavior changes; this adds test coverage only. -->

## Impact

- **New test files**: `tests/e2e/flow-*.spec.ts`, `tests/e2e/subagent-*.spec.ts`,
  `tests/e2e/anthropic-bridge-*.spec.ts`; server-side L2 integration tests under
  `packages/flows-plugin/src/__tests__/` (and bridge FLOW_EVENT_MAP tests in
  `packages/extension/src/__tests__/`); L1 unit gaps in
  `packages/flows-anthropic-bridge-plugin/src/__tests__/`.
- **Fixtures**: extend `qa/fixtures/faux-scenarios.ts` with a flow/subagent
  scenario family; add a faux role-preset for the harness.
- **Docker harness**: `docker/test-up.sh` (+ possibly compose overlays) gains a
  peer-presence variant mechanism (e.g. `PI_TEST_PEERS`).
- **Dependencies**: none added for L1/L2 (amended — the `/testing` dep was
  dropped; pi-flows is not in the dashboard's node_modules and its `/testing`
  export is raw TS pulling the whole engine). Real pi-flows is exercised only at
  L3 in the Docker harness where it is genuinely installed.
- **No production code change** — test/fixture/harness only. No plugin runtime
  behavior is modified.

## Discipline Skills

- `scenario-design`: derive the L1/L2/L3 scenario catalog (input · trigger ·
  observable) into `test-plan.md`; force clarification where the spec is thin.
- `doubt-driven-review`: the Docker peer-variant mechanism and the pi-flows
  `/testing` dev-dep are cross-boundary decisions — stress-test before they
  stand.
