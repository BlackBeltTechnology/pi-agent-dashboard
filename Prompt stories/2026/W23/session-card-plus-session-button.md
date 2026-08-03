---
session: 019e9447
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (18 user prompts); large facts sheet (~13349 tok)"
upgrade_status: pending
openspec_changes: [session-card-plus-session-button, generalize-worktree-init-hook]
proposal_excerpt: "Today the session card has three lifecycle actions, all of which require the parent session to be ended: `▶ Resume`, `⑂ Fork`. Live sessions have no on-card spawn affordance — to start a sibling session in the same fo…"
---

# How we did it: Add `+Session` and `+Worktree` buttons to the session card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single command: **`/skill:openspec-apply-change session-card-plus-session-button`**. There was no prose brief — the *proposal already existed* and the ask was "implement it."

The real objective, once the proposal and the steering turns clarified it: **give the session card an on-card spawn affordance for live sessions.** Today the card's lifecycle actions (`▶ Resume`, `⑂ Fork`) all require the parent session to have *ended*; a running session had no way to launch a sibling from its own card. Over 18 steering turns this grew into **two** buttons — a **`+Session`** (clean same-folder sibling) and a **`+Worktree`** (create-or-reuse a git worktree, bootstrap it, then spawn inside it) — plus a UI-wide `Spawn → +Session` relabel, all landed via the full OpenSpec apply→archive→PR→CodeRabbit loop.

## 2. TL;DR playbook

1. **Kick off with the apply skill against the existing proposal:** `/skill:openspec-apply-change <change-name>`. Let it read `proposal.md` / `spec.md` / `tasks.md` first.
2. **In a worktree, pin the OpenSpec source explicitly:** tell the agent up front *"OpenSpec files live in this worktree; skills and commands resolve from the parent repo."* This prevents it hunting for `SKILL.md` in the wrong tree.
3. **Implement DRY:** add the prop + button to `SessionCard.tsx`, wire it through the *single* existing `onSpawnSession` / `WorktreeSpawnDialog` machinery in `SessionList.tsx` — reuse, don't reinvent.
4. **Mirror existing test patterns:** append to `SessionCard.test.tsx` and add a routing-test file cloned from the existing worktree-dialog harness. Run with `HOME=$(mktemp -d) npx vitest run <files>`.
5. **Verify in an isolated Vite dev server on :3000** (`npm run dev`) that proxies `/api`+`/ws` to the live `:8000` backend — **never take over the shared server** or touch other worktrees.
6. **Watch the viewport trap:** `useMobile()` flips to mobile below **600px height**; set the agent-browser viewport (e.g. 1440×950) *before* navigating so `matchMedia` reads desktop.
7. **Fold every steering-driven change back into `proposal.md` + `tasks.md`**, check the test-covered tasks, then `openspec archive` + sync the delta spec.
8. **Ship:** revert dev-server side-effect files, commit surgically, push, open the PR against `develop`, fix the `tsc` lint error, then run the CodeRabbit autofix loop.

## 3. How the collaboration unfolded

**Phase 1 — Orient (OpenSpec source in a worktree).** The agent started `openspec-apply-change`, but the session runs *inside a worktree* (`.worktrees/os-session-card-plus-session-button`). The human immediately steered: *"Use the worktree parent directory's openspec"* → then refined *"the openspec itself be used in this directory, the skills and commands be used in parent."* The effective move: **read the proposal/spec/tasks from the worktree cwd, resolve skills/commands from the main repo root.** This is the OpenSpec-in-worktree convention and it's worth stating unprompted.

**Phase 2 — Implement `+Session` (DRY through one helper).** The agent added an `onSpawnSibling` prop + always-visible `+Session` button to `SessionCard.tsx` (not gated on `status==="ended"`), then wired it in `SessionList.tsx` to the **single** existing `handleSpawnSession` helper — reusing `requestId` minting and `attachProposal` omission. It mirrored existing fork/resume tests. All 86 tests passed (12 new).

