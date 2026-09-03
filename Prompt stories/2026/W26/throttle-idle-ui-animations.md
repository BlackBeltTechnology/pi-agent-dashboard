---
session: 019ef156
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (9 user prompts); large facts sheet (~11841 tok)"
upgrade_status: pending
openspec_changes: [throttle-idle-ui-animations]
proposal_excerpt: "PI Dashboard burns ~one full CPU core continuously while idle. Live `ps` on a MacBook (Apple Silicon) showed the Electron renderer at ~43% and the GPU process at ~41%, moving in lock-step — the signature of continuous…"
---

# How we did it: Throttle idle UI animations (compositor-only cards) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change throttle-idle-ui-animations`. The *real* objective, once the change context loaded, was: **stop the PI Dashboard burning a full CPU core while idle.** A live `ps` on Apple Silicon showed the Electron renderer (~43%) and GPU process (~41%) moving in lock-step — the signature of continuous per-frame repaint from the session cards' animated CSS (a `@property`-animated neon ring re-rasterizing every frame, `background-position`-scrolled stripes, and a blinking terminal cursor). The fix: convert every idle animation to **compositor-only** transforms (rotate/translate on cached layers), pause everything when the tab is hidden, and disable the terminal cursor blink — then prove the visual result matches with a mockup, land it through the full OpenSpec → PR → merge pipeline.

## 2. TL;DR playbook

