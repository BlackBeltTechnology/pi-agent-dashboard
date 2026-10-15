## ADDED Requirements

### Requirement: `shell-headless` slot hosts always-mounted zero-UI plugin claims

A dashboard plugin slot id `shell-headless` SHALL be added to `SLOT_DEFINITIONS` in
`packages/shared/src/dashboard-plugin/slot-types.ts` with multiplicity `many` and payload tier
`react-only`. It SHALL NOT be classified as session- or folder-scoped, so its predicate input
resolves to `never`. Predicates registered on it are never invoked, and the manifest validator SHALL
reject a `shell-headless` claim that declares `predicate` or `shouldRender`. Its props entry in `SlotPropsMap` SHALL be empty.

A consumer `ShellHeadlessSlot()` SHALL be exported from
`packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. It SHALL subscribe to slot-claims
invalidation (`useSlotClaimsVersion`) and render every active registry claim on `shell-headless`
through the standard per-claim wrapping (`SlotErrorBoundary` + `Suspense` + `CurrentPluginLayer`),
without adding a wrapper element. Intent-store contributions are not rendered on this slot.

The shell SHALL mount `ShellHeadlessSlot` exactly once in `packages/client/src/App.tsx`, inside
the shared provider wrapper (`apiProvider`) within `PluginContextProvider`, so that it is mounted for the app's lifetime regardless of layout
(desktop, mobile, focus mode), selected session, open overlay, or session count. Claims on this
slot are intended for plugin-wide side effects (e.g. message subscriptions) and SHOULD render
`null`.

#### Scenario: Slot definition exists

- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "shell-headless"`,
  `multiplicity: "many"`, and payload tier `react-only`

#### Scenario: Shell mounts the slot exactly once

- **WHEN** static analysis scans `packages/client/src/App.tsx`
- **THEN** it SHALL contain exactly one `<ShellHeadlessSlot` JSX mount, located inside
  `PluginContextProvider`

#### Scenario: Headless claim is mounted with zero sessions

- **WHEN** the app renders with zero sessions and no selection
- **AND** an enabled plugin claims `shell-headless`
- **THEN** the claim component SHALL be mounted

#### Scenario: Headless claim is mounted in the mobile layout

- **WHEN** the app renders in the mobile layout
- **AND** an enabled plugin claims `shell-headless`
- **THEN** the claim component SHALL be mounted

#### Scenario: A throwing headless claim does not take down the shell

- **WHEN** a `shell-headless` claim component throws during render
- **THEN** its `SlotErrorBoundary` SHALL contain the error
- **AND** the rest of the shell and other `shell-headless` claims SHALL keep rendering

#### Scenario: Disabled plugin's headless claim is not mounted

- **WHEN** a plugin that claims `shell-headless` is disabled
- **THEN** its claim component SHALL NOT be mounted

#### Scenario: Validator rejects a gated headless claim

- **WHEN** a plugin manifest declares a `shell-headless` claim with a `shouldRender` or
  `predicate`
- **THEN** manifest validation SHALL fail with an error naming the plugin and the slot

#### Scenario: Enabling a plugin at runtime mounts its headless claim

- **WHEN** a plugin that claims `shell-headless` is enabled while the app is running
- **THEN** its claim component SHALL be mounted without a page reload
