---
session: 019e7b11
week: 2026/W22
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [inline-raw-html-image-tags, chat-markdown-local-images-and-math, pi-image-fit-extension]
---

# How we did it: Diagnosing & proposing the markdown image-rendering gap — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — "Enter explore mode. Think deeply. Visualize
freely. Follow the conversation wherever it goes." — with a deliberately vague seed:
*images missing from rendered markdown in the dashboard's chat bubbles*. There was no
concrete repro, no stack trace, just a symptom. The real objective, which crystallized
over the steering turns, was: **map the bridge's markdown-image-inliner coverage gaps,
empirically confirm which ones actually break in the browser, and turn the most
tractable gap into a validated OpenSpec proposal** — all without writing feature code
(explore mode forbids implementation). The finished artifact is a strict-validated
`inline-raw-html-image-tags` change proposal, committed and pushed on its own branch.

## 2. TL;DR playbook

1. **Open in explore mode** with the vague symptom. Let the AI enumerate directions
   (where is markdown rendered? what kind of images? missing how?) before it touches code.
2. **Narrow with an A/B/C symptom question.** "Broken-image icon vs. dashed placeholder
   box vs. plain text" — the answer (B: `<img>` rendered but `src` unreachable) instantly
   rules out whole failure classes.
3. **Ground the theory in code.** `rg`/`grep` for `pi-asset:`, `markdown-image-inliner`,
   `rehype-raw`, `allowDangerousHtml` — discover the real architecture (per-session
   `pi-asset:<hash>` scheme + inliner gating) instead of guessing.
4. **Build a coverage-gap matrix** as a Mermaid flowchart: which content origins and
   which token shapes the inliner does/doesn't touch.
5. **Empirically confirm the gaps.** Write ONE assistant response containing 7 labeled
   image variants — because the response itself flows through the real inliner. Then
   query the live DOM (`agent-browser eval` over `document.querySelectorAll('img')`) to
   read each rendered `src`. Confirms Gap 4 (raw HTML `<img>`) and Gap 7 (web 404) as real.
6. **Draft the proposal** off the closest archived precedent
   (`archive/2026-05-03-chat-markdown-local-images-and-math`) so the delta spec mirrors
   the existing capability one-to-one.
7. **Validate strict:** `openspec validate inline-raw-html-image-tags --strict`.
8. **Split & push cleanly.** `jj split` the proposal away from unrelated working-copy
   changes, bookmark, `jj git push` — one branch per concern.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore stance).** The AI resisted jumping to a fix. It laid out
three axes of ambiguity (surface, image type, failure mode) and asked a sharp
multiple-choice question. The human's "B" answer (broken-image icon + alt text) was the
single most diagnostic input in the whole session — it eliminated the `pi-asset:`
unresolved path (which renders a `<span>`, never `<img>`) and pointed straight at
unreachable `src` values.

**Phase 2 — Grounding.** Rather than theorize, the AI `rg`'d the codebase and found the
`pi-asset:<hash>` scheme, the per-session asset registry, and `markdown-image-inliner.ts`.
It rendered the architecture as an ASCII/Mermaid diagram, then a full coverage-gap
flowchart enumerating exactly what the inliner touches (assistant text, closed
`![alt](src)` tokens, local paths) versus what passes through (user messages, tool
results, raw HTML `<img>`, whitespace-in-path, multiline tokens, web URLs).

**Phase 3 — Empirical confirmation (the clever move).** With no repro available, the AI
pivoted from "diagnose the incident" to "prove the gaps." Key insight: *this very
conversation is an assistant turn*, so a markdown payload written in the response flows
through the production inliner. It created 3 test PNGs, wrote a 7-variant test message,
then used the **browser tool** to query the live DOM and read each `<img>.src`. Result:
a clean table — Variant 1 resolved to `data:image/png;base64…`, Variant 5 (raw HTML)
leaked `http://localhost:8000/tmp/…` (Gap 4 CONFIRMED), Variant 4 stayed a broken
external URL (Gap 7). Chat virtualization dropped off-screen messages, so the DOM JSON
snapshot — not a screenshot — became the durable artifact.

**Phase 4 — Design & generate.** The human said "draft proposal." The AI found the
closest archived precedent, scaffolded `openspec/changes/inline-raw-html-image-tags/`
(proposal, design with 7 decisions, tasks TDD-ordered, delta spec with 12 scenarios),
and made the new requirement **symmetric** to the existing markdown-token behavior (same
MIME allowlist, same 5 MB/20 MB caps, shared dedup set, identical idempotency). It
validated `--strict`.

**Phase 5 — Verify & land.** "commit and push" (twice). The working copy held unrelated
`image-fit-extension` scaffold + a `package-lock` bump. The AI used `jj split` to isolate
the proposal into its own commit, bookmarked + pushed it, then `jj rebase`'d the WIP
image-fit work onto `develop` as a separate branch so the two concerns never chained.

## 4. Prompts that worked

