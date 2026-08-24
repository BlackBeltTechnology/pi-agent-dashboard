## ADDED Requirements

### Requirement: Config watchers reconcile incrementally

The automation config watchers SHALL be reconciled against the current set of
automation scopes, not rebuilt wholesale. Reconciliation SHALL detach watchers
whose scope base is no longer present, attach watchers for newly-present scope
bases, and leave every unchanged scope base's watcher handle untouched.

A periodic rescan SHALL NOT by itself cause any watcher to be torn down and
re-established. Watcher churn SHALL be proportional to the change in the scope
set, not to the number of rescan ticks nor to the number of scopes.

#### Scenario: Steady state performs no watcher churn

- **WHEN** the set of automation scopes is unchanged between two rescans
- **THEN** no watcher SHALL be detached and no watcher handle SHALL be re-established

#### Scenario: A new scope is armed

- **WHEN** a scope base is present that has no attached watcher
- **THEN** a watcher SHALL be attached for that scope base
- **AND** watchers for already-attached scope bases SHALL remain attached

#### Scenario: A removed scope is released

- **WHEN** a previously-attached scope base is no longer in the current scope set
- **THEN** its watcher SHALL be detached
- **AND** watchers for scope bases still in the set SHALL remain attached

#### Scenario: A watcher that failed to attach does not block reconciliation

- **WHEN** attaching a watcher for a scope base fails (the automation directory is missing or `fs.watch` throws)
- **THEN** that scope base SHALL degrade to not-attached
- **AND** reconciliation of the remaining scope bases SHALL still complete
