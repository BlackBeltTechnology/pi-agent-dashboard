# chat-refresh Specification

## Purpose

Gives the user an explicit way to re-fetch a session's full event history when the live stream has drifted or a reconnect left the chat incomplete. Defines the refresh affordance on both desktop and mobile, and requires it to reset local state and re-subscribe from sequence zero rather than patching the existing view.

## Requirements

### Requirement: Refresh button in session header

A refresh icon button SHALL be displayed in the session header, re-fetching all events for the current session when activated.

#### Scenario: Desktop refresh button visible
- **WHEN** a session is selected on desktop
- **THEN** a refresh icon button appears in the session header after the duration badge

#### Scenario: Click refresh clears and re-subscribes
- **WHEN** the user clicks the refresh button
- **THEN** the local session state is reset to initial state
- **AND** a subscribe message with `lastSeq: 0` is sent to the server
- **AND** the chat view repopulates with replayed events

#### Scenario: Loading indicator while refreshing
- **WHEN** the refresh button is clicked
- **THEN** the icon spins briefly to indicate loading

#### Scenario: Mobile refresh via action menu
- **WHEN** a session is selected on mobile
- **THEN** a "Refresh Chat" option appears in the MobileActionMenu
- **AND** clicking it triggers the same refresh behavior
