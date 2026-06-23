# UX Best Practices — the expert designer's ground truth

> **Stance: act as an expert UX designer.** Every design decision in the loop
> must be **grounded in an externally documented, public-facing design rule**,
> not invented. When you make a UX call, you should be able to name the rule and
> cite its public source. "I think it looks better" is not a reason; "Hick's Law
> — reduce the choices at this decision point (lawsofux.com/hicks-law)" is.
>
> **Adapt, don't copy.** Adapt the *principle* from the source to the current
> product and its selected design system. Prefer freely-licensed public sources
> (USWDS is CC0; GOV.UK is OGL; Material/Carbon are Apache-2.0). Cite NN/g and
> Laws of UX with attribution. Never copy proprietary assets/text (Apple HIG,
> Refactoring UI, Mobbin) — adapt their principles only.

This reference is the rule corpus the `frontend-mockup-loop` skill consults. It
is organized as: (1) source hierarchy, (2) universal laws & heuristics,
(3) component pattern rules, (4) the expert evaluation protocol, (5) the
checkable rubric seed, (6) the sources index.

---

## 1. Source hierarchy — what to adapt, in licensing-safe order

| Tier | Source | Adapt for | Licence |
|---|---|---|---|
| 1 | **USWDS** — patterns-as-recipes + 7 principles | task patterns (forms, addresses, usernames) | **CC0 / public domain** |
| 1 | **GOV.UK Design System + Service Manual + Style Guide** | task patterns, error summary, plain language | MIT + Open Government Licence |
| 2 | **NN/g** — 10 Usability Heuristics + pattern articles | the vendor-neutral principles layer | free articles, cite |
| 2 | **Laws of UX** (lawsofux.com) | cognitive laws → concrete UI rules | free, cite |
| 2 | **Material Design 3** | adaptive layout, interaction states, content | Apache-2.0 |
| 2 | **IBM Carbon** | per-component "when to use / when not" | Apache-2.0 |
| 3 | **Shopify Polaris — Content** | UX writing, error-message wording | free public docs |
| 3 | **Mailchimp Content Style Guide** | voice vs tone framework | openly published |
| 4 | **Apple HIG**, Refactoring UI, Smart Interface Design Patterns, Mobbin | principles/inspiration only | proprietary/paid — never copy |

**Default rule:** when a project has a selected design system (Material, MUI,
Fluent, Apple HIG…), that system's documented guidance is the *first* source to
adapt. The universal laws below fill the gaps the system does not cover.

---

## 2. Universal laws & heuristics

### 2a. Nielsen's 10 Usability Heuristics
Canonical source: https://www.nngroup.com/articles/ten-usability-heuristics/

1. **Visibility of system status** — every action/state shows timely feedback (loading/success/error).
2. **Match between system and real world** — plain language, real-world conventions, logical order.
3. **User control & freedom** — a marked exit: undo, cancel, back.
4. **Consistency & standards** — same words/actions mean the same thing; follow platform norms.
5. **Error prevention** — constrain inputs, sensible defaults, confirm risky actions.
6. **Recognition rather than recall** — needed info visible on-screen, not memorized across screens.
7. **Flexibility & efficiency** — accelerators for experts (shortcuts, saved views, bulk actions).
8. **Aesthetic & minimalist design** — one primary action per screen; cut everything that does not serve the goal.
9. **Help users recognize, diagnose, recover from errors** — plain-language errors stating cause + fix, no codes.
10. **Help & documentation** — contextual, task-focused help where complex actions occur.

### 2b. Laws of UX (highest-leverage)
Source: https://lawsofux.com/

