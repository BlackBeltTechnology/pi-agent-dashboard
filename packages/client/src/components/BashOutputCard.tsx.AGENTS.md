# BashOutputCard.tsx — index

Renders `!`/`!!`/slash-exec bash output card (command header, exit badge, output pre). Footer "ℹ ran locally — LLM not invoked" when `source === "slash-exec"`; absent for `!`/`!!`. See change: add-dashboard-slash-commands. Mirrors "Show full output"/"Collapse" affordance; client-side last-200-line toggle (full output already in state). See change: adopt-pi-071-072-073-features.
