# pin-does-not-resurrect-archived.spec.ts — index

L3 (test-plan #F4): seeds 2 archived + 1 resident sidecar in `/root/proj-x` via Docker exec, restarts, pins via bus `pin_directory`; asserts `Archive (2)` fold, archived ids absent from `/api/sessions` + cards, present in `/api/sessions/archived`. See change: fix-discovery-resurrects-archived.
