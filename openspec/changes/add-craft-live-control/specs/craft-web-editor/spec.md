# Spec Delta

## ADDED Requirements

### Requirement: Control requests reach the app only through its declared transport
For an app enabled for live control, the plugin MAY send control requests into the opened frame, bound to that frame instance like every host message. The frame SHALL pass them only to the transport the app's profile declares, and SHALL answer unsupported when none is declared. Live control SHALL NOT relax the frame isolation, the content security policy, the tab's-file-only rule or the save path.

#### Scenario: Isolation unchanged under live control
- **WHEN** VectorCraft is open with live control enabled and code inside the frame attempts `fetch("https://example.com")`
- **THEN** the browser still blocks it under the frame's content security policy

#### Scenario: Request for an app without a transport
- **WHEN** a control request reaches the frame of an app whose profile declares no control transport
- **THEN** the frame answers unsupported and the document is unchanged
