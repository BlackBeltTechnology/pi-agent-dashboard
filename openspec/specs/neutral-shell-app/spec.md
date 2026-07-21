# neutral-shell-app Specification

## Purpose

The neutral shell is a standalone single-page app that composes the operator-facing surface: a persistent header with navigation and a routed main region that switches between a Servers (keyring) view and a Pair view. It runs under hash-based routing and re-mounts the Servers view after a pairing completes so the keyring list refetches.

## Requirements

### Requirement: Hash-routing substrate

The shell SHALL run inside a wouter Router configured with the hash-location hook, mounted under React.StrictMode.

#### Scenario: App renders under a hash Router in StrictMode

- **WHEN** the application boots
- **THEN** the root App is rendered inside a wouter `Router` whose location hook is `useHashLocation`
- **AND** the tree is wrapped in `React.StrictMode`
- **AND** the current route is derived from the URL hash

### Requirement: Root routing between Servers, Pair, and not-found

The shell SHALL render a persistent header with navigation and route the main content between a Servers view, a Pair view, and a not-found fallback based on the hash location.

#### Scenario: Header and navigation are always present

- **WHEN** the app renders at any location
- **THEN** the header displays the title "PI Dashboard Shell"
- **AND** navigation links labelled "Servers" (to `/`) and "Pair" (to `/pair`) remain visible while the routed content changes

#### Scenario: Root location shows the Servers view

- **WHEN** the location is `/`
- **THEN** the main content renders the keyring (Servers) view

#### Scenario: Pair location shows the Pair view

- **WHEN** the location is `/pair`
- **THEN** the main content renders the pairing view

#### Scenario: Unknown location shows not-found

- **WHEN** the location matches neither `/` nor `/pair`
- **THEN** the main content renders a "Not found." message

#### Scenario: Navigation switches views without full reload

- **WHEN** the operator activates the "Servers" or "Pair" navigation link
- **THEN** the hash location changes and the wouter `Switch` swaps the corresponding view into the main content while the header remains mounted

### Requirement: Refresh Servers view after successful pairing

The shell SHALL cause the Servers view to refetch the keyring list after a pairing completes successfully, via a route-driven remount.

#### Scenario: Pairing completion bumps the refresh signal

- **WHEN** the Pair view reports a successful pairing through its `onPaired` callback
- **THEN** the shell increments a `refreshKey` state value passed to the Servers view

#### Scenario: Returning to the Servers route remounts it with the new signal

- **WHEN** the operator navigates from `/pair` back to `/`
- **THEN** the wouter `Switch`—having unmounted the Servers view while `/pair` was active—remounts it
- **AND** the updated `refreshKey` takes effect on that remount so the newly paired server is reflected
