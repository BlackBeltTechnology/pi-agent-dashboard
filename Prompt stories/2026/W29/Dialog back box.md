---
session: 019f7c50
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Replace a dialog's back arrow with a standard close — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`), but the real work was a
small, concrete UI fix: the OpenSpec **proposal viewer dialog** had a ← *back-arrow*
in its header that behaved oddly, and only Escape closed it cleanly. The operator
referred to it by an acronym — **"PDST"** — that didn't map to any component name.
The true objective, once the ambiguity was resolved: **remove the odd back arrow from
the proposal dialog and give every dialog a normal, visible ✕ close button**, then
verify, deploy, and commit. Second (and only other) prompt: *"update specs if required
and commit changes."*

## 2. TL;DR playbook

1. **Don't guess an ambiguous name.** When the operator names a component by an
   unknown acronym (`PDST`), grep for the *behavior* (`onBack`, `ArrowLeft`,
   `>Back<`), then **`ask_user` to confirm the exact component** before editing.
2. **Trace the composition chain.** The "proposal dialog" is `OpenSpecArtifactDialog`
   → wraps shared `MarkdownPreviewView` (whose header owns the back arrow) → rendered
   inside the shared `Dialog` primitive (closes on Escape + backdrop, **no visible ✕**).
3. **Fix at the right layer, surgically.** Add the ✕ to the *shared* `Dialog`
   primitive (benefits every dialog); make the back arrow **optional** on the *shared*
   `MarkdownPreviewView` (`onBack?`) so its many other callers keep it; only the
   proposal dialog drops `onBack`.
4. **Guard against collision.** Add a `closeInset` flag to reserve header space so the
   new top-right ✕ doesn't overlap the `MarkdownSearch` box in flush/headerless dialogs.
5. **Verify before deploying:** `npx tsc --noEmit`, then run the affected vitest suites
   **plus** the broader dialog suites (the new ✕ button could break button-count
   assertions). Use `HOME=$(mktemp -d)` if vitest needs a clean home.
6. **Deploy per the running mode.** `curl /api/health` → if **production**, client
   changes need `npm run build` + `POST /api/restart` (graceful; sessions survive).
7. **Update per-file `AGENTS.md` rows** for the changed contracts (Dialog now renders
   ✕; `onBack` now optional).
8. **Commit only your files.** Stage the exact 6 files by name — leave unrelated
   pre-existing working-tree changes untouched.

## 3. How the collaboration unfolded

**Phase 1 — Disambiguate (≈2 min).** The AI grepped `packages/client/src` for `back`,
`Dialog`, `onBack`, `ChevronLeft|ArrowLeft`, and candidate dialog names. `PDST` matched
nothing cleanly. Rather than fix the wrong thing, it **stopped and asked** which dialog
was meant. *Why it worked:* refusing to act on a bad name-guess saved a wasted edit
cycle on the wrong component.

**Phase 2 — Map the composition (≈3 min).** It read `OpenSpecArtifactDialog`,
`MarkdownPreviewView`, and the `Dialog` primitive, establishing the three-layer stack
and the key constraint: the primitive had **no visible close control** at all. It also
checked *who else* renders `MarkdownPreviewView` (App routes, Archive/Specs browsers,
file preview) — proving the back arrow is essential elsewhere and must stay optional,
not deleted.

**Phase 3 — Confirm the design decision.** A real UX fork surfaced: removing the back
arrow would leave the dialog with no visible close. The AI surfaced this via `ask_user`
and the operator chose to **add the ✕ to the shared primitive** (all dialogs benefit).

**Phase 4 — Three surgical edits.** `Dialog.tsx` (add absolute top-right ✕, works
headered + flush), `MarkdownPreviewView.tsx` (`onBack?` optional + `closeInset`),
`OpenSpecArtifactDialog.tsx` (drop `onBack`, pass `closeInset`).

**Phase 5 — Verify & deploy.** `tsc` clean; 145 tests pass across Dialog,
OpenSpecArtifactDialog, and 11 other dialog suites. Health check showed **production**
mode → `npm run build` + graceful `/api/restart`; server came back up with active
sessions intact.

**Phase 6 — Document & commit.** Updated three `AGENTS.md` rows, decided **no delta
spec** was needed (behavior fix to a shared primitive, not a new capability), staged
**only** the 6 relevant files, and committed as `24d0643c3` on `develop`.

