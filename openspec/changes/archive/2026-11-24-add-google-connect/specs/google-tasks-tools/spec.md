## Purpose

Agent tools that read and change Google Tasks of a connected account through Google Connect leases, with every change confirmed.

## ADDED Requirements

### Requirement: Tasks read tools
The plugin SHALL provide `gtasks_lists` and `gtasks_list` (tasks of a list, optionally including completed ones) returning id, title, notes, due date, status and parent.

#### Scenario: Open tasks
- **WHEN** the agent calls `gtasks_list` without including completed tasks
- **THEN** only tasks with status `needsAction` are returned

### Requirement: Tasks write tools
The plugin SHALL provide `gtasks_create`, `gtasks_update`, `gtasks_complete` and `gtasks_delete`, requiring Tasks at level write. Each SHALL ask the user to confirm, showing account, list, title and due date. No interactive UI, denial, dismissal or timeout SHALL leave the tasks unchanged.

#### Scenario: Denied delete
- **WHEN** the user denies `gtasks_delete`
- **THEN** the task still exists
