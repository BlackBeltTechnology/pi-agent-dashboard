---
session: 019e7b30
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [pi-image-fit-extension]
proposal_excerpt: "Models have per-image and per-request byte and pixel ceilings (Anthropic ~5 MB / >1568px long edge is server-downscaled; OpenAI ~20 MB with tile math; Gemini ~7 MB inline). When a pi agent calls `Read` on a large scre…"
---

# How we did it: Automatic image resize (pi-image-fit extension) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (openspec-explore skill) with a thinking-partner
stance — no code, just investigation. The real objective surfaced fast: **pi's `Read`
tool attaches images to the model turn, and large screenshots blow past model ceilings**
(Anthropic ~5 MB / >1568px long edge, Gemini tile math, OpenAI ~20 MB). A 12 MB
6000×4000 screenshot either hard-fails the request or gets silently server-downscaled
with tokens wasted. The ask: **can we intercept `Read` and pre-shrink oversized images
so they fit — as a real, shippable, npm-released extension in this monorepo?** By the
end the goal was concrete: a standalone workspace package `@blackbelt-technology/pi-image-fit`
that hooks `tool_call`, resizes on the fly, caches to a temp file, and ships via the
existing npm release pipeline — captured as a full OpenSpec change and scaffolded +
implemented on `develop`.

## 2. TL;DR playbook

1. **Start in explore mode** (`openspec-explore` skill) to map the *interception seams*
   before writing anything — PreToolUse hook vs. custom-tool override vs. post-result.
2. **Force a doc check** ("check doc"): confirm the seam exists — `tool_call` fires
   pre-execution with a **mutable `event.input`**, narrowed via `isToolCallEventType("read", event)`.
3. **Raise the bar to "real shipping feature"** so the AI stops prototyping and reasons
   about install pain, version skew, and *where the code lives*.
4. **Pin the location**: "separate extension, part of this monorepo, npm release required"
   → new workspace package, not bolted into the bridge.
5. **Make it read precedent first** ("read the bridge's existing hook code first") so the
   new package copies `safe()`-wrapped handlers and the observe-only bridge convention.
6. **Fast-forward the artifacts** (`openspec-ff-change`) → proposal + design (D1–D10) +
   specs (10 requirements / 30 scenarios) + tasks (41 checkboxes), validated clean.
7. **Apply** (`openspec-apply-change`): scaffold the package (jimp, zero native deps),
   then implement `policy.ts` / `cache.ts` / `resize.ts` / `extension.ts` + 4 test files.
8. **When a design decision breaks on reality** (jimp has no webp encoder), STOP and
   present options → pick **format-adaptive** output, update D3 + spec, then continue.
9. **Type-check + commit with `[ci skip]`** via jj, move the `develop` bookmark forward,
   push.

## 3. How the collaboration unfolded

**Phase 1 — Explore the seams (Discovery).** The AI diagrammed the `Read("foo.png")`
call path and three interception points: (A) PreToolUse hook that mutates args, (B) a
custom Read tool replacing the built-in, (C) post-result mangling. It reasoned toward (A)
before touching code — the explore-mode stance kept it honest.

**Phase 2 — Ground the seam in docs.** On "check doc" the AI grepped
`docs/extensions.md` and confirmed the `tool_call` event (line 674) fires **before**
execution with `event.input` mutable in place and no re-validation after mutation — a
stronger guarantee than it had assumed. Decision point: **Seam A is pi-native and
documented → use it.**

**Phase 3 — Reframe as a product.** "real shipping feature" changed the shape entirely.
The AI laid out the design space: where does the code live (bridge vs. separate package
vs. dashboard plugin), cross-platform install, version skew, config surface. The human's
"separate extension… npm release will be required" cut through it — new workspace package.

**Phase 4 — Copy repo precedent.** "read the bridge's existing hook code first" made the
AI discover the bridge keeps `tool_call` **observe-only** (forwards, never mutates), so
image-fit would be the repo's *first* `tool_call` mutator — clean separation. It lifted
the `pi.on(event, safe(async …))` handler shape verbatim.

**Phase 5 — Capture as OpenSpec (fast-forward).** `openspec-ff-change` produced proposal
(Why/What/Capabilities/Impact), design with **10 numbered decisions D1–D10** (each with
rationale + alternatives, plus risks, migration, 5 open questions), specs (10 requirements,
30 WHEN/THEN scenarios), tasks (8 groups, 41 checkboxes). Numbering decisions let later
artifacts reference "see D4" instead of restating.

**Phase 6 — Implement (apply).** Scaffolded the workspace (jimp 1.6.1, **zero native
binaries** in the dep tree — the whole point of avoiding sharp), then wrote the four
source modules and four test files mirroring bridge conventions.

**Phase 7 — Reality breaks the design.** Mid-implementation the AI verified jimp's
encoder allowlist in `node_modules/jimp/dist/esm/index.d.ts:266` and found **no webp
encoder** — but D3 mandated webp. It paused, tabled four options (JPEG / format-adaptive /
wasm-webp / switch-to-sharp), recommended **format-adaptive** (PNG-in→PNG-out,
else→JPEG), got the human's "B", updated D3 + spec, then finished.

**Phase 8 — Land it.** Type-check clean, jj-colocated commit `deceebc2` with `[ci skip]`,
moved `develop` bookmark forward, pushed to `origin/develop`.

## 4. Prompts that worked

- **Goal kickoff — explore mode.** Entering via `openspec-explore` framed the whole
  session as *thinking first*, which produced the seam analysis before any premature code.
  A future operator should open the same way for any "can we intercept X?" question.
