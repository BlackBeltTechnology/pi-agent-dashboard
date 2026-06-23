---
name: frontend-mockup-loop
description: Plan, build, and iterate UX-friendly frontend mockups via a ground→contract→mockup→test→fix→learn loop. Uses the bundled serve_mockup, score_mockup, and init_ui_contract tools plus a ui-contract.md design control plane to keep screens consistent. Works in any React/Tailwind/shadcn (or plain HTML) project. Use when designing new screens, adapting existing UI, or enforcing cross-screen visual consistency. Triggers: "design a screen", "mockup this UI", "wireframe", "make the UI consistent", "adapt the existing design", "improve this layout".
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.1"
---

# frontend-mockup-loop

A disciplined loop for designing frontend surfaces. It exists to defeat
**distributional convergence**: an undirected agent regresses to the
statistical mean of its training data — generic Inter font, a purple gradient,
a centered hero. "Make it look better" just returns the average again.

The fix the whole agentic-design field converged on, and what this loop
enforces every time:

1. **deliberate direction** from a real reference (GROUND),
2. a **consistent token system** (the ui-contract),
3. a **screenshot feedback loop** (eyes on output).

This skill is paired with an extension that registers three tools:
`serve_mockup`, `score_mockup`, `init_ui_contract`.

## When to Use

Designing or refining any frontend surface — new screens, redesigns, or a
consistency pass across existing screens. Skip for trivial one-class tweaks.
Not for backend/protocol work.

## Procedure

### 1. GROUND — adapt what ships, don't invent
Open the running app and READ the authoritative component source. Capture the
EXACT tokens already in use: class names, CSS custom properties
(`--background`, `--primary`, `--radius`), spacing, dark + light values.
Designing without reading the real component produces a parallel style that
looks "off" next to shipped screens — the opposite of adapting existing design.

### 2. CONTRACT — the consistency control plane
Read or scaffold `ui-contract.md` (run `init_ui_contract`). It is the single
source of truth for cross-screen properties: color ramps, spacing scale, type
scale, radius, elevation, motion, component invariants. **Every value
references a design token — never a raw hex or px literal.** If a surface needs
a token that doesn't exist, add it to the theme layer first, then cite it in
the contract. This file is what stops screens from drifting apart.

### 3. MOCKUP — diverge in HTML, serve it live
Build standalone HTML/Tailwind mockups grounded in steps 1–2. Serve them with
`serve_mockup` and hand back the clickable **local + LAN URL** (the LAN URL
opens on a phone) — **not a screenshot** — so the human reacts to a real page.
Render dark AND light.

### 4. TEST — eyes + an explicit checklist
Run `score_mockup` to capture full-page screenshots at mobile/tablet/desktop
widths. Read each PNG and fill the rubric (contrast, responsive, hierarchy,
spacing, token fidelity, anti-slop, console). Write the score — never a
subjective "looks good".

### 5. FIX — one criterion at a time
Apply the top failing item, re-serve, re-score. Loop 3–5 until every rubric
line passes in both themes at all three breakpoints.

### 6. PROMOTE — close the apply-gap
Translate the approved HTML direction into real React/shadcn components.
Do this in an ISOLATED environment (temp workspace, non-production ports),
never against a live server. Map the mockup's tokens 1:1 so shipped code
matches the approved mockup with zero drift.

### 7. LEARN — compound across runs
Record durable taste decisions so the next run starts smarter: stable rules →
agent memory; repo design rules → patch `ui-contract.md`; one-off rationale →
the change's notes.

## Tools (bundled by the extension)

- `serve_mockup{dir, port?, stop?}` — Node static server on 0.0.0.0; returns
  local + LAN URLs. Zero external deps.
- `score_mockup{url, widths?, outDir?}` — Playwright breakpoint screenshots +
  scoring rubric. Falls back to install guidance if Playwright is absent
  (`npm i -D playwright && npx playwright install chromium`).
- `init_ui_contract{path?, force?}` — scaffold the token-referencing contract.

## Pitfalls

- Do NOT verify against a live/production server — isolate the env so mockup
  edits actually load.
- Do NOT put raw hex/px in the contract or mockups; reference tokens, else
  consistency erodes the moment a theme changes.
- Do NOT skip GROUND — parallel styling looks "off" next to shipped screens.
- Do NOT hand back screenshots for HUMAN review when a live URL is possible.
  Screenshots are for the AGENT's scoring step; live URLs are for the human.
- Do NOT let "make it nicer" be the instruction to yourself — score against the
  named rubric.

## Verification

- `ui-contract.md` exists; every value references a token; the new surface's
  tokens appear in it.
- A live mockup URL (local + LAN) was handed back and renders in BOTH themes at
  mobile/tablet/desktop.
- A written rubric passes — not a subjective "looks good".
- If promoted: components were verified in an isolated env; production was left
  untouched.
- Durable learnings were recorded so the loop compounds.