1. Resume the OpenSpec change: `/skill:openspec-apply-change <name>`; read the context files and source before touching anything.
2. **Verify the animation technique against an external source before coding** — a `code_search` for "rotating conic gradient via transform rotate (not `@property` angle)" surfaced the canonical `overflow:hidden` + oversized-rotating-layer + inner-cover trick *and its gotchas*.
3. When the technique collides with existing DOM (here: card root can't take `overflow:hidden` because it hosts a non-portaled dropdown + an outer glow), **stop and `ask_user`** with concrete options rather than guessing. The human picked "Option A: add a dedicated clipping overlay layer."
4. Implement compositor-only: static conic + `transform: rotate` rim on a clipped `.card-ring-fx` overlay; `transform: translateX` stripes on `.card-stripes-fx`; `useAppHidden` hook toggling a `:root.app-hidden *` pause rule; `cursorBlink:false`. Write the hook test first.
5. Run tests scoped to your files (`HOME=$(mktemp -d) npx vitest run <your specs>`), build, `openspec validate --strict`.
6. **Build a self-contained mockup** (`mockups/<change>/index.html`, hand-written CSS + theme tokens copied verbatim, no Tailwind CDN) grabbing real card markup via `agent-browser`; `open` it in the default browser; screenshot dark + light with agent-browser to verify.
7. Iterate visually with the human: each screenshot correction is a real bug — fix it in **both** the mockup and `packages/client/src/index.css`, rebuild, reopen.
8. Update `proposal.md` + `design.md` to match what was actually built (architecture diverged from the original design).
9. Ship: commit → `openspec archive` → PR to `develop` → monitor CI + CodeRabbit → fix flagged issues → squash-merge → delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & technique validation.** The AI read the change tasks and source, measured `ps` (found the renderer/GPU lock-step), then *before writing a single line* ran a `code_search` to confirm the canonical transform-based rotating-rim technique and its clipping gotcha. This up-front research is what made the rest fast: it knew the trap (rotating a masked rounded rect tilts the rim) before falling into it.

**Phase 2 — Structural decision point.** Implementation surfaced a real conflict: the compositor technique needs `overflow:hidden` on a clip box, but the card root `<li>` hosts a non-portaled dropdown (`WorktreeActionsMenu`, `top-full`/`bottom-full`) and the outer glow — both must escape the card. Clipping the root would clip them. The AI **paused and presented options via `ask_user`** instead of picking silently. The human chose "add a dedicated clipping layer" (Option A).

**Phase 3 — Implement.** New `useAppHidden` hook (+ test written first), `:root.app-hidden *` pause rule, `.card-ring-fx` / `.card-stripes-fx` overlay layers, `getCardStripeFxClass`, `relative isolate` on the card root, `cursorBlink:false` in `TerminalView`. Tests scoped to the changed files passed (94 assertions); the 18 repo failures were pre-existing env issues (Jimp version, `browse-endpoint` needing `node_modules`) — the AI correctly isolated and ignored them.

**Phase 4 — Mockup & visual iteration (the bulk of the session).** The human asked for a mockup. The AI grabbed authentic card markup + theme tokens from the running dashboard via `agent-browser`, built a self-contained `mockups/idle-ui-animations/index.html` covering all six card states, `open`ed it, and screenshotted dark/light. Then four rounds of human visual correction, each a genuine defect:
- **Harsh seamed stripes** → leftover `background-size: 28.2843px` from the old `background-position` approach seams the pattern under `translateX`; removed it (the original code even carried an `IMPORTANT` warning never to set it).
- **Gradient bleeding into page background** → the glow `::after` was `inset:-50%` (200%) to cover rotation; made the glow *static & tight*, rotation lives on the clipped rim.
- **"Make the glow rotate again + double it"** → clip each rotating conic to a halo band (`overflow:hidden`) then `filter:blur` the *layer* so the halo spreads contained; two stacked layers = double glow.
- **90° coverage gap on wide cards** → the rotating layer was `200%×200%` (proportional), so at ~90° its effective width shrank below the card width. Fixed with `container-type: size` + `200cqmax` square so it covers the diagonal at every angle.

Every fix was applied to **both** the mockup and the real `index.css`, kept in sync, rebuilt, reopened.

**Phase 5 — Reconcile artifacts & ship.** Updated `proposal.md` + `design.md` to document the clipped-overlay architecture (diverged from original design). Then the human handed a 7-step ship list: archive → PR → CI → fix CodeRabbit → merge → delete branch → delete worktree. CI passed (8m); CodeRabbit flagged 4 real doc-lint/test issues (escaped literal `\|` in file-index rows, stale `src/client→packages/client/src` paths, empty spec Purpose, unreset `document.visibilityState` in test `afterEach`) — all fixed, re-run green, squash-merged as `0de49dec`, PR #149.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change throttle-idle-ui-animations`. A skill invocation that loads full change context is a strong kickoff: the AI inherits the proposal, design, and task checklist without re-explaining.
- **"create mockups for new card changes. Use browser to grab cards and make mockups for that with new css fixes"** — high-leverage: it forced a *visual verification surface* early, which is where all four real bugs were caught. Grabbing real markup (not inventing it) made the mockup trustworthy.
- **"Add mockup as part of propose and open in default browser"** — turned a one-off into a durable convention (a memory was saved so future UI proposals ship a mockup automatically).
- **Terse visual corrections with a screenshot** ("Not correct [image]", "the gradient shown in background?", "make the glow border double", "when rotation in 90% it not cover the whole wide — scale x?") — each short prompt + screenshot unlocked a precise fix. Attaching the image is what made them high-leverage.
- **"1. archive / sync 2. create PR 3. monitor CI 4. fix coderabbit issues 5. merge PR 6. delete branch 7. delete worktree"** — a numbered ship checklist executed end-to-end without further steering.

**Rewrite for next time:** the visual corrections would be even faster stated as an acceptance bar up front — e.g. *"the glow must hug the card edge (no bleed onto the page background) and cover the full card width at every rotation angle, in both dark and light themes."* Stating that once would have collapsed rounds 2–4 into one.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Carry over `background-size` from the old `background-position` animation | "stripes are harsh irregular bands" (+image) | State: under `translateX`, the gradient must fill naturally — never pin `background-size` on a translated stripe layer (a code comment now warns this) |
| Oversize the glow (`inset:-50%`) to cover rotation → bleeds colored blobs into the page | "gradient shown in background? not ok" (+image) | Acceptance bar up front: glow must hug the card edge, no page-background bleed |
| Freeze the glow to stop the bleed (lost the motion) | "the card background gradient is not rotating" | The rotating layer must be *clipped then blurred*, not shrunk — motion stays, containment via `overflow:hidden` + `filter:blur` on the layer |
| Size the rotating layer proportionally (`200%×200%`) → gaps at ~90° on wide cards | "at 90% it not cover the whole wide" | Size rotating layers as a square to the larger edge (`200cqmax` + `container-type: size`) so they cover the diagonal at every angle |
| Let proposal/design drift from the built architecture | "update proposal" | Reconcile `proposal.md`/`design.md` immediately after any architecture divergence |

Two constant, correct instincts worth repeating: (1) the AI **isolated pre-existing test/lint failures** (Jimp, `browse-endpoint`) from its own changes rather than chasing them; (2) it **verified the technique externally before coding** and **paused to `ask_user`** at the one true structural fork.

## 6. Skills, tools & memory created — and why they're effective

- **Memory (project convention):** *UI/visual OpenSpec proposals MUST ship a self-contained `mockups/<change>/index.html`* — hand-written CSS + theme tokens copied verbatim (no Tailwind CDN), built from real markup grabbed via agent-browser, opened in the default browser. **Why effective:** it institutionalizes the exact step that caught all four bugs this session; future UI changes get a visual verification surface for free during propose.
- **Memory (failure/insight):** *when converting a 45° `repeating-linear-gradient` scroll from animating `background-position` to a `transform: translateX` overlay, do NOT carry over `background-size`* — the fixed tile seams the pattern. **Why effective:** encodes a non-obvious CSS trap that produced a visible regression; the same lesson is also in an `index.css` code comment as a belt-and-suspenders guard.
- **agent-browser** as a visual QA loop: grab live markup, `eval` computed styles (confirmed the glow's live rotation matrix ~150°), screenshot dark/light, freeze animations at a worst-case frame to test coverage. **When to invoke:** any CSS animation change where "does it look right" can't be asserted in a unit test.

*Recommended skill to formalize:* a `compositor-only-animation` checklist (clip-then-blur for contained glow, square-to-larger-edge sizing for full-angle coverage, never pin `background-size` on a translated layer, pause via a `visibilitychange` root class).

## 7. Pitfalls & dead ends

- **agent-browser MCP `eval` echoes instead of executing** — use the `agent-browser` CLI directly to run JS / dump HTML to a file.
- **Default browser vs automation session** — `open <file>` launches the *system default* browser; agent-browser drives its *own* session. Screenshot/verify in the agent-browser session, not the one `open` launched.
- **Proportional rotating layers gap at 90°** — `200%×200%` isn't enough on non-square cards; use `200cqmax` + `container-type: size`.
- **`background-size` on a translated stripe layer seams the pattern** — remove it; let the repeating gradient fill naturally, loop via one-period `translateX`.
- **Pre-existing repo test/lint noise** (Jimp constructor in `pi-image-fit`, `browse-endpoint` needing `node_modules`, `tsc` project-reference quirk) — scope vitest/tsc to *your* files (`HOME=$(mktemp -d) npx vitest run <spec>`) and confirm CI (not local env) before treating failures as yours.
- **Heredoc PR body tripped on an apostrophe** — write the PR body to a file (`/tmp/pr-body.md`) and pass `--body-file`.
- **Shell cwd was the removed worktree** — run post-merge cleanup (branch/worktree delete, `develop` sync) from the main repo, not inside the worktree you're about to delete.

## 8. Reproduce it faster — checklist

- [ ] Resume the change: `/skill:openspec-apply-change <name>`; read context + source first.
- [ ] `ps -axo pid,%cpu,command | grep -i pi-dashboard` to confirm the idle-CPU signature.
- [ ] `code_search` the animation technique + its gotchas **before coding**.
- [ ] If the technique collides with the DOM, `ask_user` with concrete options — don't guess.
- [ ] Implement compositor-only: `transform` rotate/translate on `overflow:hidden`-clipped overlay layers; static glow → clip-then-`filter:blur` for contained motion; `200cqmax` + `container-type: size` for full-angle coverage; never pin `background-size` on a translated layer.
- [ ] `useAppHidden` hook + `:root.app-hidden *` pause rule; `cursorBlink:false`. Write the hook test first.
- [ ] Scoped tests: `HOME=$(mktemp -d) npx vitest run <your specs>`; `npm run build`; `openspec validate <name> --strict`.
- [ ] Mockup: grab real markup via agent-browser → self-contained `mockups/<name>/index.html` (theme tokens verbatim, no CDN) → `open` → screenshot dark+light → fix bugs in **both** mockup and `index.css`.
- [ ] Reconcile `proposal.md` + `design.md` with what was built.
- [ ] Ship: commit → `openspec archive` → PR to `develop` (`--body-file`) → monitor CI + CodeRabbit → fix flagged issues → squash-merge → delete branch + worktree (from the main repo).

**Inputs to have ready:** running dashboard (server + Electron for the `ps` baseline), agent-browser CLI, `gh` auth, the OpenSpec change scaffold.

**Artifacts produced:** `packages/client/src/hooks/useAppHidden.ts` (+ test), edits to `App.tsx` / `index.css` / `SessionCard.tsx` / `TerminalView.tsx`, `mockups/idle-ui-animations/index.html`, updated `proposal.md`/`design.md`, archived spec `openspec/specs/ui-animation-energy/`, merged PR #149 (`0de49dec`).

---

_Generated from session `019ef156-6d7b-7f8d-964f-2e2c59a6e204` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-22. Source extract: mktemp facts sheet._