- **Jakob's Law** — users prefer your site to work like the others they know → follow conventions (logo top-left → home, search top-right).
- **Fitts's Law** — targets large + close; primary CTA big and reachable (≥44px).
- **Hick's Law** — decision time grows with choices → limit/group options, progressive disclosure.
- **Miller's Law** — working memory ~7±2 → chunk long sequences (phone/card numbers, nav).
- **Tesler's Law** — irreducible complexity must live somewhere → the system absorbs it (smart defaults), not the user.
- **Postel's Law** — accept liberal input (phone with/without spaces), normalize internally.
- **Von Restorff (Isolation)** — the different item is remembered → exactly one isolated focal action per view.
- **Doherty Threshold** — keep interaction < 400ms or show feedback → optimistic UI, skeletons.
- **Goal-Gradient / Zeigarnik** — show progress, front-loaded, for multi-step flows.
- **Aesthetic-Usability Effect** — polished UI is perceived as more usable → meet a baseline visual bar (alignment, spacing, type scale).

### 2c. Gestalt principles (grouping)
- **Proximity** — within-group spacing tighter than between-group spacing.
- **Similarity** — same-function elements share visual style.
- **Common region** — related items enclosed in a shared container/border/background.
- **Continuity** — related items aligned along a grid/baseline.
- **Figure/ground** — the focal element clearly separated from background (modal + dimmed overlay, elevation).

### 2d. Cognitive load
Source: https://www.nngroup.com/articles/minimize-cognitive-load/
- **Eliminate extraneous load** — every on-screen element must serve the current goal (the core UX job).
- Offload memory to the interface (recognition > recall), chunk (Miller), reuse established patterns (Jakob), defer secondary options (progressive disclosure), keep responses < 400ms (Doherty).

---

## 3. Component pattern rules (each is a checkable do/don't)

### Forms & validation
Sources: NN/g web-form-design, Baymard inline-validation, GOV.UK.
- Persistent **label above the field**; never placeholder-as-label (it disappears, breaks recall).
- **Single-column** layout (exception: short grouped fields like City/State/Zip).
- Inline-validate **on blur / submit, not per-keystroke**; confirm success.
- Mark the **minority class** explicitly ("(optional)"); cut optional fields.
- **Match input type/control to data** (radios ≤3 options; correct mobile keyboard via `type`).
- State format/requirements **up front**; no Reset/Clear buttons.
- **CTA = specific verb** ("Create account"), never "Submit"/"OK".

### Navigation & IA
Sources: NN/g hamburger-menus, breadcrumbs, navigation-cognitive-strain.
- Desktop primary nav **visible** (not hidden behind a hamburger when space allows).
- Mobile **tab bar 3–5 core destinations**; overflow → "More".
- **Breadcrumbs reflect hierarchy, not history**; last node = current page, **unlinked**.
- Global nav in the **same place every page**; mark the **active/current** item.
- **Descriptive, literal labels** (information scent) over clever names.

### Error handling & messaging
Sources: NN/g error-message-guidelines, confirmation-dialog; GOV.UK error-summary.
- **Prevent first** (constraints, defaults, confirm before irreversible).
- Plain language (~7–8th-grade), **no raw codes**; say **what went wrong AND how to fix it**.
- Show errors **inline at the field** + a **top error summary** that links to each failing field (multi-field forms).
- Convey errors by **more than color** (icon + text + outline); **preserve the user's input**.
- **Prefer undo over confirm**; confirm only destructive/irreversible actions. Never blame the user.

### Empty states & onboarding
Sources: NN/g empty-state, progressive-disclosure, onboarding-tutorials; Carbon.
- Name the **value/outcome**, not the feature; show the **shape of success** (ghost rows).
- **One** primary CTA (+ at most one escape hatch like "import sample data").
- **Progressive disclosure**: show the few most important options first.
- Onboarding **skippable/deferrable**, contextual just-in-time help, not a forced upfront tour.

### Loading & feedback
Source: NN/g response-times (0.1s / 1s / 10s limits); Doherty Threshold.
- **< 0.1s** instantaneous → no spinner (avoids flicker).
- **< 1s** preserves flow; beyond ~1s show a busy indicator.
- **> 10s** show a **determinate percent-done + cancel**.
- **Skeletons** for full-page/content layout loads; **spinners** for short blocking actions.
- **Optimistic UI** for high-confidence quick actions, with rollback on failure.

