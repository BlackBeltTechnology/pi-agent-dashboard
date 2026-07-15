# UX Review — Directory Home Page

Mockup: `openspec/changes/add-directory-home-page/mockups/index.html` (live via
`serve_mockup`; toggles for state × theme). Grounded in real tokens
(`packages/client/src/index.css`) and the `CommandInput` / `LandingPage` idioms.

Reviewed states: **empty**, **populated**, **sending (spawn in flight)**,
**not-pinned**, **cold-load** — in **dark + light**.

---

## 1. Accessibility floor (hard gate)

| Check | Verdict | Note |
|---|---|---|
| Contrast — dark | **PASS** | `--text-primary` on `--bg-primary` ≈ 17:1; starter chips `--text-secondary` ≈ 8:1; status badges carry text + tinted bg. |
| Contrast — light | **PASS (1 watch)** | `--text-tertiary` `#777` on `#fff` ≈ 4.48:1 — a hair under AA 4.5 for the path/meta text. This is an **inherited app token**, not introduced here; on promote prefer `--text-secondary` for the folder path. |
| Target size | **PASS** | Send is 44×44 (Fitts). Quick-action links padded to ≥24px. The sidebar chevron/open glyphs are small but are **desktop-hover** affordances; on mobile `MobileShell` owns nav (sidebar hidden < 480px). |
| Focus visible | **PASS** | `:focus-visible` ring uses `--focus-ring`. |
| Color not sole channel | **PASS** | Session status shows a **text badge** (working/idle/needs you), not color alone, in the content pane. |
| Reduced motion | **PASS** | Spinner + skeleton gated behind `prefers-reduced-motion` (mirrors the app's `motion-reduce:animate-none`). |

No open WCAG-AA / severity-4 defect → **gate passes**.

## 2. Heuristic rubric (Nielsen + Laws of UX)

| Rule (cited) | Verdict | Where |
|---|---|---|
| **Von Restorff / Nielsen #8 aesthetic-minimalist** — one isolated focal action | **PASS** | Empty state: a single centered composer is the only focal element. |
| **Jakob's Law** — match known conventions | **PASS** | Chat-first "type here to start" mirrors ChatGPT/Claude empty-state — the feature's whole intent. |
| **Fitts's Law** — big, reachable primary CTA | **PASS** | 44×44 send; composer spans the column. |
| **Hick's Law** — limit choices at the decision point | **PASS** | Empty state = composer + 3 optional starters; no competing CTAs. |
| **Nielsen #1 visibility of status + Doherty (<400ms)** | **PASS** | Sending state disables the field, swaps a spinner, and says "Opening session…". |
| **Nielsen #6 recognition > recall** | **PASS** | Persistent folder-name + path header; placeholder is a hint, not the only label. |
| **Nielsen #3/#9 user control + error recovery** | **PASS** | Not-pinned state states cause in plain language + a "Pin this folder…" CTA (a marked exit). |
| **Gestalt common-region / proximity** | **PASS** | Session list is a bordered group; quick actions cluster top-right; within-group spacing < between-group. |
| **Progressive disclosure** | **PASS** | Prompt is the centered focal point when empty; docks to the top with the session list below once the folder is populated. |

Rubric: **11/11 PASS** (both themes, desktop).

## 3. Anti-slop pass (advisory)

- No AI-purple hero glow, no forced Inter (uses the app's system stack), no
  div-fake screenshot, no eyebrow-per-section.
- Real, domain-specific data (repo + session names, statuses), the product's own
  **π** brand glyph — not generic "Acme/Jane Doe".
- Watch: the 3 starter chips ("Explain this codebase" …) are the one slightly
  generic-assistant touch. Kept because they cut the blank-page cost (Hick) and
  match the chat convention — but treat as **content to tune**, and make them
  omittable/config later.

## 4. Prioritized findings (severity 0–4)

1. **[sev 3 · responsive]** Header (title + path + 3 labeled quick actions) risks
   overflow < 720px. **Fixed in mockup**: quick actions collapse to icon-only and
   wrap under the title; sidebar hides < 480px (MobileShell territory). Carry this
   into the real component's responsive rules.
2. **[sev 2 · a11y, inherited]** Light `--text-tertiary` on white ≈ 4.48:1. On
   promote, use `--text-secondary` for the folder path/meta. Not blocking (app-wide token).
3. **[sev 2 · convergence risk, from doubt-review]** Concurrent spawns in one cwd
   could mis-navigate. Mitigation already in design D6 / spec: disable send while a
   page-initiated spawn is in flight (shown by the **sending** state).
4. **[sev 1 · polish]** Populated-state composer reads slightly tall for 2 rows —
   tighten vertical padding on promote.

## 5. Design decisions this mockup confirms / feeds back

- **Q2 (design open question) resolved visually**: centered composer when empty,
  docked-top + session list when populated. Recommend adopting as the spec default.
- **Model picker correctly absent** (deferred per D5) — the composer bar stays
  minimal, which actually *helps* the Hick/minimalist score for v1.
- **Sidebar "open" affordance** renders as a right-arrow that appears on
  hover/selection, clearly distinct from the collapse chevron (design D3) — verified
  it reads as a separate control, not a second collapse target.

## Verdict

**Ship the direction.** Accessibility gate passes; 11/11 heuristic rubric; anti-slop
clean. No blocking defects. Fold findings #1–#4 into the promote step (real
React/`CommandInput` wiring), mapping tokens 1:1 from this mockup.
