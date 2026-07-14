---
name: "frontend-mockup-loop-dashboard"
description: "Dashboard-specific adapter on top of the generic frontend-mockup-loop skill/package. Binds the 7-step design loop to pi-agent-dashboard reality: real component sources, theme-system tokens (4 themes), isolated verification for safe preview/promote, and openspec mockup paths. Use when designing/redesigning any pi-agent-dashboard client surface. Triggers: \"design a dashboard screen\", \"mockup a dashboard surface\", \"redesign SessionCard\", \"make dashboard UI consistent\"."
version: 1
created: "2026-06-23"
updated: "2026-06-23"
---
## When to Use
Use when designing or refining any surface in packages/client (or src/client) of pi-agent-dashboard. This is a THIN ADAPTER: the generic loop, tools, and rubric live in the frontend-mockup-loop skill (shipped by @blackbelt-technology/frontend-mockup-loop). Load that first for the full procedure; this skill only supplies the dashboard-specific bindings. Skip for trivial one-class tweaks.

## Procedure
1. LOAD the generic loop first: /skill:frontend-mockup-loop. Follow its 7 steps (GROUND, CONTRACT, MOCKUP, TEST, FIX, PROMOTE, LEARN) and use its tools (serve_mockup, score_mockup, init_ui_contract). The bindings below override only the dashboard-specific details.
2. GROUND binding: read the authoritative component source (e.g. packages/client/src/components/SessionCard.tsx) and capture exact classes (rounded-xl shadow-md border px-4 py-3) + CSS vars (--bg-tertiary #1e1e1e dark / #fff light, --bg-primary #0a0a0a, container #141414). Delegate harvest per the debug-dashboard skill's references/isolated-verification.md.
3. CONTRACT binding: the token authority is the theme-system skill (4 themes: studio, earth, athlete, gradient; CSS custom properties --background/--primary/--radius). ui-contract.md references those vars; new tokens get added to the theme layer first. Per-change scope: write openspec/changes/<name>/mockups/ui-plan.md (surfaces -> tokens -> states).
4. MOCKUP binding: mockups for a proposal go to openspec/changes/<name>/mockups/. Serve live + hand back local + LAN URL; verify dark AND light.
5. PROMOTE binding: NEVER verify against the live :8000 server — it runs MAIN-repo code; worktree edits never load. Use isolated verification (debug-dashboard skill → references/isolated-verification.md: temp HOME, non-8000 ports, PI_DASHBOARD_NO_MDNS=1, openspec poll enabled:false). Confirm live root via lsof -i:8000 before/after; original PID must be unchanged.

## Pitfalls
- Do NOT run pi-dashboard stop in an isolated env — it defaults to port 8000 / pi-port 9999 even under custom HOME and kills the real dashboard via stale-port lsof. Pass explicit --port/--pi-port or kill by pgrep -f 'cli.ts.*--port <N>'.
- Do NOT leave openspec poll enabled during browser QA on this repo (73+ changes) — it starves the WS heartbeat -> blank client + dropped bridge. Set enabled:false in the isolated HOME config first.
- Do NOT trust agent-browser eval on a file:// static page — it can blank the page and the live session-list timer invalidates @e<N> snapshot refs. Prefer clicking the page's own controls.
- Do NOT duplicate the generic procedure here — if a rule is not dashboard-specific, it belongs in the frontend-mockup-loop skill, not this adapter.

## Verification
1. Generic frontend-mockup-loop rubric passes (contrast, responsive, anti-slop) in both themes at 3 breakpoints.
2. ui-contract.md / ui-plan.md values reference theme-system CSS vars, not raw hex.
3. Promote happened in an isolated env on non-8000 ports; lsof -i:8000 still shows the original live server PID unchanged.
4. Mockups landed under openspec/changes/<name>/mockups/.