- **"check doc"** (2 words, high leverage) — forced the AI to verify its mental model
  against `docs/extensions.md` instead of trusting assumptions; it found the mutation
  guarantee was *stronger* than assumed.
- **"real shipping feature"** (3 words) — the single biggest lever. Flipped the AI from
  prototype-mode to product-mode (install, versioning, code location).
- **"separate extension, it is part of this monorepo. npm release will be required"** —
  removed all ambiguity about *where* and *how it ships* in one line.
- **"read the bridge's existing hook code first"** — forced precedent-grounding before
  writing, so the new package matched repo conventions instead of inventing its own.
- **"B"** — a one-character unlock that resolved the webp/jimp design fork instantly
  because the AI had already tabled labelled options.

Weak-prompt rewrites: `a` and `B` only worked because the AI had *pre-labelled* the
choices. A future operator should keep answering with the option letter — but the AI
should always present a labelled option table first so a one-char reply is unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reason from assumptions about the hook API | "check doc" | State "verify against `docs/extensions.md` before proposing a seam" up front |
| Treat it as a prototype/spike | "real shipping feature" | Say "this ships as a released npm package" in the goal prompt |
| Leave the code-location question open | "separate extension… npm release required" | Name the target (new workspace package) in the kickoff |
| Risk reinventing handler conventions | "read the bridge's existing hook code first" | Tell it to copy `packages/extension/src/bridge.ts` patterns before writing |
| Follow the design (D3 webp) even when the lib can't do it | (AI self-caught, presented options; human picked "B") | Add a task step: "verify the encoder/output format is actually supported by the chosen lib before locking D3" |
| Stop at 2/4 artifacts (explore-mode + skill boundary) | Issued the next skill (`openspec-ff-change`, then `openspec-apply-change`) | Expect skill-gated stops; drive the workflow forward with the next skill prompt |

## 6. Skills, tools & memory created — and why they're effective

No new reusable skill or memory was saved in this session — the work rode existing
OpenSpec skills (`openspec-explore` → `openspec-ff-change` → `openspec-apply-change`).
The reusable **asset produced** is the change itself: `openspec/changes/pi-image-fit-extension/`
with a decision log (D1–D10) and 30 testable scenarios, plus the scaffolded
`packages/image-fit-extension/` workspace.

**A skill that *should* be created:** a "scaffold-a-new-monorepo-pi-extension" procedure
capturing the repeatable moves seen here — copy `packages/extension` archetype (dual-org
peerDeps, `safe()`-wrapped `pi.on` handlers, observe-vs-mutate bridge convention), pick a
**pure-JS image lib (jimp) to keep zero native deps**, wire the workspace into the npm
release pipeline. That would remove the ~20 grep/`node -e` probes this session spent
re-discovering jimp's API surface and the bridge's handler shape.

## 7. Pitfalls & dead ends

- **jimp has no webp encoder.** D3/spec mandated webp; jimp 1.6.1 only writes
  `bmp/gif/jpeg/png/tiff`. If you hit this: switch to **format-adaptive** output
  (PNG-in→PNG-out lossless, else→JPEG q85) and update the design decision + spec —
  do NOT reach for sharp (native deps defeat the whole design).
- **Verify the lib's API by walking its `.d.ts`, not by guessing.** The session burned
  many `node -e`/grep probes on jimp's class methods and encoder allowlist
  (`node_modules/jimp/dist/esm/index.d.ts`). Read the type defs directly and early.
- **The bridge is observe-only for `tool_call`.** Don't try to mutate images inside the
  bridge — it forwards events to the dashboard and must not rewrite them. Put the mutator
  in its own extension package.
- **Explore/skill mode stops at boundaries.** The AI correctly halted at 2/4 artifacts
  and again before plowing 43 apply tasks. This is expected — advance with the next skill,
  don't wait for it to auto-continue.
- **Manual verification tasks can't be auto-run.** Tasks needing a live pi session /
  Electron QA VM / >5 MB image fixture were flagged, not executed. Plan to close those by
  hand.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo checked out on `develop`; `openspec` CLI; jj (colocated) or
git; npm workspaces configured; awareness of model image ceilings.

1. Open in **explore mode** → map interception seams; confirm `tool_call` mutates
   `event.input` in place (`docs/extensions.md` line ~674).
2. State the product bar up front: **"real shipping npm-released extension, separate
   workspace package in this monorepo."**
3. Read `packages/extension/src/bridge.ts` — copy `safe()`-wrapped `pi.on` handlers; note
   the bridge is observe-only.
4. `openspec-ff-change` → proposal + design (number decisions D1–Dn) + specs (WHEN/THEN
   scenarios) + tasks; `openspec validate` clean.
5. `openspec-apply-change` → scaffold `packages/image-fit-extension` (jimp, **zero native
   deps**), then `policy.ts` / `cache.ts` / `resize.ts` / `extension.ts` + tests.
6. **Verify the image lib supports your output format before coding it** — jimp has no
   webp; use format-adaptive (PNG→PNG, else→JPEG q85). Update the design decision + spec.
7. `npx tsc --noEmit` clean; jj commit `[ci skip]`; move `develop` bookmark; push.

**Final artifacts:** `openspec/changes/pi-image-fit-extension/{proposal,design,tasks}.md`
+ `specs/pi-image-fit/spec.md`; `packages/image-fit-extension/` (package.json, tsconfig,
vitest.config, `src/{policy,cache,resize,extension}.ts`, `src/__tests__/*.test.ts`);
commit `deceebc2` on `origin/develop`.

---

_Generated from session `019e7b30` · `pi-agent-dashboard` · 2026-05-31. Source extract: `/tmp/session_facts_dMPYVQ.md`._
