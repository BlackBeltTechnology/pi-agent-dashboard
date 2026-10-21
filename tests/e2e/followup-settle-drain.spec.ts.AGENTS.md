# followup-settle-drain.spec.ts — index

Playwright L3 spec. Spawns a session, streams `[[faux:slow-stream]]`, POSTs `/api/session/:id/prompt` `follow-1` mid-stream. F1: chip shows, queue panel clears, exactly one `follow-1` bubble. F2: bubble sits below the assistant text in DOM order. Pins the `agent_settled` drain trigger end to end. Exemplar `followup-image-queue.spec.ts` (that spec is quarantined under #683). See change: update-pi-core-1-3-adopt-apis (test-plan #F1, #F2).

add-composer-dock: postFollowUp now opens the dock Queue lane (`expandQueueLane`) so chips render. See change: add-composer-dock.
