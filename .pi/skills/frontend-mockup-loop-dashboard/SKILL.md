---
name: "frontend-mockup-loop-dashboard"
description: 'Dashboard-specific adapter on the generic frontend-mockup-loop skill: binds the 7-step design loop to pi-agent-dashboard component sources, theme-system tokens, and isolated verification. Use when designing/redesigning any pi-agent-dashboard client surface. Triggers: "design a dashboard screen", "mockup a dashboard surface", "redesign SessionCard", "make dashboard UI consistent".'
version: 1
created: "2026-06-23"
updated: "2026-10-09"
---
## When to Use
Use when designing or refining any surface in packages/client (or src/client) of pi-agent-dashboard. This is a THIN ADAPTER: the generic loop, tools, and rubric live in the frontend-mockup-loop skill (shipped by @blackbelt-technology/frontend-mockup-loop). Load that first for the full procedure; this skill only supplies the dashboard-specific bindings. Skip for trivial one-class tweaks.

## Procedure
1. LOAD the generic loop first: /skill:frontend-mockup-loop. Follow its 7 steps (GROUND, CONTRACT, MOCKUP, TEST, FIX, PROMOTE, LEARN) and use its tools (serve_mockup, score_mockup, init_ui_contract). The bindings below override only the dashboard-specific details.
   ANTI-SLOP binding (packages/anti-slop suite): Design Read profile is always `product-ui`; redesign mode `preserve` (anti-slop-redesign: audit first, protected list incl. `data-testid` + keyboard shortcuts); image direction is off for every dashboard surface (never run anti-slop-image-direction or anti-slop-brandkit here). Part B and layout discipline do not apply.
2. GROUND binding: read the authoritative component source (e.g. packages/client/src/components/SessionCard.tsx) and capture exact classes (rounded-xl shadow-md border px-4 py-3) + CSS vars (--bg-tertiary #1e1e1e dark / #fff light, --bg-primary #0a0a0a, container #141414). Delegate harvest per the debug-dashboard skill's references/isolated-verification.md.
3. CONTRACT binding: read root ui-contract.md for every design fact (token roles, severity/tint/status families, type/spacing scale, WCAG invariants, theme layers). Token definitions live in packages/client/src/index.css (base dark/light); 8 more palettes x dark/light are runtime overrides from packages/client/src/lib/theme/themes.ts. New tokens get added to the theme layer first, then cited in ui-contract.md. Per-change scope: write openspec/changes/<name>/mockups/ui-plan.md (surfaces -> tokens -> states).
4. MOCKUP binding: change exists -> mockups go to openspec/changes/<name>/mockups/ (no marker row). No change yet (explore mode) -> write mockups/<slug>/ (or a single mockups/<name>.html) and add a mockups/AGENTS.md row whose Purpose cell ends exactly `Pending change: <intent>` right before the closing ` |` — spelling and casing exact, intent a short human hint with no | and no backticks. The marker makes it adoptable: openspec/config.yaml rules.proposal and plan-proposal Step 1b move it into the change when its proposal is created. Mockups not meant for a change get no marker. Serve live + hand back local + LAN URL; verify dark AND light.
5. PROMOTE binding: NEVER verify against the live :8000 server — it runs MAIN-repo code; worktree edits never load. Use isolated verification (debug-dashboard skill → references/isolated-verification.md: temp HOME, non-8000 ports, PI_DASHBOARD_NO_MDNS=1, openspec poll enabled:false). Confirm live root via lsof -i:8000 before/after; original PID must be unchanged.

## Pitfalls
- In an isolated env pass explicit `--port/--pi-port` to `pi-dashboard stop` (it honors them and kills only listeners that HOME owns; never use `--force`, never copy `server.pid`/`server.lock*`/`instances/` from the real HOME). Or kill by pgrep -f 'cli.ts.*--port <N>'.
- Do NOT leave openspec poll enabled during browser QA on this repo (73+ changes) — it starves the WS heartbeat -> blank client + dropped bridge. Set enabled:false in the isolated HOME config first.
- Do NOT trust agent-browser eval on a file:// static page — it can blank the page and the live session-list timer invalidates @e<N> snapshot refs. Prefer clicking the page's own controls.
- Do NOT duplicate the generic procedure here — if a rule is not dashboard-specific, it belongs in the frontend-mockup-loop skill, not this adapter.

## Verification
1. Generic frontend-mockup-loop rubric passes (contrast, responsive, anti-slop) in both themes at 3 breakpoints.
2. ui-contract.md / ui-plan.md values reference index.css tokens, not raw hex.
3. Theme parity (anti-slop-frontend T1-T3): zero added raw colour literals in the diff (index.css + themes.ts excluded); `node scripts/theme-token-guard.mjs` reports no new violation; screenshots exist for Base dark, Base light and one non-`base` palette from themes.ts. Visual judgment of them is a non-gating note.
4. Promote happened in an isolated env on non-8000 ports; lsof -i:8000 still shows the original live server PID unchanged.
5. Mockups landed under openspec/changes/<name>/mockups/, or (no change yet) under mockups/ with a `Pending change: <intent>` row.