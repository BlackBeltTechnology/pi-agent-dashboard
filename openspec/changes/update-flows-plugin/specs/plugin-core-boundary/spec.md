# Spec Delta

## ADDED Requirements

### Requirement: Core sources SHALL NOT contain flow string literals
The gate SHALL fail on a string literal that starts with `flow:`, `flow_` or `flow-`, or that contains `pi-flows`, in non-test core sources under `packages/{extension,server,shared,client}/src`, unless the occurrence is allowlisted in `scripts/plugin-boundary-allowlist.json` (for example catalog data in `recommended-extensions.ts`). Comments SHALL be ignored. Test files SHALL NOT be checked. The generated `packages/client/src/generated/plugin-registry.tsx` SHALL be exempt.

#### Scenario: New flow channel literal fails the gate
- **WHEN** a change adds `pi.events.on("flow:complete", ...)` to `packages/extension/src/bridge.ts`
- **THEN** `npm run check:plugin-boundary` SHALL exit non-zero and report the literal

#### Scenario: Flow message type literal fails the gate
- **WHEN** a change adds `case "flow_control":` to `packages/server/src/pairing/browser-gateway.ts`
- **THEN** the gate SHALL report the literal as a violation

#### Scenario: Allowlisted catalog data passes
- **WHEN** `recommended-extensions.ts` contains the literal `"pi-flows"` and an allowlist row covers it
- **THEN** the gate SHALL report nothing for that literal

#### Scenario: Comment mention is ignored
- **WHEN** a core file mentions `flow:complete` only inside a comment
- **THEN** the gate SHALL report nothing for that file

#### Scenario: Test files are not checked
- **WHEN** `packages/shared/src/__tests__/state-replay.test.ts` contains `"flow-event"`
- **THEN** the gate SHALL report nothing for that file

#### Scenario: Planted flow-event literal fails the gate
- **WHEN** a change adds the literal `"flow-event"` to a non-test file in `packages/shared/src`
- **THEN** `npm run check:plugin-boundary` SHALL exit non-zero and report the literal

#### Scenario: Generated plugin registry is exempt
- **WHEN** `packages/client/src/generated/plugin-registry.tsx` contains a literal naming the flows plugin
- **THEN** the gate SHALL report nothing for that file
