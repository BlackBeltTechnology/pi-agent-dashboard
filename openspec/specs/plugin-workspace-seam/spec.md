# plugin-workspace-seam Specification

## Purpose
Lets a server plugin observe the dashboard's workspaces. Workspaces are today mutated only by browser WebSocket verbs and exposed on no plugin-facing surface, so any plugin whose model is keyed on a workspace is currently unimplementable. Read-only by construction: the seam adds no way to change a workspace.

## Requirements

### Requirement: Plugins can read the current workspaces
The plugin server context SHALL expose an accessor returning the dashboard's current workspaces, each with its identifier, display name, and member folder paths.

#### Scenario: Plugin reads workspaces at activation
- **WHEN** a plugin calls the accessor during activation
- **THEN** it receives every configured workspace with its id, name, and folders

#### Scenario: No workspaces configured
- **WHEN** the dashboard has no workspaces
- **THEN** the accessor returns an empty collection rather than failing

### Requirement: The accessor cannot be used to mutate host state
The value returned SHALL NOT permit a plugin to alter the host's stored workspaces. The seam SHALL expose no create, rename, delete, or folder-assignment operation.

#### Scenario: Plugin mutates the returned value
- **WHEN** a plugin modifies the collection it received
- **THEN** the dashboard's stored workspaces are unchanged
- **AND** a subsequent call returns the host's unmodified state

### Requirement: Plugins can subscribe to workspace changes
The plugin server context SHALL expose a subscription that notifies subscribers when the host's stored workspaces are mutated, and SHALL return a means to unsubscribe. The notification SHALL be a hint to re-read rather than a description of the change: it MAY coalesce multiple mutations and MAY fire for a mutation the subscriber does not care about, so a subscriber SHALL re-read and reconcile idempotently. Notification SHALL be driven by the store that owns the mutation, not by any single transport's broadcast.

#### Scenario: Workspace renamed
- **WHEN** a workspace is renamed
- **THEN** every subscribed plugin is notified

#### Scenario: Mutation that does not reach a browser client
- **WHEN** a workspace is mutated through a path that performs no client broadcast
- **THEN** subscribers are still notified

#### Scenario: Notification carries no diff
- **WHEN** a subscriber is notified
- **THEN** it can obtain the current state only by re-reading the accessor

#### Scenario: Folder moved between workspaces
- **WHEN** a folder's workspace membership changes
- **THEN** every subscribed plugin is notified

### Requirement: Every workspace mutator notifies
Notification SHALL be wired to every mutator the workspace store exposes, not to a subset. A mutator that does not notify SHALL be treated as a defect, and adding a new mutator without notification SHALL be detectable rather than silent.

#### Scenario: Each existing mutator fires
- **WHEN** each workspace mutator the store exposes is invoked in turn
- **THEN** a subscriber is notified for every one of them

#### Scenario: Newly added mutator
- **WHEN** a workspace mutator is added to the store without wiring notification
- **THEN** a test fails rather than the seam silently missing that mutation

#### Scenario: Plugin unsubscribes
- **WHEN** a plugin calls the returned unsubscribe function and a workspace then changes
- **THEN** that plugin's handler is not invoked

### Requirement: A failing subscriber cannot affect the host or other subscribers
A handler that throws SHALL NOT prevent other subscribers from being notified and SHALL NOT fail the workspace operation that triggered the notification.

#### Scenario: One handler throws
- **WHEN** one subscribed handler throws and another is registered
- **THEN** the other handler is still invoked
- **AND** the workspace change is persisted normally

### Requirement: The seam is additive for existing plugins
Adding the seam SHALL NOT change the shape or behaviour of any existing server-context member, and a plugin that does not use it SHALL require no modification.

#### Scenario: Existing plugin loaded unchanged
- **WHEN** a plugin written before the seam existed is loaded
- **THEN** it activates and behaves exactly as before
