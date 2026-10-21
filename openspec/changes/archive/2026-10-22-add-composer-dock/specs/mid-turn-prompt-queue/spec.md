## REMOVED Requirements

### Requirement: Queue panel renders above the chat input
**Reason**: This requirement still describes the v1 queue panel (`Session.queue.pending`, `clear_queue`, `remove_queue_entry`), which the bridge-owned follow-up buffer superseded. Queued follow-ups now render in the composer dock's Queue lane.
**Migration**: See `composer-dock` "Queue lane hosts the follow-up cycler". Its actions send the messages defined here by "Per-entry follow-up mutation mutates ONLY the bridge buffer" (`edit_followup_entry`, `promote_followup_entry`, `remove_followup_entry`, `clear_followup_entries`).
