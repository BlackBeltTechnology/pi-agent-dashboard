---
session: 019f4456
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts); large facts sheet (~14988 tok)"
upgrade_status: pending
openspec_changes: [add-embeddable-chat-view]
proposal_excerpt: "`ChatView` (`packages/client/src/components/ChatView.tsx`, 823 LOC) is the root of the dashboard's live agent-timeline UI: streaming text/thinking, tool-call bursts, inline terminals (xterm), file-preview + diff cards…"
---

# How we did it: Ship an embeddable ChatView surface — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was deceptively small:

> *"The code drifted from this proposal. Recheck everything, history and update proposal"*

The real objective grew over nine steering turns into a full feature landing: **take the
dashboard's live `ChatView` and make it a first-class, embeddable surface that an external
React app can consume.** By the end the session had (1) reconciled a stale OpenSpec
proposal against code that main had moved out from under it, (2) implemented a headless
`useSessionState` hook + a `chat-embed` subpath barrel export, (3) built a live isolated
tester app that grabbed a real session off `localhost:8000`, (4) written an external
integration guide, and (5) shipped the whole thing through CI to a squash-merge on
`develop`. One prompt of drift-repair turned into an end-to-end "spec → build → prove →
document → ship" run.

## 2. TL;DR playbook

1. **Verify the spec against reality first.** Before editing a drifted proposal, diff the
   proposal's concrete claims (LOC counts, file counts, dependency lists) against current
   code — `git log` the proposal commit, then check each number. Don't trust the prose.
2. **Name the drift as a table.** Turn "proposal claim vs reality now vs cause commit" into
   a table so the human can see exactly what moved and why (here: TanStack virtualization
   added `@tanstack/react-virtual`, bumped ChatView 701→823 LOC, added 3 subtree files).
3. **Treat carried dependencies as public contract.** When an embed surface transitively
   drags in a new package, say so explicitly — the consumer must resolve it.
4. **Apply the change via `/skill:openspec-apply-change`**, TDD each task: read the exact
   driver code the hook must replicate, write the failing test, then the thin implementation.
5. **Keep the hook a thin router.** Reuse existing exported primitives (`foldLiveEvents`,
   `reduceEvent`, `applyPromptReceived`, …) instead of re-implementing reduction logic.
6. **Guard the `exports` map with a real resolution probe.** After adding `exports`,
   symlink the package into a throwaway `node_modules` and run node's real resolver to prove
   `./package.json` + the subpath resolve and deep paths are blocked.
7. **Prove it live.** Build an isolated Vite tester that imports ONLY the barrel + providers,
   proxies `/ws`+`/api` to `:8000`, and renders a real session end-to-end.
8. **Document for an external consumer**, co-located with the runnable reference app.
9. **Ship** via `/skill:ship-change` (archive + sync specs + PR + CI watch + squash-merge +
   worktree cleanup).

## 3. How the collaboration unfolded

**Phase 1 — Drift reconciliation (Prompts 1–2).** The AI diffed the proposal against the
code at HEAD, found the branch had *no commits ahead of main* and a clean tree — so the
drift came from main advancing after the proposal was written. It recomputed the transitive
dependency graph, confirmed `FilePreviewProvider` self-mounts inside ChatView (not a
host-required provider), and produced a claim-by-claim drift table. The human's single
steering turn — *"But there is new dependencies have to carry"* — caught an under-stated
fact: the drift added `@tanstack/react-virtual@3.13.12`, which the embed consumer must now
carry. The AI verified the exact commit (`311de78f4`) and rewrote the proposal's misleading
"No new runtime dependencies" line into an explicit *carried dependencies* bullet.

**Phase 2 — Implementation via OpenSpec apply (Prompt 3).** With `/skill:openspec-apply-change`,
16 tasks were worked TDD-style. The AI read the exact `useMessageHandler` driver paths
(`event` live-flush vs `event_replay`), confirmed the seq-reset formula (`shouldReset`
computed before folding), then paused via `ask_user` to confirm the public hook's API shape
(the human chose the imperative `{ state, apply, reset }`). It wrote the failing test first,
implemented `useSessionState` as a thin router, then the `chat-embed` barrel (pure `.ts`
re-export, prop types derived via `React.ComponentProps` to avoid editing source). The
highest-risk step — adding an `exports` map — was validated with a real node-resolution
probe in a throwaway `node_modules`.

**Phase 3 — Live proof (Prompts 4–5).** The human asked for *"a simple isolated test APP
which grabs this session with the new component from localhost:8000"*. The AI reverse-
engineered the client WS protocol, built a standalone Vite app importing only the barrel,
and rendered a real session — which happened to be *this very session*, streaming. A
`FST_REPLY_FROM ... ECONNREFUSED 127.0.0.1:5199` error (Prompt 5) was root-caused to two
things: Vite bound IPv6-only (`host` unset), and the tester port had been registered in the
dashboard's server-selector (a client app must never be a "server"). Fixed the bind
(`host: true`), explained the selector mistake.

**Phase 4 — Document + ship (Prompts 6–9).** A detailed external-integration guide
(`INTEGRATION.md`, ~23 KB) was written co-located with the reference tester. Changes were
committed (with a `.gitignore` to keep the Vite dep-cache out), Vite stopped, and the change
shipped via `/skill:ship-change` (CodeRabbit wait skipped per instruction) → PR #266 →
green CI → squash-merge → worktree removed.

## 4. Prompts that worked

- **Goal prompt** — *"The code drifted from this proposal. Recheck everything, history and
  update proposal."* Effective because it names the artifact (proposal), the failure mode
  (drift), and demands evidence (*history*). A stronger version bakes in the verification
  bar: *"…verify every concrete claim (LOC, file counts, deps) against current code and cite
  the commit that caused each drift."*
