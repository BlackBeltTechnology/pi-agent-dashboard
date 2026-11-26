# rich-links-flush.spec.ts — index

Playwright E2E for the link-resolution flush rate (change: rich-chat-links, test-plan P3). Scenario `rich-links-flush`: 30 finalized bash results × 20 file mentions + one still-running `sleep 90` tool whose streamed mentions stay `unknown`. Scrolls the transcript top→bottom over ~10 s (100 ms steps, expanding mounted results) and asserts ≤1 `POST /api/file/resolve-mentions` per 1 s window, total ≤ windows, none carrying `rl-flush/running-*`.
