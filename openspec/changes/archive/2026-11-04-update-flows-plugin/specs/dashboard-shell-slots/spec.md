# Spec Delta

## MODIFIED Requirements

### Requirement: Dashboard shell SHALL contain zero flow references

The dashboard shell source code SHALL NOT contain any reference to
pi-flows behaviour. This invariant SHALL be enforced by the
`plugin-core-boundary` literal gate (`npm run check:plugin-boundary`):
a string literal that starts with `flow:`, `flow_` or `flow-`, or that
contains `pi-flows`, in a non-test source file under:

- `packages/extension/src/`
- `packages/server/src/`
- `packages/shared/src/`
- `packages/client/src/`

SHALL fail the gate unless the occurrence is allowlisted in
`scripts/plugin-boundary-allowlist.json`. Comments SHALL be ignored.
The generated `packages/client/src/generated/plugin-registry.tsx`
SHALL be exempt.

No flow type allow-list SHALL exist: `FlowState`, `FlowAgentState`,
`FlowAgentStatus`, `FlowAgentCardConfig` and `NodeKind` are defined in
the flows plugin, not in `packages/shared/src/types.ts`.

#### Scenario: Lint catches new flow reference in shell

- **WHEN** any non-test file under
  `packages/{extension,shared,server,client}/src/` (excluding
  allowlisted occurrences) introduces a string literal starting with
  `flow:`, `flow_` or `flow-`, or containing `pi-flows`
- **THEN** the plugin boundary gate SHALL fail CI
- **AND** the failure message SHALL name the file, line, and the
  matching literal

#### Scenario: Lint allows shared FlowState type export

- **WHEN** `packages/shared/src/types.ts` is inspected
- **THEN** it SHALL NOT export `FlowState`
- **AND** no allow-list entry SHALL exist for flow types (the scenario
  title is kept for delta continuity)

#### Scenario: Plugin source is exempt

- **WHEN** files under `packages/flows-plugin/src/` reference flow
  types, channels and components
- **THEN** the plugin boundary gate SHALL NOT scan those files

#### Scenario: Generated plugin registry is exempt

- **WHEN** `packages/client/src/generated/plugin-registry.tsx` contains
  a literal naming the flows plugin
- **THEN** the gate SHALL report nothing for that file