### Data display
Source: NN/g data-tables, infinite-scrolling-when.
- Design the table around the **task** (lookup/compare/scan/act).
- Treat **density as a feature** (compact/comfortable modes).
- **Pagination with visible position** for find tasks; **infinite scroll only for exploratory feeds**.
- Sort + filter + in-page search; **sticky headers**; **right-align numbers**; truncate-with-tooltip.

### Modals, notifications, microcopy
Sources: NN/g modal-nonmodal, ui-copy; Material snackbar.
- **Modal only when the user must focus/decide before continuing**; else inline/non-blocking.
- Toasts for **transient non-critical** feedback (~4–6s); **never auto-dismiss critical errors**.
- **Button labels = outcome verbs** ("Delete photo" / "Keep photo"), not "Yes/No/OK".
- Each modal/dialog has **one visually-primary action**; cancel is visually subordinate.

---

## 4. Expert-UX evaluation protocol (run on every mockup)

A 5-step review combining heuristic evaluation + accessibility floor + boolean
rubric + severity rating. **The model never emits the final number — scores are
derived in code.** (LLM design scores skew positive and are noisy on floats;
decompose into yes/no checks + rationale-before-verdict, aggregate in code.)

**Step 1 — Accessibility floor (HARD GATE · deterministic).**
Run axe-core in a real browser + compute target-size (≥24px AA / 44px AAA),
focus-visible, contrast 4.5:1, `prefers-reduced-motion`, viewport/zoom not
disabled, color-not-sole-channel. Any WCAG-AA failure = blocking defect
(severity ≥3). Sources: https://www.w3.org/TR/WCAG22/ · https://www.w3.org/WAI/ARIA/apg/

**Step 2 — Heuristic boolean rubric (advisory inputs → code-derived score).**
Score the 10 Nielsen heuristics as yes/no items. For a declared user flow, also
run the **cognitive-walkthrough 4 questions per step** (goal? notice action?
associate action with effect? see feedback?). Any "No" = a defect. Multi-pass to
emulate 3–5 independent evaluators. Source:
https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/

**Step 3 — PURE friction scoring (deterministic rollup).**
Rate each task step 1 (green) / 2 (yellow) / 3 (red). Task score = Σ steps; task
**color = worst step** (one red ⇒ red). Source: https://measuringu.com/pure/

**Step 4 — Severity rating 0–4 per defect (schema-locked).**
Nielsen scale: 0 none · 1 cosmetic · 2 minor · 3 major · 4 catastrophe
(= frequency × impact × persistence). Map via fixed rubric, not a free float.
Source: https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/

**Step 5 — Prioritized fix list (deterministic ordering).**
Sort defects: accessibility-gate first, then severity desc, then frequency. Emit
`{location, heuristic/criterion, severity, fix, check-type}`. **Block "pass"
while any severity-4 or WCAG-AA failure remains**; feed the rest into the
mockup→test→fix→learn loop.

---

## 5. UX rubric seed — the checkable rules (assert TRUE)

Use these as the boolean checks in `score_mockup` / `validate_mockup`. Each is
derived from a cited rule above; score = passed / N, computed in code.

**Accessibility floor (deterministic, gate):**
1. Text contrast ≥ 4.5:1 (3:1 for large text); UI/non-text ≥ 3:1.
2. Interactive targets ≥ 24×24px (AA); primary actions ≥ 44×44px.
3. Visible focus indicator on every focusable element.
4. State/errors conveyed by more than color (icon/text/outline).
5. `prefers-reduced-motion` honored; zoom not disabled.

