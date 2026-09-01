## ADDED Requirements

### Requirement: Plugins can open a live-server target in the split viewer
The dashboard SHALL expose a client API that lets a plugin mount a registered live-server target in the `live-server` split viewer. Today no such path exists: `startLiveServer` only registers a target and returns a proxied path, `SplitWorkspaceContext.openLiveTarget` is client-internal and not exported to plugins, and `PluginRouter.open(viewId)` is a viewId-based content-view API that is consumed by no runtime code and has no concept of a live-server target.

#### Scenario: Plugin opens a live target
- **WHEN** a plugin calls the exposed open-live-target API with a proxied live-server path
- **THEN** the dashboard mounts that path in the `live-server` split viewer, equivalently to the client-internal `openLiveTarget`

#### Scenario: Existing internal callers are unaffected
- **WHEN** existing client-internal callers open a live target
- **THEN** their behaviour is unchanged, because the plugin-facing API delegates to the same implementation rather than duplicating it

### Requirement: The bridge resolves the provider ordering without inverting it
`PluginContextProvider` is rendered OUTSIDE `SplitWorkspaceProvider`, so `openLiveTarget` does not exist when the plugin context is constructed. The system SHALL bridge this with a mutable reference that the inner provider populates on mount, and SHALL NOT invert the provider nesting.

#### Scenario: Inner provider populates the bridge on mount
- **WHEN** `SplitWorkspaceProvider` mounts
- **THEN** it registers its `openLiveTarget` implementation into the reference held by the outer plugin context

#### Scenario: Provider nesting is preserved
- **WHEN** the change is applied
- **THEN** `PluginContextProvider` still wraps `SplitWorkspaceProvider`, and no existing consumer of either provider changes position

#### Scenario: Bridge is cleared on unmount
- **WHEN** `SplitWorkspaceProvider` unmounts
- **THEN** the reference is cleared, so a stale implementation bound to a dead tree is never invoked

### Requirement: Calling before the bridge is populated is safe and observable
A plugin may call the API before the inner provider has mounted, or in a shell where the split workspace does not exist. The system SHALL NOT throw or fail silently in that case.

#### Scenario: Call before the bridge is ready
- **WHEN** a plugin calls the open-live-target API while the reference is unpopulated
- **THEN** the call is a no-op that logs a diagnostic identifying the unavailable capability, rather than throwing or appearing to succeed

#### Scenario: Availability is inspectable
- **WHEN** a plugin needs to decide between embedding and a fallback presentation
- **THEN** it can determine whether the capability is currently available, rather than having to attempt the call and infer the outcome

### Requirement: The bridge is scoped to opening a live target only
The system SHALL NOT use this seam to expose general editor-pane dispatch to plugins.

#### Scenario: No general dispatch is exposed
- **WHEN** the bridge is added
- **THEN** it exposes only opening a live-server target, and does not give plugins access to the editor-pane reducer, arbitrary tab kinds, or unrelated split-workspace state
