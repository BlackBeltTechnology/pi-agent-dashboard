---
name: frontend-mockup-loop
description: "Plan, build, and iterate UX-friendly frontend mockups via a ground→contract→mockup→test→fix→learn loop, acting as an expert UX designer who grounds every decision in externally documented public design rules (Nielsen heuristics, Laws of UX, WCAG, GOV.UK/USWDS/Material). Uses the bundled serve_mockup, score_mockup, and init_ui_contract tools plus a ui-contract.md design control plane to keep screens consistent. Works in any React/Tailwind/shadcn (or plain HTML) project. Use when designing new screens, adapting existing UI, enforcing cross-screen consistency, or doing a UX review. Triggers: \"design a screen\", \"mockup this UI\", \"wireframe\", \"make the UI consistent\", \"adapt the existing design\", \"improve this layout\", \"UX review\", \"is this good UX\"."
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.3"
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

This skill is paired with an extension that registers five tools:
`serve_mockup`, `score_mockup`, `init_ui_contract`, `list_design_systems`,
`validate_mockup`.

## Select a design system (optional)

The loop runs design-system **agnostic** by default (generic anti-slop rubric).
To target a specific system, pick a preset and pass its id to the tools'
`system` param. v1 presets (`list_design_systems` enumerates them):

| id | system | platform | substrate |
|---|---|---|---|
| `shadcn` | shadcn/ui + Tailwind | web | HTML + Tailwind |
| `mui` | Material UI | web | HTML |
| `material-3` | Material Design 3 | web | HTML |
| `fluent-2` | Fluent 2 | web | HTML |
| `apple-hig` | Apple HIG | iOS | HTML approximation → SwiftUI on promote |

With a system selected: `init_ui_contract{system}` writes that system's DTCG
token contract (from a bundled, offline snapshot; `refresh:true` re-fetches
upstream), `score_mockup{system}` swaps in the system's boolean rubric, and
`validate_mockup{system,dir}` runs the gated pipeline.

### Gate vs advisory

Validation is layered. **Gates** block `pass`; **advisory** layers only score
and drive the fix loop (LLM visual scores skew positive — never hard-block):

- **L1 token-lint** — static; HARD GATE when a linter applies (off-token color
  literals fail shadcn/material-3).
- **L2 a11y floor** — rendered axe + WCAG contrast; HARD GATE, every system.
- **L3 named-system auditor** — `hig-doctor` / `material3-mcp` etc., advisory,
  shelled out only if installed (absent → skipped + noted, never errors).
- **L4 vision rubric** — per-preset boolean checks; `score = pass/N` computed in
  code, advisory.

`validate_mockup` returns `{ gates, advisory, pass }`; `pass` is gate-only.

### Apple HIG in a browser-first loop

Apple publishes no token JSON, so `apple-hig` ships a hand-authored rule pack
(`presets-data/apple-hig/rules.md`). Render an **HTML approximation** of the iOS
screen so `serve_mockup` can serve it and `hig-doctor` (if installed) can audit
it — no SwiftUI/Xcode required in-loop:

- SF Pro stack: `font-family: -apple-system, "SF Pro Text", system-ui`.
- 44×44pt minimum tap targets; 8pt spacing grid.
- Safe areas: `padding: env(safe-area-inset-top) … env(safe-area-inset-bottom)`.
- Bottom tab bar, **≤5 items**; iOS semantic colors (label, systemBackground,
  systemBlue), no hardcoded brand hex on system chrome.

On **PROMOTE**, optionally emit real SwiftUI — validated on source by
`hig-doctor` / `orchard-hig` (no live browser preview; real-device fidelity
needs macOS/Xcode). SwiftUI is never required for the in-loop preview.

## Act as an expert UX designer

**Rule: ground every UX decision in an externally documented, public-facing
design rule — never invent one.** When you make a call, you must be able to name
the rule and cite its public source. "I think it looks better" is not a reason;
"Hick's Law — reduce the choices here (lawsofux.com/hicks-law)" is.

The full citable rule corpus lives in
[`references/ux-best-practices.md`](../../../references/ux-best-practices.md):
Nielsen's 10 heuristics, Laws of UX, Gestalt, cognitive load, per-component
pattern rules, the 5-step expert evaluation protocol, and a 22-item checkable
rubric seed. **Read it before designing or reviewing.**

