# custom-event-groups-store.ts — index

Node-side store for `~/.pi/dashboard/custom-event-groups.json`. `CustomEventGroupsStore` — versioned envelope, lazy load, atomic tmp+rename persist, fail-open validation (bad entry skipped, others retained), `seenShippedIds` upgrade-merge, reserved `other` synthesized last. See change: add-custom-event-group-filters.
