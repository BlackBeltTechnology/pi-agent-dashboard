---
session: 019f5860
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [preserve-streaming-tail-selection, preserve-chat-selection-during-churn]
proposal_excerpt: "Follow-up to `preserve-chat-selection-during-churn` (Path B, D4). That change keeps finished-card selections alive but leaves the **streaming tail** at baseline: a selection anchored inside the actively-streaming card…"
---

# How we did it: Preserve a text selection anchored in the streaming chat tail — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened the session with a single skill invocation:

```
/skill:openspec-apply-change preserve-streaming-tail-selection
```

The *real* objective, once the change's proposal and design docs were read: this is a
follow-up to `preserve-chat-selection-during-churn` (Path B, D4). That prior change
keeps selections alive inside **finished** cards, but a selection anchored inside the
**actively-streaming** card still collapsed — every time a chunk was appended, and again
at turn completion (`message_end`). The job was to make a selection in the streaming tail
survive both chunk append and turn completion, with no behavioral regression on the idle
(no-selection) path. Only two prompts were ever given: the apply, then `ship change`.

## 2. TL;DR playbook

1. **Invoke the change apply skill** — `/skill:openspec-apply-change <change-name>`. Let the
   AI read the change's proposal/design/tasks **plus the archived prior change** it builds on.
2. **Demand a plan before code.** The AI produced a freeze-and-hold design mapping each task
   (1.1–1.3, 2.1–2.3) to a concrete mechanism before touching a file.
3. **TDD, red first.** Tests were written against the not-yet-existing behavior, run, and
   confirmed failing — *then* the ~45-line `ChatView.tsx` implementation followed.
4. **When a test fails for a non-obvious reason, instrument, don't guess.** The AI logged
   render counts and `node.isConnected` to discover the failure was a *test-harness* artifact
   (see §7), not a code bug.
5. **Measure the perf claim.** Task 2.3 asked for flush coalescing — the AI produced a
   before/after render count (baseline 5 renders/5 chunks; frozen 0/5) as evidence.
6. **Gate: full suite + build + Biome + tsc.** Run all, then *prove* any red is pre-existing
   by stashing your diff and re-running the base.
7. **`ship change`** — archive + sync specs, commit, push, open PR against `develop`, watch CI,
   wait out CodeRabbit, resolve the inevitable `develop` conflict keeping *both* sides,
   squash-merge, delete branch, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the whole neighborhood).** Before any edit, the AI read the