- **The goal prompt (explore mode preamble).** Effective because it explicitly *forbids
  implementation* and licenses free investigation + OpenSpec artifact creation. It set a
  "think, don't build" contract the AI honored throughout — the deep architecture mapping
  happened precisely because code-writing was off the table.
- **"create a repsone with an markdown with image linked and check with browser"** (typo
  and all) — the highest-leverage follow-up. It unlocked the empirical phase: instead of
  arguing about which gaps *might* break, the AI exercised the real renderer and read the
  DOM. Rewrite for reuse: *"Write one assistant message with labeled image variants for
  each suspected gap, then query the live DOM with the browser tool to record each
  rendered `<img>.src`."*
- **"draft proposal"** — short, worked because Phase 3 had already produced a confirmed
  gap matrix; the AI had the evidence to scope one tractable change.
- **"commit and push"** — trusted the AI to figure out branch hygiene; it correctly split
  unrelated changes rather than bundling them.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Theorize about failure modes abstractly | "create a response with markdown image linked and **check with browser**" | State up front: "confirm every hypothesis against the live DOM before proposing." |
| Stay in open-ended exploration | "draft proposal" | Set a checkpoint: "once ≥2 gaps are confirmed, scope the smallest into a proposal." |
| Risk bundling unrelated working-copy changes into the push | "commit and push" (AI self-corrected via `jj split`/`rebase`) | Say "one branch per concern; split unrelated diffs" so it's explicit, not lucky. |
| Fight chat auto-scroll / virtualization for a screenshot | (AI pivoted to a DOM JSON snapshot) | Prefer `agent-browser eval` DOM queries over screenshots for virtualized lists. |

Note a real incident surfaced mid-session: an Anthropic `400 invalid_request_error`
("image dimensions exceed max 2000 px for many-image requests") — correctly triaged as a
*different* bug class (upstream API rejection), not a render gap. Good discipline: name
the out-of-scope failure, don't chase it.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was saved this session. The workflow is highly repeatable, though, so
the reusable asset that *should* exist is:

- **A "render-gap empirical confirmation" skill** — given a rendering pipeline with
  gating logic, write one self-flowing test payload covering each suspected gap, then
  read the live DOM to classify actual behavior. It removes the guesswork of "which
  theoretical gap is real" and produces a defensible evidence table for the proposal.
  Invoke it whenever a UI symptom lacks a repro but the code path is known.

The genuinely effective *technique* worth remembering: **the assistant response is itself
a test fixture** — content you write flows through the production inliner, so you can
exercise it without a separate harness. Pair with `agent-browser eval` DOM queries to
survive chat virtualization (off-screen bubbles are unmounted; screenshots miss them).

## 7. Pitfalls & dead ends

- **Chat virtualizes off-screen messages.** Scrolling away unmounted the rendered test
  section, so the screenshot attempt failed. → Capture a DOM JSON snapshot
  (`querySelectorAll('img')` → `{src, alt, naturalWidth}`) at the moment of render; don't
  rely on scroll-back.
- **`curl http://localhost:8000/api/health|/api/sessions` failed** (4 failed commands were
  mostly these + a bad `ls`). → Don't assume a fixed dashboard port/route is up; use the
  browser tool already attached to the live session instead of probing HTTP blind.
- **`ls` of guessed component paths failed** (`packages/client/... vs src/client/...`). →
  `rg -l` for the symbol first; the repo has both `packages/` and legacy `src/` layouts.
- **Unrelated changes in the working copy at push time.** → `jj split` the intended files
  into their own commit and `jj rebase` the rest onto `develop`; never push a mixed diff.

## 8. Reproduce it faster — checklist

- [ ] Enter **explore mode** (implementation forbidden; OpenSpec artifacts allowed).
- [ ] Ask the **A/B/C symptom question** to classify the render failure before touching code.
- [ ] `rg` for the pipeline internals (`pi-asset:`, `markdown-image-inliner`, `rehype-raw`).
- [ ] Draw the **coverage-gap matrix** (content origin × token shape → touched / passthrough).
- [ ] Write **one assistant response** with labeled variants per gap; it flows through the real inliner.
- [ ] `agent-browser eval` the **live DOM** → record each `<img>.src`; build the confirmation table.
- [ ] Scaffold the proposal off the **closest archived precedent**; keep the delta spec symmetric.
- [ ] `openspec validate <change> --strict`.
- [ ] `jj split` → bookmark → `jj git push`; **one branch per concern**.

**Inputs to have ready:** a running dashboard with a live session, the browser tool
attached, and jj configured to push to origin.

**Artifacts produced:**
`openspec/changes/inline-raw-html-image-tags/{proposal,tasks,design}.md` +
`specs/bridge-asset-inlining/spec.md` (strict-validated, pushed on branch
`openspec/inline-raw-html-image-tags`); WIP `image-fit-extension` scaffold pushed
separately on `wip/image-fit-extension-impl`.

---

_Generated from session `019e7b11` · `pi-agent-dashboard` · 2026-05-31. Source extract: deterministic facts sheet._
