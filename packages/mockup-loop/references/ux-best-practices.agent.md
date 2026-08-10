# ux-best-practices — index

Rule corpus for `frontend-mockup-loop` skill. Stance: act as expert UX designer; every decision grounded in externally documented public rule, name rule + cite source. Adapt principle, don't copy proprietary assets. Sections: source hierarchy, universal laws, component rules, eval protocol, rubric seed, sources index.

## §1 Source hierarchy — licensing-safe order
Tier 1: USWDS (CC0), GOV.UK Design System + Service Manual + Style Guide (MIT+OGL). Tier 2: NN/g heuristics (cite), Laws of UX (cite), Material 3 (Apache-2.0), IBM Carbon (Apache-2.0). Tier 3: Shopify Polaris content, Mailchimp Style Guide. Tier 4: Apple HIG, Refactoring UI, Mobbin (proprietary — never copy). Default: selected design system's guidance first; universal laws fill gaps.

## §2 Universal laws & heuristics
- §2a Nielsen's 10 heuristics: visibility of status, match real world, user control/freedom, consistency/standards, error prevention, recognition>recall, flexibility/efficiency, aesthetic/minimalist, help recognize/recover errors, help/docs.
- §2b Laws of UX: Jakob, Fitts (≥44px), Hick, Miller (7±2), Tesler, Postel, Von Restorff (one focal action), Doherty (<400ms), Goal-Gradient/Zeigarnik, Aesthetic-Usability.
- §2c Gestalt: proximity, similarity, common region, continuity, figure/ground.
- §2d Cognitive load: eliminate extraneous load, offload memory to interface, chunk, reuse patterns, <400ms.

## §3 Component pattern rules (do/don't)
- Forms & validation: label above field (never placeholder-as-label), single-column, validate on blur/submit not per-keystroke, mark optional, match input type, CTA = specific verb never "Submit".
- Navigation & IA: desktop nav visible, mobile tab bar 3–5, breadcrumbs = hierarchy not history (last unlinked), consistent placement + active marker, descriptive labels.
- Error handling: prevent first, plain language no raw codes (what+how to fix), inline at field + top summary linking fields, convey by more than color, prefer undo over confirm.
- Empty states & onboarding: name value not feature, ghost rows, one primary CTA, progressive disclosure, skippable onboarding.
- Loading & feedback: <0.1s no spinner, <1s preserves flow, >10s determinate percent + cancel, skeletons for layout / spinners for short blocking, optimistic UI with rollback.
- Data display: design around task, density as feature, pagination w/ position for find / infinite scroll only exploratory, sort+filter+search, sticky headers, right-align numbers.
- Modals/notifications/microcopy: modal only when must decide first, toasts transient ~4–6s never critical, button labels = outcome verbs, one primary action per dialog.

## §4 Expert-UX evaluation protocol (5 steps, scores derived in code not by model)
Step 1 accessibility floor (HARD GATE, deterministic): axe-core + target-size (≥24px AA/44px AAA), focus-visible, contrast 4.5:1, prefers-reduced-motion, zoom, color-not-sole. WCAG-AA fail = blocking severity ≥3. Step 2 heuristic boolean rubric (10 Nielsen yes/no + cognitive-walkthrough 4 Qs/step, multi-pass 3–5 evaluators). Step 3 PURE friction scoring (step 1/2/3, task color = worst step). Step 4 severity 0–4 per defect (Nielsen scale). Step 5 prioritized fix list (a11y-gate first, severity desc, frequency); block "pass" while any sev-4 or WCAG-AA fail.

## §5 UX rubric seed — 22 checkable rules (assert TRUE, score = passed/N in code)
Accessibility floor (gate) 1–5: contrast ≥4.5:1, targets ≥24/44px, visible focus, state by more than color, reduced-motion/zoom. Heuristics/layout 6–12: one dominant primary action, status <1s, reversible/confirm-gated, consistent pattern, proximity spacing, no element fails goal, platform conventions. Component 13–22: persistent label, single-column mobile, verb CTA, blur/submit validation, mobile nav ≤5, error states fix + summary, one empty-state CTA, >10s progress+cancel, sticky header + right-align numbers, multi-step progress indicator.

## §6 Sources index (public, citable)
Principles/laws: NN/g 10 heuristics, cognitive load, heuristic-eval + severity, Laws of UX, PURE. Task patterns/content: USWDS, GOV.UK DS + Service Manual + Content Style Guide, Material 3, Carbon, Polaris, Mailchimp, UI-Patterns. Component articles: NN/g web-form-design, Baymard inline-validation, NN/g error-message/empty-state/progressive-disclosure/response-times/skeleton/data-tables/hamburger/breadcrumbs/modal/UI-copy, GOV.UK error-summary. A11y: WCAG 2.2, ARIA APG, Microsoft Inclusive Design, GOV.UK inclusive.