**Heuristics & layout (boolean rubric):**
6. Exactly one visually-dominant primary action per view (Von Restorff + H8).
7. Every async/state-changing action shows status < 1s (H1 + Doherty).
8. Every destructive/multi-step action is reversible (undo) or confirm-gated (H3/H5).
9. Repeated components and terms use one consistent pattern (H4 + Similarity).
10. Within-group spacing tighter than between-group (Proximity); related items enclosed (Common region).
11. No element on screen fails to serve the current goal (H8 + extraneous load).
12. Core patterns match platform conventions — logo top-left, search top-right (Jakob + H2).

**Component patterns (boolean rubric):**
13. Every input has a persistent associated label (not placeholder-only).
14. Forms are single-column at mobile width.
15. Primary CTA/submit label starts with an action verb (not "Submit/OK").
16. Inline validation fires on blur/submit, not per-keystroke.
17. Mobile primary nav (tab bar) has ≤ 5 items; desktop nav is visible.
18. Field error text states a fix, not just "invalid"; multi-field forms show a linked error summary.
19. Zero-data screen has exactly one primary CTA; onboarding is skippable.
20. Operations > 10s show a determinate progress indicator + cancel; sub-100ms show none.
21. Large/sortable tables keep a sticky header; numeric columns right-aligned.
22. Multi-step flows show a progress indicator, front-loaded (Goal-Gradient/Zeigarnik).

---

## 6. Sources index (public, citable)

**Principles & laws**
- NN/g 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- NN/g Cognitive Load — https://www.nngroup.com/articles/minimize-cognitive-load/
- NN/g Heuristic Evaluation method + severity — https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/ · https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/
- Laws of UX — https://lawsofux.com/
- PURE method — https://measuringu.com/pure/ · https://www.nngroup.com/articles/pure-method/

**Task patterns & content (freely adaptable)**
- USWDS patterns + principles (CC0) — https://designsystem.digital.gov/patterns/ · https://designsystem.digital.gov/design-principles/
- GOV.UK Design System patterns (OGL) — https://design-system.service.gov.uk/patterns/
- GOV.UK Service Manual — https://www.gov.uk/service-manual/design
- GOV.UK Content Style Guide — https://www.gov.uk/guidance/style-guide
- Material 3 foundations + content — https://m3.material.io/foundations
- IBM Carbon — https://carbondesignsystem.com/
- Shopify Polaris content — https://polaris-react.shopify.com/content
- Mailchimp Content Style Guide — https://styleguide.mailchimp.com/
- UI-Patterns (problem→solution) — https://ui-patterns.com/patterns

**Component best-practice articles**
- NN/g web-form-design — https://www.nngroup.com/articles/web-form-design/
- Baymard inline validation — https://baymard.com/blog/inline-form-validation
- NN/g error-message guidelines — https://www.nngroup.com/articles/error-message-guidelines/
- GOV.UK error summary — https://design-system.service.gov.uk/components/error-summary/
- NN/g empty-state — https://www.nngroup.com/articles/empty-state-interface-design/
- NN/g progressive disclosure — https://www.nngroup.com/articles/progressive-disclosure/
- NN/g response times — https://www.nngroup.com/articles/response-times-3-important-limits/
- NN/g skeleton screens — https://www.nngroup.com/articles/skeleton-screens/
- NN/g data tables — https://www.nngroup.com/articles/data-tables/
- NN/g hamburger menus — https://www.nngroup.com/articles/hamburger-menus/
- NN/g breadcrumbs — https://www.nngroup.com/articles/breadcrumbs/
- NN/g modal vs non-modal — https://www.nngroup.com/articles/modal-nonmodal-dialog/
- NN/g UI copy — https://www.nngroup.com/articles/ui-copy/

**Accessibility & inclusive design**
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/ · What's new — https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- ARIA Authoring Practices (APG) — https://www.w3.org/WAI/ARIA/apg/
- Microsoft Inclusive Design — https://inclusive.microsoft.design/
- GOV.UK making your service inclusive — https://www.gov.uk/service-manual/design/making-your-service-more-inclusive
