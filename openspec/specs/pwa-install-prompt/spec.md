# pwa-install-prompt Specification

## Purpose

Lets the dashboard offer itself for installation as a PWA. Defines the `useInstallPrompt` hook — capturing the browser install event, detecting standalone mode, detecting iOS where no event exists — and the two surfaces it drives: a sidebar install button and a mobile install banner.

## Requirements

### Requirement: useInstallPrompt hook captures browser install event
The client SHALL provide a `useInstallPrompt` hook that listens for the `beforeinstallprompt` event, defers it, and exposes a `prompt()` function to trigger installation.

#### Scenario: Browser fires beforeinstallprompt
- **WHEN** the browser fires the `beforeinstallprompt` event
- **THEN** the hook SHALL prevent the default browser mini-infobar and store the event for later use
- **THEN** `canInstall` SHALL be `true`

#### Scenario: User triggers prompt
- **WHEN** `prompt()` is called on the hook
- **THEN** the deferred `beforeinstallprompt` event SHALL be invoked
- **THEN** after the user accepts or dismisses, `canInstall` SHALL be set to `false`

#### Scenario: Browser does not support beforeinstallprompt
- **WHEN** the browser never fires `beforeinstallprompt`
- **THEN** `canInstall` SHALL remain `false`

### Requirement: useInstallPrompt detects standalone mode
The hook SHALL detect when the app is already running in standalone mode (installed).

#### Scenario: App is installed and running standalone
- **WHEN** `display-mode: standalone` matches via `matchMedia`
- **THEN** `isInstalled` SHALL be `true`

#### Scenario: App is running in browser tab
- **WHEN** `display-mode: standalone` does not match
- **THEN** `isInstalled` SHALL be `false`

### Requirement: useInstallPrompt detects iOS
The hook SHALL detect iOS Safari where `beforeinstallprompt` is not available.

#### Scenario: Running on iOS Safari
- **WHEN** the user agent indicates iOS and the browser is not standalone
- **THEN** `isIOS` SHALL be `true`

#### Scenario: Running on non-iOS browser
- **WHEN** the user agent does not indicate iOS
- **THEN** `isIOS` SHALL be `false`

### Requirement: Sidebar install button
The sidebar icon row SHALL include an install button next to the existing Tunnel and Settings icons.

#### Scenario: Install is available
- **WHEN** `canInstall` is `true` from the hook
- **THEN** the sidebar SHALL display an install button with an appropriate icon
- **THEN** clicking the button SHALL call `prompt()` from the hook

#### Scenario: Install is not available
- **WHEN** `canInstall` is `false` and `isIOS` is `false`
- **THEN** the install button SHALL NOT be rendered

#### Scenario: App is already installed
- **WHEN** `isInstalled` is `true`
- **THEN** the install button SHALL NOT be rendered

### Requirement: Mobile install banner
The client SHALL display a dismissible banner on mobile viewports prompting installation.

#### Scenario: Chromium mobile with install available
- **WHEN** viewport is mobile-sized and `canInstall` is `true` and banner has not been dismissed
- **THEN** a banner SHALL appear with an "Install" button that calls `prompt()`

#### Scenario: iOS mobile
- **WHEN** viewport is mobile-sized and `isIOS` is `true` and banner has not been dismissed
- **THEN** a banner SHALL appear with instructions: tap Share icon then "Add to Home Screen"

#### Scenario: Banner dismissal
- **WHEN** the user dismisses the banner
- **THEN** the banner SHALL not appear again (persisted via `localStorage` key `pwa-install-dismissed`)

#### Scenario: Already installed
- **WHEN** `isInstalled` is `true`
- **THEN** the banner SHALL NOT be rendered regardless of dismissal state

#### Scenario: No install capability and not iOS
- **WHEN** `canInstall` is `false` and `isIOS` is `false`
- **THEN** the banner SHALL NOT be rendered