## 4. Prompts that worked

- **Goal prompt (weak as given):** referring to the target as *"PDST"* forced a
  disambiguation round. **Stronger version:** *"The OpenSpec proposal viewer dialog has
  a back arrow in its header that behaves oddly — replace it with a normal ✕ close."*
  Name the behavior + surface, not an internal acronym.
- **High-leverage follow-up:** *"update specs if required and commit changes"* — a
  compact instruction that correctly delegated the spec-vs-no-spec judgment and the
  scoped commit to the AI. Effective because it trusted the AI to *decide* whether a
  delta spec applied rather than prescribing one.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| not know which component `PDST` meant | (the AI self-corrected: it `ask_user`-confirmed instead of guessing) | Name the surface + behavior (e.g. "proposal viewer's back arrow"), not an internal acronym |
| risk deleting a shared affordance used elsewhere | design decision to make `onBack` optional, ✕ on the primitive | State "fix the shared layer without breaking other callers" up front |
| leave specs/commit as a separate step | one prompt: "update specs if required and commit" | Fold the deploy+commit ask into the initial request |

Note: this session needed **very little** human steering (2 prompts total) — most of
the discipline came from the AI following the project's surgical-change + verify-first
doctrine on its own.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this was a one-off surgical fix. **The repeatable
pattern is worth internalizing, though:** *fix-shared-primitive-without-breaking-callers*
— (1) find the lowest shared layer that owns the affordance, (2) make the removed
behavior optional there, (3) opt out only the one caller, (4) run the broad test suite
because shared-primitive changes ripple. If this recurs, promote it to a skill.

## 7. Pitfalls & dead ends

- **Ambiguous component name.** `PDST` matched nothing. *If a name doesn't resolve,
  grep the behavior and `ask_user` — never edit the nearest-looking component.*
- **vitest needs a clean HOME.** The first test run failed; re-run with
  `HOME=$(mktemp -d) npx vitest run …`.
- **Adding a ✕ can break other tests.** A new close button changes button counts in
  dialogs — run the *broad* dialog suites, not just the two you touched.
- **New ✕ vs. existing search box collision.** In flush/headerless dialogs the
  top-right ✕ can overlap `MarkdownSearch` — reserve space with a `closeInset` flag.
- **Production mode hides your change.** `curl /api/health`; if `production`, you must
  `npm run build` + `POST /api/restart` — a bare edit won't show.
- **Don't sweep in unrelated working-tree changes.** Several pre-existing untracked
  files sat in the tree; stage the exact 6 files by name.

## 8. Reproduce it faster — checklist

- [ ] Resolve the target component by **behavior grep** (`onBack`, `ArrowLeft`) +
      `ask_user`, not by an ambiguous name.
- [ ] Map the composition chain (caller → shared view → `Dialog` primitive) and list
      **other callers** of any shared component before touching it.
- [ ] Surface the UX fork (no visible close) via `ask_user`; get the operator's call.
- [ ] Edit at the shared layer: ✕ on `Dialog.tsx`; `onBack?` + `closeInset` on
      `MarkdownPreviewView.tsx`; drop `onBack` in `OpenSpecArtifactDialog.tsx`.
- [ ] `npx tsc --noEmit` → clean.
- [ ] `HOME=$(mktemp -d) npx vitest run` the affected **and** broad dialog suites.
- [ ] `curl /api/health`; if production → `npm run build` + `POST /api/restart`.
- [ ] Update the 3 per-file `AGENTS.md` rows (Dialog ✕; `onBack` optional).
- [ ] Judge specs: shared-primitive behavior fix ⇒ **no delta spec**.
- [ ] Stage the exact 6 files by name; commit on `develop`.

**Key inputs:** a running dashboard on `localhost:8000` (for health/restart), the
`develop` branch, working `npx tsc`/`vitest`.

**Artifacts produced:**
- `packages/client-utils/src/Dialog.tsx`
- `packages/client/src/components/preview/MarkdownPreviewView.tsx`
- `packages/client/src/components/openspec/OpenSpecArtifactDialog.tsx`
- three `AGENTS.md` rows (client-utils, preview, openspec)
- commit `24d0643c3` on `develop`

---

_Generated from session `019f7c50-464a-7294-ba3f-94c8cd331bea` · `pi-agent-dashboard` · 2026-07-19. Source extract: deterministic facts sheet._