change's context files, the design doc, `ChatView.tsx`, `MarkdownContent.tsx`, the selection
hook, and — critically — the **archived** `preserve-chat-selection-during-churn` change plus
`event-reducer.ts` (to confirm the committed assistant message's role/shape). *Why it worked:*
the fix had to compose with an existing selection-preservation mechanism; reading the prior
art first is what let the design reuse `tailContainerRef` containment instead of inventing a
new one.

**Phase 2 — Design before code.** The AI stated a freeze-and-hold plan: snapshot
`streamingText` on the `isSelecting` false→true edge when the selection sits in the tail;
render the tail from that frozen snapshot so `MarkdownContent`'s `React.memo` skips re-render
and the committed Text nodes are never replaced; keep the frozen tail mounted across
`message_end` while hiding the committed assistant twin; on collapse, clear the snapshot and
flush to live text. Each bullet mapped to a task id.

**Phase 3 — TDD (red → green).** Tests written first, run, confirmed failing. Then the
implementation. Partial green surfaced a stubborn failure where the captured node reported
`isConnected: false` despite frozen content.

**Phase 4 — Root-cause via instrumentation.** Rather than tweak the code, the AI logged render
counts and content-prop identity and discovered the test itself re-created `ThemeProvider` on
every `rerender`, minting a new context value that re-ran every `MarkdownContent` consumer and
defeated `React.memo` — a flaw that does not exist in production (ThemeProvider sits *above*
ChatView and never re-renders on a chunk). The **test** was rewritten to be production-faithful.

**Phase 5 — Verify.** All 67 ChatView tests, then the full 3239-test client suite, green.
The perf task got a concrete measurement. Biome + tsc were run on the changed files; the only
flags were confirmed pre-existing (proven by stashing the diff).

**Phase 6 — Ship (the second prompt).** `npm test` showed 20 failures across 5 files. The AI
stashed its change, re-ran the base, and showed the failing *set shifts between runs* across
unrelated packages (server endpoints pass in isolation; `image-fit-extension` has a broken
`JimpMime.png` dep that fails on `develop` too) — i.e. pre-existing flakiness, none touching
`ChatView`. It archived + synced specs, opened **PR #289**, watched CI green, waited out a
36-minute CodeRabbit rate limit, triggered a full review (0 actionable threads), resolved a
`develop` merge conflict with the `chat-copy-fidelity-intercept` follow-up by keeping **both**
sides, re-ran CI green, squash-merged (`2e54ea51`), and removed the worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change preserve-streaming-tail-selection`.**
  Effective because it delegates the *entire* apply discipline (read context → plan → TDD →
  verify → mark tasks) to a skill rather than a vague "implement the change." The change name
  is the only variable; everything else is encoded.
- **High-leverage follow-up — `ship change`.** Two words that unlocked the full ship pipeline:
  archive, sync specs, commit, push, PR, CI watch, CodeRabbit wait, conflict resolution,
  squash-merge, worktree cleanup. Works only because the ship discipline lives in a skill.

There were no weak prompts to rewrite — the leverage came entirely from having the apply and
ship workflows pre-encoded as skills, so the operator could steer with single words.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the ship as blocked when the full `npm test` gate was red | (No explicit correction needed — the AI self-verified) but this is the risk point | State up front: "a red full-suite gate is only blocking if *your* diff causes it; prove pre-existing failures by stashing + re-running base, and run suspects in isolation" |
| Potentially wait indefinitely on CodeRabbit | The project policy that a CodeRabbit rate-limit "defers, never blocks" and CI is authoritative | Encode CI-as-authoritative + CodeRabbit-defer in the ship skill (already is) so it doesn't over-wait |
| Risk a non-production test harness masking real behavior | Instrument render counts / `isConnected` before editing code | When a React memo/selection test fails oddly, first ask "is my harness re-creating a Provider above the memoized subtree?" |

The two-prompt session had almost no live correction — the guardrails were pre-loaded via the
skills. The lesson is that **the steering was moved upstream into the skills**, which is why
one word (`ship change`) could carry the whole tail of the workflow.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. Instead, two **existing** skills carried
the load and are the reusable assets to invoke next time:

- **`openspec-apply-change`** — captures the apply discipline (read context incl. prior/archived
  changes → plan mapped to task ids → TDD red-first → implement → verify full suite + Biome +
  tsc → mark tasks). Effective because it turns "implement this change" into a repeatable,
  auditable sequence with a built-in quality gate. Invoke it to realize any OpenSpec change.
- **`ship-change`** — archive + sync specs, commit, push, PR against `develop`, watch CI, wait
  out CodeRabbit, resolve conflicts, squash-merge, remove worktree. Effective because it makes
  "land it" a single word and bakes in the "CI authoritative, CodeRabbit defers" policy plus the
  worktree self-removal fallback. Invoke it once apply is green.

If you find yourself re-explaining the pre-existing-flaky-test triage or the ThemeProvider memo
trap by hand, that's a signal those notes belong *inside* these skills as guardrails.

## 7. Pitfalls & dead ends

- **`React.memo` "not skipping" was a test-harness lie.** The test re-created `<ThemeProvider>`
  on every `rerender`, producing a fresh context value that re-ran all `MarkdownContent`
  consumers and replaced the `<p>`, collapsing the selection (`isConnected: false`). *Fix:* put
  component state **below** a single stable `ThemeProvider` in the test, mirroring production
  where the provider sits above `ChatView` and never re-renders on a chunk.
- **Full-suite `npm test` is flaky under parallel load.** 20 failures across server endpoints,
  `useImagePaste`, and `image-fit-extension`. *Fix:* stash your diff and re-run the base — if the
  failing set shifts and none of the files import your change, they're pre-existing. Confirm by
  running the suspect files in isolation (they pass); `image-fit-extension` fails even isolated
  (broken `JimpMime.png` dep on `develop`).
- **`develop` moves under you.** A parallel `chat-copy-fidelity-intercept` change also touched
  `ChatView` after the same anchor. *Fix:* keep **both** additions (freeze effect + copy
  intercept) — they're complementary, not competing — then re-run the relevant tests + tsc.
- **`gh pr merge --delete-branch` fails at *local* cleanup in a worktree** (worktree/develop
  collision), but the remote squash-merge still succeeds. Verify PR state (`MERGED`), then delete
  the remote branch and remove the worktree separately.
- **Self-removing worktree.** The session's cwd *is* the worktree; removing it via the dashboard
  endpoint (`removed: true`) is the correct final step, but afterward the Bash tool is pinned to a
  deleted directory — no further shell verification is possible. Do all confirmation before the
  removal, or from the parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, a clean worktree on its branch, the prior/
archived change it follows, `gh` auth, and a reachable dashboard endpoint (for worktree removal).

1. `/skill:openspec-apply-change <change-name>` — let it read context + the archived prior change.
2. Insist on a task-id-mapped plan before edits.
3. Write tests first; run; confirm **red**.
4. Implement the minimal surgical diff; run tests to **green**.
5. If a memo/selection test fails oddly → check the harness isn't re-creating a Provider above
   the memoized subtree; keep state below a stable provider.
6. Measure any perf claim (before/after render counts).
7. Gate: full suite + build + Biome + tsc; prove any red is pre-existing by stashing + re-running
   base and isolating suspects.
8. `ship change` — archive, PR to `develop`, CI-authoritative, defer on CodeRabbit rate-limit,
   keep both sides of any `develop` conflict, squash-merge, remove worktree **last**.

**Artifacts produced:**
- `packages/client/src/components/ChatView.tsx` (freeze-and-hold, ~45 lines)
- `packages/client/src/components/__tests__/ChatView.streaming-tail-selection.test.tsx` (new)
- `openspec/changes/archive/2026-07-12-preserve-streaming-tail-selection/` (archived change)
- PR #289 → squash-merged as `2e54ea51`

---

_Generated from session `019f5860-a1de-7bd4-b824-29c3987aa665` · `pi-agent-dashboard/.worktrees/os-preserve-streaming-tail-selection` · 2026-07-13. Source extract: deterministic facts sheet via `extract_session.ts`._
