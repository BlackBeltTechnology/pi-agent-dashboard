---
session: 92f216a8
week: 2026/W15
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [image-lightbox, butterfly-token-chart]
proposal_excerpt: "Images in the chat window (user messages, tool results, paste previews) render as inline thumbnails at fixed max sizes (300px, 512px, 16px). There is no way to view images at full size — clicking does nothing. For scr…"
---

# How we did it: Click-to-open image lightbox in the chat window — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted inline chat thumbnails to be **clickable**. First prompt:

> "/skill:openspec-explore — In the chat window images are embedded qs a tumbnail.
> When I click to image show in a dialog. Esc close it."

Once the two follow-up steering turns landed, the *real* objective was sharper: a
single reusable `ImageLightbox` overlay wired into **all three** places images appear
(user messages, tool-result images, paste previews), with **zoom/pan** (not just a
static full-size view), closing on **Esc or backdrop click**. The whole thing was to
be carried end-to-end through the OpenSpec lifecycle — explore → proposal → design →
specs → tasks → apply (TDD) → verify → archive — not hacked in ad hoc.

## 2. TL;DR playbook

1. **Start in explore mode, not code.** `/skill:openspec-explore` + a one-line
   description. Let the AI map the current image render paths (it found 3: `ChatView`
   300px, `ToolCallStep` 512px, `CommandInput` 16px) and surface the reusable
   `useZoomPan` hook *before* proposing anything.
2. **Add the quality bar early.** "I would like to be able to zoom/pan → yes." This
   turned a static dialog into a real lightbox and pinned reuse of the existing hook.
3. **`create proposal`**, then `/opsx:ff` to fast-forward design → specs → tasks in one
   pass (9 tasks across component / wiring / tests).
4. **`/opsx:apply`** and insist on TDD: write the failing test first, then the
   component. Expect a portal-testing fight (see §7) — budget for it.
5. **Extract one `ImageLightbox` component** (`DialogPortal` + `useZoomPan`) and wire
   `cursor-pointer` + `onClick` into all 3 call sites. Don't fork three variants.
6. **Run the full suite after wiring**, not just the new test — confirm the 52 existing
   tests still pass (they became 59).
7. **`npm run build`** to catch compile errors the vitest run misses.
8. **Manually smoke-test with real images:** download a few (`curl` to `/tmp`) and
   `read` them into the live session so they render in the actual dashboard chat.
9. **`/opsx:verify`** then **`/opsx:archive`** — sync delta specs to
   `openspec/specs/` and move the change to `openspec/changes/archive/<date>-<name>/`.

## 3. How the collaboration unfolded

**Phase 1 — Explore (00:10–00:14).** The AI spawned an `Explore` subagent to map image
rendering, then drew a Mermaid graph of the three render sites and confirmed
`useZoomPan` already existed. *Why it worked:* grounding the change in the real code
(3 concrete call sites + a reusable hook) made the scope self-evident and killed
speculative design. **Decision point:** operator added "zoom/pan" — the AI folded it in
by reusing the hook instead of inventing new pan logic.

**Phase 2 — Artifacts (00:14–00:16).** `create proposal`, then `/opsx:ff` generated
design → specs (4 requirements, 9 scenarios) → tasks (9 tasks, 3 groups) in one sweep.
*Why it worked:* a small, well-bounded change is exactly what fast-forward is for — no
per-artifact hand-holding needed.

**Phase 3 — Apply / TDD (00:38–00:45).** Tests first (failing), then the component,
then wiring into `ChatView`, `ReadToolRenderer`, `CommandInput`. Most of the elapsed
effort here was a **jsdom portal-event fight** (§7). Once green, the AI ran the full
suite (59 passing) and `npm run build`.

**Phase 4 — Real-image smoke test (06:27).** Hours later the operator asked to "download
some images with browser and read to test in this dashboard session." The AI `curl`-ed
a cat, a street scene, and the Google logo into `/tmp` and `read` them so they appeared
as real attachments in the live chat — a genuine end-to-end check, not just unit tests.

**Phase 5 — Verify + archive (06:29–06:45).** `/opsx:verify` produced a
completeness/correctness/coherence report (9/9 tasks, 4/4 requirements, 5/5 design
decisions, one WARNING). Then sync delta specs → archive.

## 4. Prompts that worked

- **Goal prompt** — pairing `/skill:openspec-explore` with a plain-language description
  was the right kickoff: it forced discovery before design. Stronger version: *"Explore
  how images render in chat today, list every call site, and tell me which existing
  hooks I can reuse before proposing a change."*
