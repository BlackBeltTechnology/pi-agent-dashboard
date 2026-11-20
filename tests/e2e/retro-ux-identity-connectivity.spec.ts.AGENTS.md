# retro-ux-identity-connectivity.spec.ts — index

L3 E13/E14/F6–F9: Users, impact note, server selector, known servers, discovery pass the contract probes (contrast/size/focus) in every fixture state × 3 themes × 3 widths via `captureStates`; Users target sizes; `--focus-ring` outline; `RETRO_UX_CAPTURE=1` writes `mockups/after/`. See change: retro-ux-identity-connectivity. Fixtures: `fixtures/retro-ux/`; helper: `helpers/ui-capture.ts`. `RETRO_UX_ONLY=id[,id]` narrows E13 to named states (debugging).

Summary (moved from directory AGENTS.md row): L3 retro-ux probes.

Report-lane member (partial): E13 `server-selector` / `known-servers`, F6, both F12, F8 call `skipOnEnforcingCsp` (`REPORT_LANE_SKIP`) — the browser proves known addresses cross-origin via `page.route` stubs, which enforcing `connect-src` refuses. Users / discovery tests stay on the default lane. See change: enforce-strict-csp-default.
