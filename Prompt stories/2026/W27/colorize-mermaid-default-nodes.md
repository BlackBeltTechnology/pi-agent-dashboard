---
session: 019f28f0
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [colorize-mermaid-default-nodes]
proposal_excerpt: "Mermaid diagrams render with mermaid's stock `default`/`dark` themes, which give every node the same pale grey fill. The dashboard already defines a rich, theme-aware accent palette (`--accent-blue/green/yellow/red/p…"
---

# How we did it: Colorize default Mermaid nodes with theme accents — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a deceptively small prompt: **"Is there anything to clarify?"** —
handing the AI a ready-made OpenSpec change (`colorize-mermaid-default-nodes`) and
asking it to pressure-test the design *before* writing code. The real objective:
implement the change so that Mermaid diagrams stop rendering every node as the same
pale grey, and instead tint each default node with the dashboard's existing
theme-aware accent palette (`--accent-blue/green/yellow/red/purple/orange`) — while
respecting author-specified colors and staying correct across all four named themes.
The full arc ran through implementation, TDD, a real Docker + Playwright E2E, and a
clean ship (PR #222 → squash-merge → worktree teardown).

## 2. TL;DR playbook

1. **Kick off with "is there anything to clarify?"** on the OpenSpec change — force
   the AI to read both the change artifacts *and* the real code and surface gaps
   before implementing.
2. **Resolve the clarifications tersely** ("1. extend / 2. a / 3. ok") — one line per
   open question is enough to unblock.
3. **Let the AI write tests first (TDD):** update `MermaidBlock.test.tsx` for the new
   composite cache key, watch it go red, then implement the helpers to green.
4. **Implement in `MermaidBlock.tsx`:** `resolveAccents()`, `hashId()` (djb2),
   `rgba()`, `colorizeDefaultNodes()` — a DOMParser pass; wire it into `renderMermaid`
   *before* caching; key cache + effect deps on the composite `themeId =
   "<themeName>:<resolved>"`.
5. **Prove it in a browser, not just jsdom:** add a `mermaid-colorize` faux scenario
   to `qa/fixtures/faux-scenarios.ts` + a Playwright spec `tests/e2e/mermaid-colorize.spec.ts`.
6. **Run the E2E against the real Docker container** — bring it up seeded
   (`PI_E2E_SEED=1`), attach Playwright with `PW_E2E_USE_RUNNING=1` + `PW_CHANNEL=chrome`.
7. **Ship with the `ship-change` skill:** verify gate (tests + build) → archive +
   sync specs → commit (excluding unrelated files) → push → PR against `develop`.
8. **Watch CI, address CodeRabbit, squash-merge, delete branch, remove the worktree.**

## 3. How the collaboration unfolded

**Phase 1 — Clarify (Discovery).** The AI didn't jump to code. It read the change
artifacts *and* grounded them against `MermaidBlock.tsx` / `useTheme.ts`, and found a
**real correctness gap**: the design assumed the SVG cache keyed on `(code, theme)`
would be correct per theme — but `theme` from `useThemeContext().resolved` is only
`"light" | "dark"`. The *named* theme (`base`/`dracula`/`nord`/`solarized`) lives in a
separate `themeName` field the component never read. So switching dracula-dark →
nord-dark would return a stale cached SVG with the wrong accents. *Decision point:* the
user chose **extend** (composite key), option **a** for colorize placement, and
confirmed the fallback ramp is jsdom-only.

**Phase 2 — Implement (TDD).** Tests first: the theme-cache test was updated to the
composite `themeId` format, run red, then the helpers were written to green. All 14
unit tests passed; full client suite stayed green (2916 pass). The colorize pass tints
default `g.node`/`g.classGroup` shapes (fill = accent @ 8% wash, border @ 85%, label
keeps `--text-primary`), **skips any shape with an inline `style` `fill:`** (author
intent wins), and keys hue by `hashId(g.id)` for edit-stability.

**Phase 3 — Browser E2E (Verify end-to-end).** Prompted with *"Test with docker tests
and playwright"*, the AI followed the project convention (browser QA → Playwright spec,
not `qa/*.sh`). It added a faux scenario streaming a flowchart with default nodes
(A, C) + one authored node (`style B fill:#ff0000`), and a spec asserting the rendered
SVG carries the wash on A/C and leaves B untouched. The E2E passed through the real
stack: faux model → bridge → /ws → ChatView → MarkdownContent → MermaidBlock →
mermaid.render() in-container → `colorizeDefaultNodes()`.

**Phase 4 — Ship.** On *"I will test later, use ship-change"*, the AI ran the verify
gate, correctly diagnosed 19 pre-existing environmental failures as **not its fault**
(proved via `git stash` → "No local changes to save" in those packages), repaired a
malformed pre-existing main spec, archived + synced, opened PR #222, watched CI green,
applied the one trivial CodeRabbit MD037 fix, and squash-merged + cleaned up.

## 4. Prompts that worked

- **The goal prompt — "Is there anything to clarify?"** Effective because it forced a
  *design review before code*. Instead of blindly implementing, the AI cross-checked
  the spec against the real source and caught a caching correctness bug the design had
  papered over. A future version could be even stronger: *"Review this OpenSpec change
  against the actual code and list any correctness gaps before implementing."*
