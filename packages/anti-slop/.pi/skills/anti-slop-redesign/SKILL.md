---
name: anti-slop-redesign
description: "Redesign an existing UI without breaking it: declare a mode (greenfield / preserve / overhaul), audit the current surface before any edit, apply modernisation levers in priority order, and never silently change routes, nav labels, form fields, shortcuts or data-testid hooks. Triggers: \"redesign this page\", \"modernise this UI\", \"refresh the look\", \"mockup an existing surface\"."
license: MIT
metadata:
  author: blackbelt-technology
  version: "0.1"
  adapted_from: "Leonxlnx/taste-skill@18dfc92 (taste-skill §11 redesign protocol + redesign-skill / redesign-existing-projects, MIT). Section map: packages/anti-slop/UPSTREAM.md."
---

# anti-slop-redesign

Most UI work changes a surface that already ships. Misclassifying the mode is
the biggest source of bad redesign output: a "refresh" that renames routes,
breaks e2e selectors and drops keyboard shortcuts is a regression, however
good it looks. This skill makes the mode, the audit and the protected list
explicit before anything is touched.

**Authority: advisory.** Findings feed the frontend-mockup-loop FIX step and
never override a WCAG-AA or severity gate. When a recommendation conflicts
with a gate result, the gate result stands and the recommendation is recorded
as overridden. The tell catalog itself lives in `anti-slop-frontend`; this
skill decides *what may change* and *in which order*.

## When to Use

- A request to redesign, modernise, refresh or de-template an existing surface.
- Before `frontend-mockup-loop` MOCKUP on any surface that already ships.
- Not for a site with no shipped design: that is `new-site` → `greenfield`.

## Procedure

### 1. Declare the mode (before any edit)

State the `anti-slop-frontend` Design Read, then one of three modes:

| Mode | Means |
|---|---|
| `greenfield` | no existing design, or a full rebuild was explicitly approved |
| `preserve` | modernise without breaking brand, IA, copy voice or hooks |
| `overhaul` | new visual language on the existing content and IA |

Defaults per surface profile:

| Profile | Default mode |
|---|---|
| `product-ui` | `preserve` |
| `marketing` | `preserve` |
| `new-site` | `greenfield` |

- `overhaul` requires explicit user confirmation before proceeding. Ask once
  (`ask_user` when available); without a yes, stay in `preserve`.
- Pick `overhaul` only when the visual debt is structural (no design system,
  broken mobile, broken IA). Sound IA and content → `preserve`.

### 2. Audit before edit

Produce the audit before touching any file. A redesign whose first artifact is
a diff fails Verification.

- **Screenshot** of the current surface (both modes if the project ships both).
- **Brand tokens in use**: colour tokens, type stack, radius scale, logo.
- **Tells found**: run the `anti-slop-frontend` checklist for the declared
  profile; list each hit with its rule id (A3, B2, ...).
- **Missing states**: loading / empty / error that do not exist yet.
- **Protected inventory**: list the items from "Never change silently" that
  the surface contains (routes, nav labels, field names, shortcuts,
  `data-testid` values).
- **Dial reading** of the existing surface. That is the starting point, not a
  baseline.

### 3. Levers in priority order

Apply in order; stop as soon as the brief is satisfied. Each lever is a
separate, reviewable step.

1. **Typography** - family, scale, weight hierarchy. Biggest lift per risk.
2. **Colour** - unify neutrals, one accent, tokens only (`anti-slop-frontend` A1, T1).
3. **Spacing and rhythm** - consistent scale, section padding, max-width.
4. **States** - hover / active / focus, then loading / empty / error.
5. **Motion** - only motivated motion at the declared MOTION dial (A7).
6. **Layout** - recompose a section only when levers 1-5 cannot fix it; full
   block replacement only for an unsalvageable block.

In `preserve`, levers 1-4 are the default scope; 5-6 need a reason in the
audit.

### 4. Verify the protected list

Diff the result against the protected inventory from step 2. Every changed
protected item must be listed and confirmed (see below), or reverted.

## Never change silently

In `preserve` and `overhaul`, these do not change unless the change is listed
explicitly and the user confirms it:

- routes / URLs and anchor ids
- nav labels
- form field names (and their order)
- brand wordmark and logo
- legal copy (consent, cookie, terms)
- keyboard shortcuts
- `data-testid` attributes (e2e suites select on them)

Also preserve, unless asked: copy voice, existing accessibility wins (focus
states, alt text, keyboard nav, contrast), and analytics event names.

## Rules

- Work with the existing stack. No framework or styling-library migration.
- Check the dependency file before importing anything new.
- Do not break existing behaviour; run the project's tests after each lever.
- Small, reviewable changes over one big rewrite.

## Pitfalls

- Do NOT start editing before the mode and audit exist.
- Do NOT treat "make it modern" as approval for `overhaul`.
- Do NOT rename a `data-testid` to match a new component name; the e2e suite
  breaks silently in CI, not locally.
- Do NOT use a tell from the audit to justify violating a WCAG-AA gate.

## Verification

- A mode was declared before the first edit; `overhaul` has a recorded
  confirmation.
- The audit (screenshot, tokens, tells, missing states, protected inventory)
  predates the first diff.
- Levers were applied in priority order; skipped levers are named.
- Every protected item that changed is listed with its confirmation; all
  others are byte-identical.
