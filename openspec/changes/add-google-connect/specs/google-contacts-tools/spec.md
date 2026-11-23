## Purpose

Agent tools that search, read, create and update Google Contacts of a connected account through Google Connect leases, with confirmed and conflict-guarded writes.

## ADDED Requirements

### Requirement: Contacts read tools
The plugin SHALL provide `gcontacts_search` (by name, email or phone) and `gcontacts_get`, returning resource name, names, email addresses, phone numbers and organisations.

#### Scenario: Find by email
- **WHEN** the agent searches `anna@example.com`
- **THEN** the matching contact is returned with its resource name

### Requirement: Contacts write tools
The plugin SHALL provide `gcontacts_create` and `gcontacts_update`, requiring Contacts at level write. Each SHALL ask the user to confirm, showing account and the changed fields with old and new values. An update based on a stale contact version SHALL fail with `revision_changed`. The plugin SHALL NOT delete contacts. No interactive UI, denial, dismissal or timeout SHALL leave contacts unchanged.

#### Scenario: Concurrent change
- **WHEN** the contact changed after `gcontacts_get` and the agent updates it with the old version
- **THEN** the tool fails with `revision_changed`
