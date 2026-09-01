# session-reload-on-package-change Specification

## Purpose

Reloads all connected sessions after a package install, update, or removal, so no session keeps running against code that is no longer on disk.

## Requirements

### Requirement: Auto-reload all sessions after package operations
After any successful package install, remove, or update operation, the server SHALL send `/reload` to all connected active pi sessions via the existing `send_prompt` mechanism. This ensures sessions pick up the new/removed extensions, skills, and prompts.

#### Scenario: Reload after install
- **WHEN** a package install completes successfully
- **THEN** the server sends `/reload` to every connected session with a non-ended status

#### Scenario: No reload on failure
- **WHEN** a package install fails
- **THEN** no reload is sent to sessions

#### Scenario: Browser notified of reload
- **WHEN** sessions are reloaded after a package change
- **THEN** browser clients receive a `package_operation_complete` message indicating the operation type and that sessions were reloaded