**Phase 3 — Isolated visual verification (the careful part).** The human warned: *"yes, but careful! it is in worktree, some file may missing."* The agent probed and discovered the **running dashboard server was rooted in a *different* worktree** (`os-classify-process-list-entries`), serving *its* `dist/client/`. A naive `npm run build` + `/api/restart` would have rebuilt the wrong bundle and risked 15 live sessions. Instead it started **Vite on :3000 proxying to the untouched :8000 backend** — zero risk. Then hit the **viewport trap**: cards rendered mobile because the browser was 577px tall; `useMobile()` keys on height < 600px. Fix: set viewport to 1440×950 *before* navigating (CDP override doesn't re-fire `matchMedia` after load).

**Phase 4 — Scope expansion to `+Worktree`.** The human spotted that `+Session` doesn't create a worktree and asked for a companion `+Worktree` button. The agent grounded first: **the `WorktreeSpawnDialog` already does everything** (create worktree, bootstrap/`npm install`, proposal-aware routing) — it was just only reachable from the folder header. It wired the card button to reuse both dialogs with **zero new state**: with-proposal → `setWorktreeForChange`, without → `setWorktreeDialogCwd`.

**Phase 5 — Polish loop (5 tight steering turns).** "Buttons too large" → shrink all four pills uniformly. "No plus sign required" → drop literal `+` from labels (icon already conveys it), fixing the `+ +Session` double-plus. "Worktree icon on sessions not in a worktree" → gate render on `!session.gitWorktree`. "Actives only when worktree feature on?" → confirmed the `gitWorktreeEnabled` gating chain by *reading the code*, not guessing. A design question ("copy proposal files into worktree?") → the agent argued **against** hardwiring a copy (wrong layer, coupling smell) and the human agreed on the **git-native** path (commit proposal → base worktree off that branch). Recorded as a project memory.

**Phase 6 — Fold, archive, ship.** Folded the relabel + polish into `proposal.md`/`tasks.md` (checked, test-covered), archived the change + synced the delta spec (2 requirements, 11 scenarios) into `session-card-subcards/spec.md`. Reverted two dev-server side-effect files to keep the commit surgical, pushed, opened **PR #73**. Fixed a `tsc` lint error (`status:"running"` isn't a valid `SessionStatus` → `"streaming"`). Ran the CodeRabbit autofix loop (1 minor: added an empty-string-proposal routing test). Stopped by killing the :3000 dev server; `:8000` never touched.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change session-card-plus-session-button`. Effective because the proposal already existed: the skill supplies the whole implement→test→verify structure. A stronger kickoff would have *added the worktree context up front*: "Apply this change; OpenSpec artifacts are in this worktree, resolve skills from the parent repo, and verify in an isolated dev server without touching the shared :8000 server."
- **High-leverage steering** — *"yes, but careful! it is in worktree, some file may missing."* Nine words that triggered the agent to probe server topology *before* building, avoiding a disruptive restart of 15 live sessions.
- **Scope-expanding follow-up** — *"maybe '+Worktree session' button is also required, which create a worktree first (if it does not exists) and create a session within that worktree (with the initialization process)."* Concrete enough that the agent could map it onto the existing `WorktreeSpawnDialog` instead of reinventing.
- **A doubt-as-prompt** — *"Is worth to copy that files to workspace or too high risk for errors?"* Framing the design question as a risk trade-off got a reasoned *don't-do-it* answer plus a recorded convention, instead of a silent implementation.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hunt for OpenSpec `SKILL.md`/commands in the worktree | "openspec in this directory, skills/commands in parent" | State the worktree resolution rule in the kickoff prompt |
| Proceed to build/restart against the shared server | "careful! it is in worktree, some file may missing" | Always probe server-root topology before any build/restart in a worktree |
| Treat `+Session` as sufficient | "it is not creating worktree… +Worktree session button also required" | Clarify in the proposal whether spawn == same-folder or worktree |
| Ship oversized 4-pill row | "the buttons are too large" | Size pills for the worst case (4 pills) from the start |
| Keep literal `+` in label next to a plus icon | "No plus sign required" (+ screenshot) | Icon *or* text conveys the plus — never both |
| Show `+Worktree` on sessions already in a worktree | "Worktree icon be on sessions which not belongs worktree" | Gate on `!session.gitWorktree` |
| Consider copying `openspec/changes/` into the worktree | "too high risk for errors?" → git-native instead | Commit the proposal, base the worktree off that branch |
| Read `"everywhere"` as a literal global replace | showed which "Spawn" strings are safe to change | Replace *visible* text only; never identifiers/testids/`spawn_session` protocol |

Quality bars the human imposed: **surgical commits** (revert dev-server side effects), **verify claims by reading code** (the gating chain), and **isolation** (the shared server is sacrosanct).

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (project · convention):** *Do NOT hardwire copying `openspec/changes/<name>/` into the worktree-spawn path (`POST /api/git/worktree` or the card/folder +Worktree button). It couples a generic git primitive to OpenSpec semantics; instead commit the proposal and base the new worktree off that branch (git-native inheritance).* Effective because it settles a recurring design temptation once and prevents re-litigation — the next agent that reaches for a file-copy shortcut gets steered to the correct layer.

**No skill was created, but two are warranted:**
- **`verify-worktree-ui-isolated`** — the "start Vite on :3000, proxy to :8000, never touch the shared server, set viewport ≥1440×950 before navigating" recipe. It removes ~10 min of rediscovery (server-topology probe + the `useMobile` height trap) every time worktree UI needs a live check. *(A project skill `isolated-ui-verification` already exists covering this — invoke it instead of rediscovering.)*
- The **viewport/`useMobile` gotcha** specifically (mobile below 600px height, CDP override must precede navigation) deserves a tool-quirk memory.

## 7. Pitfalls & dead ends

- **Subagent delegation broke** (`@fast` role unresolvable in this env) — the docs-row update had to be done inline in caveman style. If `Agent`/subagent spawn fails, do the small edit directly; don't loop.
- **Shared server lives in another worktree** — `npm run build` + `/api/restart` here would rebuild the wrong bundle and disrupt 15 live sessions. Probe `lsof -a -p <pid> -d cwd` first; use the Vite-proxy path instead.
- **`useMobile()` height trap** — cards render *mobile* below 600px viewport height (not width). A 577px-tall window silently hides the desktop-only buttons. Set viewport tall **before** navigating; a post-load CDP resize won't re-fire `matchMedia`.
- **`curl localhost:3000/...` returns the SPA index fallback**, not your component — meaningless for verifying a served edit. Check the DOM in the browser instead.
- **`status:"running"` is not a valid `SessionStatus`** (`active|idle|streaming|ended`) — a test using it fails `tsc --noEmit` in CI though vitest passes. Use `"streaming"` for a live-but-not-ended session.
- **`pi-image-fit` JPEG-resize test flaked** at 5163ms vs the 5000ms cap under concurrent load (dev server + browser running). Re-run in isolation to confirm it's not your regression.
- **Stray `newText_dup`/`newText_x` keys** kept sneaking into edit calls — redo the edit cleanly when it happens.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an existing OpenSpec proposal for the change; a running dashboard on `:8000`; a worktree checked out for the change; `gh` authenticated for the PR.

**Checklist:**
1. `/skill:openspec-apply-change <change>` — state in the same breath: OpenSpec in worktree, skills from parent, isolated verification only.
2. Add prop + button to `SessionCard.tsx`; wire through the single `onSpawnSession` / `WorktreeSpawnDialog` in `SessionList.tsx` (zero new state).
3. `HOME=$(mktemp -d) npx vitest run <SessionCard.test.tsx> <routing-test>` — mirror existing patterns.
4. `npm run dev` → Vite :3000 proxying to :8000. Set agent-browser viewport 1440×950 **before** navigating. Verify via `data-testid`, screenshot; don't click destructive actions.
5. Fold steering changes into `proposal.md`/`tasks.md`; check test-covered tasks.
6. `openspec archive <change>` + sync the delta spec into the main spec; `openspec validate`.
7. Revert dev-server side effects (`.pi/settings.json`, `generated/plugin-registry.tsx`); commit surgically; push; `gh pr create --base develop`.
8. `npm run lint` (`tsc --noEmit`) — fix type errors; run the CodeRabbit autofix loop; kill the :3000 dev server when done.

**Final artifacts produced:**
- `packages/client/src/components/SessionCard.tsx`, `SessionList.tsx` (buttons + wiring)
- `packages/client/src/components/__tests__/SessionCard.test.tsx`, `SessionList.card-spawn-worktree.test.tsx`
- `openspec/changes/archive/2026-06-05-session-card-plus-session-button/` + synced `openspec/specs/session-card-subcards/spec.md`
- UI-wide `Spawn → +Session` relabel across client components
- **PR #73** → `BlackBeltTechnology/pi-agent-dashboard` (base `develop`)

---

_Generated from session `019e9447-8fc9-7cc2-a4ce-4a9aa2aa38e9` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-05. Source extract: `facts sheet (session-card-plus-session-button)`._