- **High-leverage follow-up** — *"But there is new dependencies have to carry."* One short
  sentence forced a correctness pass that turned a misleading proposal line into an accurate
  carried-dependency contract. Terse domain knowledge from the human beats a long re-prompt.
- **Live-proof unlock** — *"Make simple isolated test APP which grabs this session with the
  new component from this localhost:8000 server."* Converted an abstract "does the export
  work" into a concrete, falsifiable end-to-end demo.
- **Doc prompt** — *"Create a very detailed markdown doc about how to integrate to an
  external react based client. Put all dependencies, required settings, example…"* Effective
  because it enumerated the required contents (deps, settings, example) so the output was
  complete, not aspirational.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Under-state a transitive dependency ("No new runtime dependencies") | "But there is new dependencies have to carry" | State up front: an embed surface's carried deps ARE public contract; diff `ChatView` old-vs-now for new external imports before claiming none |
| Leave the API shape implicit | (AI asked via `ask_user`; human picked shape A) | For a workspace-public hook, decide the imperative-vs-declarative API shape before writing the test |
| Bind the tester Vite to IPv6-only (`host` unset) → `ECONNREFUSED 127.0.0.1` | Pasted the 500 error verbatim | Set `host: true` (dualstack) in any local tester Vite config from the start |
| Let the tester port get registered as a dashboard "server" | Same 500 error surfaced it | Never select a client-app port in the dashboard server-selector; open the tester directly |
| Let `npm run build` regenerate `plugin-registry.tsx` churn | (self-caught, reverted) | After any build during a feature, `git checkout -- generated/plugin-registry.tsx` before staging |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The work leaned on **existing
skills** — `/skill:openspec-apply-change` (TDD task loop) and `/skill:ship-change`
(archive→sync→PR→CI→merge→cleanup) — plus one `general-purpose` subagent delegated to
write the `docs/embedding-chat-view.md` file in the repo's caveman style (per AGENTS.md
Rule 6, all `docs/` writes go through a subagent).

The **repeatable pattern worth capturing** as a future skill: *"prove an embeddable
package export works by building an isolated Vite tester that imports only the public
barrel and proxies to the live server."* It removes the guesswork from `exports`-map
changes — a real node-resolution probe plus a live render is far stronger evidence than a
type-check. Invoke it whenever adding or changing a subpath export that an external
consumer will resolve.

## 7. Pitfalls & dead ends

- **`FST_REPLY_FROM ... ECONNREFUSED 127.0.0.1:5199`** — not a tester bug per se. Two
  causes: Vite defaulted to IPv6-only (`[::1]`), refusing the dashboard's IPv4 proxy hop;
  and the tester port was registered in the dashboard's server-selector, creating a pointless
  `8000→5199→8000` loop. Fix: `host: true` in `vite.config.ts`, and never treat a client app
  as a dashboard server.
- **Full test suite showed 18 failures** — all pre-existing/environmental (`pi-image-fit`
  jimp `img.write`, a `@tanstack/react-virtual` teardown-timer race in `ChatView.test.tsx`,
  a doctor-route flake). Proven unrelated by running the failing suites in isolation (they
  pass 50/50). If you hit these, run the suite in isolation before assuming your diff regressed.
- **`plugin-registry.tsx` build churn** — `npm run build` regenerates it and can drop a
  demo-plugin fixture entry. Revert it (`git checkout --`) before staging; it's not part of
  the feature.
- **Workspace symlink points at the main repo, not the worktree** — a `require.resolve` from
  the worktree resolved the *main* `packages/client` (which lacked the new `exports`). To
  actually exercise a worktree package change, symlink it into a throwaway `node_modules` and
  resolve there.

## 8. Reproduce it faster — checklist

- [ ] `git log` the proposal commit; diff each concrete claim (LOC, file/dep counts) vs HEAD.
- [ ] Write the drift as a claim/reality/cause table; treat any new carried dependency as contract.
- [ ] `/skill:openspec-apply-change <name>`; confirm the public API shape via `ask_user` before coding.
- [ ] TDD each task: read the exact driver code → failing test → thin implementation reusing existing primitives.
- [ ] Add the `exports` map; verify with a real node-resolution probe in a throwaway `node_modules` (assert `./package.json` + subpath resolve, deep paths blocked).
- [ ] Build an isolated Vite tester importing ONLY the barrel + providers; `host: true`; proxy `/ws`+`/api` to `:8000`; render a live session.
- [ ] Delegate `docs/` writes to a subagent (caveman style); co-locate the external `INTEGRATION.md` with the tester under `examples/`.
- [ ] Revert `plugin-registry.tsx` build churn before staging; add a tester `.gitignore` for the Vite cache.
- [ ] `/skill:ship-change` → archive + sync specs → PR against `develop` → watch CI → squash-merge → remove worktree.

**Inputs to have ready:** a running dashboard at `localhost:8000`, the OpenSpec change name,
gh auth, and the worktree checkout.
**Artifacts produced:** `packages/client/src/hooks/useSessionState.ts` (+test),
`packages/client/src/chat-embed/index.ts`, the `packages/client/package.json` `exports` map,
`docs/embedding-chat-view.md` (+`docs/AGENTS.md` row), and
`examples/chat-embed-tester/` (harness + `INTEGRATION.md`). PR #266, squash SHA `e613a885c`.

---

_Generated from session `019f4456` · `pi-agent-dashboard` · 2026-07-09. Source extract: `/tmp/session_facts.chatembed.md`._