- **High-leverage follow-up: "zoom/pan → yes."** Six words that upgraded the whole
  feature and locked in hook reuse. Adding the quality bar in phase 1 (not after apply)
  is why it stayed cheap.
- **"download some images with browser and read to test in this dashboard session"** —
  a great forcing function for a real end-to-end check. Turns "tests pass" into "I can
  see it work."
- The `/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive` slash-skills carried
  the lifecycle — the operator drove the workflow by *naming the stage*, not
  re-explaining intent each time.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Scope a plain click-to-open dialog | "I would like zoom/pan → yes" | State interaction richness (zoom/pan/Esc/backdrop) in the goal prompt |
| Stay in unit-test land | "download images … read to test in this dashboard session" | Add a "smoke-test with real images in the live chat" task to the plan |
| Reach for a test-only attribute in prod logic (`data-testid` backdrop check) | verify caught it as a WARNING | Prefer a semantic `data-*` attribute for prod click-target detection |

The operator's steering was mostly *stage advancement* (each `/opsx:*` prompt) plus two
substantive redirects: add zoom/pan, and prove it with real images. Both are worth
stating up front.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **consumed** the existing OpenSpec
skill chain (`openspec-explore` / `-ff` / `-apply` / `-verify` / `-archive`) rather than
producing a reusable asset. The reusable win was **architectural, not procedural**:
one `ImageLightbox` component (`DialogPortal` + `useZoomPan`) fanned into 3 call sites,
so any future image surface gets click-to-zoom for free by adding `cursor-pointer` +
`onClick` + the shared component.

If anything deserves capturing as a skill, it's the **jsdom portal-event testing
recipe** from §7 — it cost the bulk of the apply phase and will recur for any
`createPortal`/`DialogPortal` component.

## 7. Pitfalls & dead ends

- **Portal content is invisible to `container.querySelector`.** `createPortal` renders
  into `document.body`, outside the test container. → Query from `document.body`, not
  `container`.
- **`fireEvent.click` on a portal backdrop didn't reach React's onClick.** Multiple dead
  ends chased: native `addEventListener` on a ref (ref not set in `useEffect` inside a
  portal), wrapping in `act`, callback refs. **What finally worked:** a `document`-level
  click listener that identifies the backdrop by its data attribute. → For portal close-
  on-backdrop, listen on `document` and match the target, don't rely on a React handler
  on the portal root.
- **`openspec change new <name>` failed** — the correct scaffold path was
  `mkdir openspec/changes/<name>` + `openspec status --json` to drive artifact order.
- **A `FileReader` paste mock fought the test** (`onload` fired synchronously inside
  React's event dispatch, `dataUrl.split(",")[1]` blew up). → Either wrap in `act` and
  fix the mock's `result`, or assert the `cursor-pointer`/`onClick` wiring directly
  instead of simulating the full paste flow.
- **`data-testid`-driven prod logic** slipped in for backdrop detection — flagged by
  verify. Acceptable but not ideal; use a dedicated `data-*` attribute.
- **vitest green ≠ ships.** Always follow with `npm run build` to catch the TS/compile
  errors the test run doesn't.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-explore` + one-line description → let the AI map every render
      site and name reusable hooks before designing.
- [ ] State interaction richness (zoom/pan, Esc, backdrop-close) **in the first prompt**.
- [ ] `create proposal` → `/opsx:ff` for a small bounded change (design/specs/tasks in one).
- [ ] `/opsx:apply` with TDD; **budget time for the portal-event testing fight**
      (query `document.body`; `document`-level backdrop listener).
- [ ] Extract **one** shared `ImageLightbox` (`DialogPortal` + `useZoomPan`); wire
      `cursor-pointer` + `onClick` into every call site.
- [ ] Run the **full** suite, then `npm run build`.
- [ ] Smoke-test with **real** images: `curl` a few to `/tmp`, `read` them into the live
      session, confirm click/zoom/pan/Esc in the actual dashboard.
- [ ] `/opsx:verify` → address WARNINGs → `/opsx:archive` (sync delta specs, move to archive).

**Inputs to have ready:** the OpenSpec CLI + skill chain; the existing `useZoomPan` hook
and `DialogPortal`; a couple of throwaway image URLs.
**Artifacts produced:** `src/client/components/ImageLightbox.tsx` (+ test), edits to
`ChatView.tsx`, `ReadToolRenderer.tsx`, `CommandInput.tsx`, 4 test files (59 passing),
and the archived change `openspec/changes/archive/2026-04-08-image-lightbox/`.

---

_Generated from session `92f216a8` · `pi-agent-dashboard` · 2026-04-08. Source extract: session facts (image-lightbox)._