- **"1. extend / 2. a / 3. ok"** — a high-leverage micro-reply. Once the AI has
  enumerated the open questions, terse per-item answers unblock everything without
  re-explaining context.
- **"Test with docker tests and playwright"** — a one-liner that pushed verification
  from jsdom into a real browser, catching what unit tests can't.
- **"I will test later, use ship-change"** — delegates the entire land sequence to a
  known skill, and explicitly defers manual QA so the AI doesn't block on it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Be ready to implement straight from the spec | "Is there anything to clarify?" (force a pre-code design review) | Always ask the AI to validate a spec against real code *before* it writes any |
| Stop at jsdom/unit-level verification | "Test with docker tests and playwright" | State up front that browser-rendered behavior needs a Playwright E2E, per project convention |
| Potentially block on a manual "visually confirm" QA task | "I will test later, use ship-change" | Tell the AI to flip manual QA tasks and defer them when the change is otherwise done |
| Risk committing unrelated churn (`manage-flows` edit, regenerated `plugin-registry.tsx`) | (AI self-corrected) | Instruct: "commit only the files this change touches; restore build-regenerated artifacts" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session leaned on existing project skills:

- **`ship-change`** did the heavy lifting: verify gate → archive + sync specs → commit
  → PR → CI watch → CodeRabbit loop → squash-merge → worktree teardown. Invoke it once
  implementation + tests are done and the change is ready to land.
- **`openspec archive`** syncs the delta spec into the main spec *and* archives in one
  step — but only if the existing main spec is structurally valid.

*Recommended reusable capture:* a short skill note — **"colorize an SVG render pass by
composite theme id"** — documenting that any theme-derived SVG post-processing in this
repo must key its cache/effect on `"<themeName>:<resolved>"`, not just `resolved`,
because named themes share a light/dark value. That single fact was the crux of the
whole session.

## 7. Pitfalls & dead ends

- **Cache keyed on light/dark only** → stale SVG when switching between two dark named
  themes. *Fix:* composite `themeId = "<themeName>:<resolved>"` on both `cacheKey` and
  the render effect deps.
- **Chromium download timed out** (network). *Fix:* use the system Chrome via
  `PW_CHANNEL=chrome` to skip the bundled browser download.
- **First-time Docker image build blew the 180s health window** (`npm install`
  in-container is slow). *Fix:* build + start the container manually with no health cap,
  then attach Playwright with `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=18815 PW_GATEWAY_PORT=19815`.
- **Container onboarding CTA disabled** → the faux provider wasn't wired. *Fix:* bring
  the container up with `PI_E2E_SEED=1` so the fake credential + faux extension are staged.
- **19 unrelated test failures** (`server`/`shared`/`image-fit`: `Jimp is not a
  constructor`, missing hoisted `node_modules`, host Electron paths). *Fix:* prove
  independence with `git stash` → "No local changes to save" in those packages; they're
  worktree/environment artifacts that pass in a clean CI checkout.
- **Malformed pre-existing main spec** blocked `openspec archive` (stray
  `## ADDED Requirements` delta header + missing `## Purpose`). *Fix:* correct the
  header to `## Requirements` and add a `## Purpose` section.
- **`npm run build` regenerated `plugin-registry.tsx`** (dropped a demo-plugin entry
  absent in the worktree). *Fix:* unstage + `git checkout --` it; it's build noise.
- **Worktree branch-collision on squash-merge** (gh tried to check out `develop`, held
  by the parent repo). The remote merge still succeeded — delete the branch manually
  and force-remove the worktree.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change directory (`openspec/changes/colorize-mermaid-default-nodes/`).
- System Chrome installed (for `PW_CHANNEL=chrome`).
- Docker running.
- A GitHub token for `gh` (PR + CI watch).

**Checklist:**
1. [ ] "Is there anything to clarify?" — AI reviews spec vs. code, lists gaps.
2. [ ] Answer clarifications one line each; choose the composite-key path.
3. [ ] TDD: update `MermaidBlock.test.tsx`, red → implement helpers → green.
4. [ ] Wire `colorizeDefaultNodes()` into `renderMermaid` before caching; key on
       `"<themeName>:<resolved>"`.
5. [ ] Add `mermaid-colorize` faux scenario + `tests/e2e/mermaid-colorize.spec.ts`.
6. [ ] Docker up seeded (`PI_E2E_SEED=1`); attach Playwright with `PW_E2E_USE_RUNNING=1`
       + `PW_CHANNEL=chrome`; tear down after.
7. [ ] Update tree rows (`AGENTS.md` for `MermaidBlock.tsx`, `tests/e2e/`, `qa/`).
8. [ ] `ship-change`: verify gate → archive/sync → commit (touched files only) → PR →
       CI → CodeRabbit → squash-merge → worktree teardown.

**Final artifacts produced:**
- `packages/client/src/components/MermaidBlock.tsx`
- `packages/client/src/components/__tests__/MermaidBlock.test.tsx`
- `tests/e2e/mermaid-colorize.spec.ts`
- `qa/fixtures/faux-scenarios.ts`
- `openspec/specs/mermaid-diagram/spec.md` (synced requirement + repair)
- PR #222 → squash-merged to `develop` (mergeSha `7387092`).

---

_Generated from session `019f28f0-a7cf-74ca-bcb9-2088183206af` · `pi-agent-dashboard` · 2026-07-03. Source extract: deterministic session facts sheet._