**Source order (adapt, don't copy):** the selected design system's documented
guidance first → then the universal sources, in licensing-safe order (USWDS is
CC0; GOV.UK is OGL; NN/g + Laws of UX cite-with-attribution; Material/Carbon are
Apache-2.0). Adapt the *principle* to this product; never copy proprietary
assets/text (Apple HIG, Refactoring UI, Mobbin).

**Anti-slop companion (advisory).** For the *AI-tell* layer — the countable
signatures an undirected model defaults to (AI-purple, Inter-everywhere,
em-dashes, div-based fake screenshots, eyebrow-per-section, Jane Doe / Acme
data) — pull the `anti-slop-frontend` skill
(`@blackbelt-technology/anti-slop-frontend`). It is **advisory only**: its tells
feed the FIX step's defect list (step 5), but they NEVER override this loop's
hard gates. When an anti-slop tell conflicts with a cited public rule or the
WCAG-AA / severity-4 floor, the cited rule and the gate win. Apply its Part A
(universal) to any surface; skip its Part B (marketing-only) for product UI.

## When to Use

Designing or refining any frontend surface — new screens, redesigns, or a
consistency pass across existing screens. Skip for trivial one-class tweaks.
Not for backend/protocol work.

## Procedure

### 1. GROUND — adapt what ships + what's documented, don't invent
Two grounds, both external:
- **The real UI** — open the running app and READ the authoritative component
  source. Capture the EXACT tokens already in use: class names, CSS custom
  properties (`--background`, `--primary`, `--radius`), spacing, dark + light.
- **The documented rules** — open `references/ux-best-practices.md` and the
  selected design system's public guidance. Identify the specific patterns and
  laws that govern this surface (e.g. a form → NN/g web-form-design + GOV.UK
  error-summary; a nav → Hick's Law + hamburger-menu guidance).

Designing without either ground produces a parallel style that looks "off" and a
UX that violates well-known rules — the opposite of adapting documented design.

### 2. CONTRACT — the consistency control plane
Read or scaffold `ui-contract.md` (run `init_ui_contract`). It is the single
source of truth for cross-screen properties: color ramps, spacing scale, type
scale, radius, elevation, motion, component invariants. **Every value
references a design token — never a raw hex or px literal.** If a surface needs
a token that doesn't exist, add it to the theme layer first, then cite it in
the contract. This file is what stops screens from drifting apart.

### 3. MOCKUP — live components, mandatory default
**Any mock, mockup, UI-option, variant or redesign request in a project the mock
site can build is a live-component mock — no exceptions by habit.** One page per
`mockups/<yyyy-mm-dd-slug>/mock.tsx` renders the app's REAL components in
Current | Proposed frames, with numbered rings (`Issue` red / `Fix` green) around
the parts that change and a `#ref` link for every page / frame / side / ring /
step. The site inherits the app's own build config (package.json `mockSite`
`{ launcher, config }`, else detected), so no aliases or plugins are copied.
Full guide: `references/live-mock-site.md`.

**Static HTML is a named exception, never a default.** Only (a) a pure geometry
repro, or (b) a project with no buildable components. "No components yet" does
NOT apply when the surface is composed of existing app components. Say which
exception applies whenever you build one; a static board lives in its own
directory with a `STATIC.md` naming the exception, served with `serve_mockup`.

**Fidelity rules — confirm all four before showing a mock:**
- **R1 same surroundings** — both panes render the same shell (frame
  `surroundings`, or bare in both).
- **R2 Current is today** — Current renders the SHIPPED components with today's
  props; never a redraw or copied markup.
- **R3 only ringed parts differ** — anything that differs between panes is ringed.
- **R4 real data** — fixtures follow real record shapes (`mock-capture` records
  them); real product nouns, never placeholder names.

**Behaviour is shown, not described.** When the reviewer must judge an
interaction, give the frame a `script` (click / type / clear / hover / press /
wait on the real DOM, `unless` / `expect` per step) over a fixture factory
(`fixtures`, fresh per pane and loop). Check it with `mock-check <ref> --loops 10`
before showing it.

**Show it with the package tools.** Serve with `serve_mock_site{}` and show the
returned URL to the user (LAN URL only for a phone check) — **not a screenshot**.
Every question to the user about a mock carries the full clickable `#ref` URL of
each page, frame, side, ring or step it concerns (e.g. both rings when asking
the user to pick between two variants). Render dark AND light.

**Decisions are recorded by you, with the CLI.** The site shows decisions
read-only. After the user's verdict in conversation (or your own scored review),
run `mock-decide accept <ref> ["note"]` or `mock-decide reject <ref> "why"` (a
reject always carries a reason) and report what was recorded.

### 4. TEST — run the expert-UX evaluation protocol
Run `score_mockup` to capture full-page screenshots at mobile/tablet/desktop
widths, then apply the **5-step protocol** from `references/ux-best-practices.md`:
1. **Accessibility floor (hard gate)** — contrast 4.5:1, target size, focus
   visible, color-not-sole-channel, reduced-motion.
2. **Heuristic boolean rubric** — the 22-item rubric seed (Nielsen + Laws of UX
   + component rules) scored yes/no; for a user flow, the cognitive-walkthrough
   4 questions per step.
3. **PURE friction** — rate each task step green/yellow/red; worst step wins.
4. **Severity 0–4** per defect (Nielsen scale).
5. **Prioritized fix list** — accessibility-gate first, then severity.

**Score = passed / N, derived in code** — never a subjective "looks good" and
never a free-form float (LLM visual scores skew positive). Each failed check
cites the rule it violates.

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
- `serve_mock_site{dir?, port?, lan?, stop?}` — start the project's
  live-component mock site through the project's own launcher with the
  inherited build config, plus the optional `mockups/mock-site.config.ts`
  options (default port 5299; reserved ports refused; localhost-only unless
  `lan`, and LAN clients are view-only). The result names the launcher and app
  config used.
- CLIs: `mock-decide list|accept|reject|reopen|adoptable|move` (the only writer
  of `decision.json`, `by: "agent"`), `mock-capture <url> <mockDir>` (HTTP →
  redacted `fixtures.har.json`; refuses on a surviving secret),
  `mock-check <ref> [--loops N]` (headless script loops, default 3, non-zero on
  a failed loop), `mock-video <ref> [--out f.webm]` (one loop; default under the
  project's build cache).
- `score_mockup{url, widths?, outDir?, system?}` — Playwright breakpoint screenshots +
  scoring rubric. Chromium is declared in this package's `pi.tools` (optional
  `pw-browser` probe). When Playwright's pinned build is missing it tries the
  cached builds, newest first; none launches → install guidance
  (`npx playwright install chromium`).
- `init_ui_contract{path?, force?, system?, refresh?}` — scaffold the
  token-referencing contract. With `system`, write that preset's DTCG contract
  (offline snapshot; `refresh` re-fetches upstream first). No `system` →
  generic blank template (unchanged).
- `list_design_systems{}` — enumerate the preset registry (id, label, platform,
  substrate, validators).
- `validate_mockup{system, url?, dir?}` — run L1+L2 (gates) + L3+L4 (advisory);
  returns `{ gates, advisory, pass }`. Pass `dir` so L1/L2 can scan the source.

## Pitfalls

- Live mock site: decisions are per PAGE (never per frame), recorded only with
  `mock-decide`; a reject needs a reason. Unfixtured requests show under
  "Missing fixtures": add a fixture, never a live backend. A ring adds one wrapper element — use `block` for grid/flex children,
  and know that `>` / `first:` / `space-x-*` selectors can shift. App overlays
  portaled to `document.body` escape pane containment: render dialogs inline. A
  rejected mock is revised and reopened, or deleted together with its
  `mockups/AGENTS.md` row.

- Do NOT verify against a live/production server — isolate the env so mockup
  edits actually load.
- Do NOT put raw hex/px in the contract or mockups; reference tokens, else
  consistency erodes the moment a theme changes.
- Do NOT skip GROUND — parallel styling looks "off" next to shipped screens.
- Do NOT hand back screenshots for HUMAN review when a live URL is possible.
  Screenshots are for the AGENT's scoring step; live URLs are for the human.
- Do NOT let "make it nicer" be the instruction to yourself — score against the
  named rubric.
- Do NOT invent a UX rule or justify a decision by taste alone — cite an
  external documented public source (see `references/ux-best-practices.md`).
- Do NOT block "pass" on advisory taste while a WCAG-AA or severity-4 defect
  remains — the accessibility floor is the hard gate.

## Verification

- `ui-contract.md` exists; every value references a token; the new surface's
  tokens appear in it.
- A live mockup URL (local + LAN) was handed back and renders in BOTH themes at
  mobile/tablet/desktop.
- A written rubric passes — not a subjective "looks good".
- Every UX decision traces to a cited external rule (heuristic / law / pattern /
  WCAG criterion), not taste.
- The accessibility floor passes (no WCAG-AA or severity-4 defect open).
- If promoted: components were verified in an isolated env; production was left
  untouched.
- Durable learnings were recorded so the loop compounds.
