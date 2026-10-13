# Audit — retro-ux-chat-rendering

Method: `retro-ux-identity-connectivity` design D4. Board: `chat-rendering.html` (18 states: mermaid 9 incl. 4 pending AI states, web search 6, custom entry 3), rows shown in chat context. Findings M1–M6, W1–W6, C1, X1–X2: `ui-plan.md`.

## Measured — repo probes on the board

`tests/e2e/helpers/computed-contrast.ts` probes, Playwright at 1440 px, every state's frame. Diagram SVG internals excluded (themed by `mermaid-config.ts` in the product).

| Column | base dark | base light | nord dark | Total |
|---|---|---|---|---|
| As-built replica | 30 | 46 | 37 | **113** |
| Proposed | 0 | 0 | 0 | **0** |

As-built by surface (summed over themes): web search 56 contrast + 12 size (`--text-muted` meta and summary, cyan links, red errors); mermaid 18 contrast + 24 size (loading text, red error heading, 10 px zoom readout); custom entry 3 contrast.

## Found while building the proposed version

| # | Finding | Resolution |
|---|---|---|
| B1 | link text (11 px) and the header time (11 px) sit inside interactive elements → 12 px interactive floor | links and header time at 12 px |
| B2 | the AI-repair change (`add-mermaid-ai-repair`, 0/47 tasks) specifies five UI states and has no mockup | its states are designed on this board (M6); the change should adopt them |

## Not measured

- Diagram-internal contrast (edge labels on node fills) — depends on `mermaid-config.ts` theme variables, not on these components.
- `ZoomControls` lives in `client-utils` and is shared with other zoomable previews; M4/M5 touch it.
- Mermaid fallback literals: measured separately (see Approval record, D2). They never paint in any of the 18 palette modes.

## Verdicts

See `ui-plan.md` § Verdicts. Decisions needing approval: M1–M6, W1–W6, C1, X1 (row alignment changes every unclaimed and web-search row).

## Approval record

2026-10-12, via `ask_user`. All 8 decisions approved:
1. Mermaid error as an error-severity callout (headline, parser message, Copy source) and a loading spinner with `role="status"` (M1, M2).
2. Repair badge: "Auto-fixed" pill plus human-readable rule descriptions; named Show original / Copy fixed (M3).
3. Keyboard zoom: focusable viewport (Enter to zoom, Escape to leave), focus ring, named 32 px zoom buttons in the shared `ZoomControls` (M4, M5). Doubt-review cycle 1 aligned the size to the contract's icon-only tap-target: 32 px is the size from `sm` up (as approved), 44 px below `sm` (`ui-contract.md:109`).
4. Fix-with-AI states as designed; `add-mermaid-ai-repair` adopts this board as its mockup (M6).
5. Web search: neutral icon, underlined links with external icon, error pills, "· N failed" in the summary, evicted as a warning notice, plural fix (W1–W6).
6. Custom entry fallback: neutral type label plus "extension entry" meta (C1).
7. Custom and web-search rows aligned with the tool timeline (X1).
8. Baseline: palette classes and `--text-muted` information text moved to tokens; 12 px text inside buttons and links (X2, W3).

Doubt-review cycle 2 follow-ups (user, via `ask_user`): web-search links use `--link` rather than `--text-primary` (contract link row, matches markdown links); Escape returns focus to the diagram viewport. Board corrected to the spec: the original view shows the original render error; each repaired rule is its own `mermaid-repair-rule` element with `data-rule`; zoom buttons carry `title`. Re-probed: proposed 0 failures in all three themes, as-built 113.

Design D2 (mermaid colour fallbacks): option A, keep them as a documented jsdom-only exception plus a guard test. Measurement: all 18 palette modes define the six accents and `--text-primary` as `#hex`, so the fallbacks never paint in the browser.

## As-built reconciliation (implementation, 2026-10-13)

`mockups/after/{mermaid,web-search,custom-entry}/` hold the real-render screenshots (`captureStates`, 3 themes × 3 widths) and the L3 probe matrix passes with 0 contrast, size and focus failures (spec `retro-ux-chat-rendering.spec.ts` G1–G3). Differences from the board, all deliberate:

- Evicted payload: the host passes the plugin only a reason string, so the warning notice reads "Full details are not available (<reason>). Showing the summary that was saved with the chat." rather than naming eviction specifically.
- The show-original view uses the headline "Original render error" and no Copy button (the Copy fixed button is in the badge row).
- Measured probe roots: the callout's `<strong>`/`<code>` are not elements the repo's `measureText` selects; the `original` and `zoomed` states therefore probe the badge row and the zoom controls with the percentage readout.
- `ai-*` states are not built (`add-mermaid-ai-repair` has not landed, task 0.2); the callout they sit in is.
- Found by the L3 run: after Escape the zoom buttons unmount and drop focus to `<body>`; focus is now restored to the viewport in an effect after the state commit.
