# notify-channel.spec.ts — index

Playwright spec. Drives `[[faux:notify-probe]]` (→ `e2e_notify` fixture tool → `ctx.ui.notify`) and asserts the notify path end to end: no "Needs you" at rest on a notify-only session (#F8), pinned negative that a genuine `ask_user` still reads "Needs you" (#F9), transcript position (#F3), reload durability + notifyId dedup (#F4/#F5), retained rows on an ended session (#F6). Needs `PI_E2E_SEED=1`. See change: split-notify-from-prompt-request.
