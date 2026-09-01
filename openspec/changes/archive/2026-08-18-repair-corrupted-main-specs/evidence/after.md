# Repair evidence — before / after

Baseline failing capabilities: 80
Failing capabilities now:      0

Specs in tree now: 544 (was 546; -1 event-persistence deleted, -1 extension-ui-forwarding deleted)
Requirement blocks now visible to the parser: 3706

Recovered: 384 requirement blocks that the parser could not reach before.

Dispositions:
- 79 specs structurally repaired by scripts/repair-main-specs.mjs
- 71 Purposes authored (70 + pending-prompt-safety); zero TODO(repair) remain
- 2 tombstoned: openspec-polling, session-history-sync
- 2 deleted: event-persistence (9 of 9 retired), extension-ui-forwarding (0 bytes since initial commit)
- 1 requirement re-worded for SHALL compliance: chat-refresh (scope exception)
