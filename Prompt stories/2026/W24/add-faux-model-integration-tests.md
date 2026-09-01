---
session: 019ec80d
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~10487 tok)"
upgrade_status: pending
openspec_changes: [add-faux-model-integration-tests]
proposal_excerpt: "The dashboard's entire reason to exist is monitoring and driving live pi sessions: a prompt goes in, a model streams text / thinking / tool calls back, the bridge forwards those events, the server fans them out, and t…"
---

# How we did it: A deterministic faux-model integration test layer — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single slash command:

```
/skill:openspec-apply-change add-faux-model-integration-tests
```

Behind that command sat a substantial, 25-task, **test-only** OpenSpec change. The real
objective: build an integration test layer that exercises the dashboard's whole reason
to exist — the round-trip **prompt → model → streamed events → bridge → server → `/ws`
→ client renderer** — but do it **deterministically and without an API key**, by
driving pi's built-in *faux* provider instead of a live model. Concretely, the session
had to (a) make a scriptable faux model actually selectable and routable inside a real
pi session, (b) prove prompts round-trip through the server integration harness, (c)
prove the client renderer matrix mounts on faux-derived events, and (d) add a VM smoke
test — all without touching any production source. The two later prompts steered it to
completion: archive the change, then commit + PR + watch CI.

## 2. TL;DR playbook

1. **Kick off apply**: `/skill:openspec-apply-change add-faux-model-integration-tests` — let the skill read the proposal/design and enumerate the 25 tasks.
2. **Probe the riskiest unknown FIRST, empirically.** Before building anything, write a throwaway `-e` extension fixture and run `pi --list-models` + a print-mode prompt to answer: *does the faux model become selectable and route to scripted text?* Don't design on top of an unverified assumption.
3. **Nail the faux recipe**: `registerFauxProvider({ api: "faux", … })` alone is NOT enough — it only registers a stream impl. Pair it with `pi.registerProvider("faux", { api: "faux", streamSimple })`, where `streamSimple` is pulled from `getApiProvider("faux")` so the stream is embedded and survives `--mode rpc` rebind. Model token: **`faux/faux-1`**. Use an isolated `HOME=$(mktemp -d)` to dodge the bridge's default-model gate.
4. **Build shared fixtures under `qa/fixtures/`**: `faux-provider.ext.ts` (the extension) + `faux-scenarios.ts` (the `SCENARIOS` catalog both test layers consume) + `README.md`.
5. **Write §2 server integration test**: spawn a real `pi` subprocess + bridge, snapshot pre-existing session ids *before* spawning (avoid the session-discovery race), POST prompts via REST `/api/session/:id/prompt`, assert `/ws` events (text via `message_update`, status via `updates.status`, usage via `stats_update`, lifecycle via `agent_start`/`agent_end`, plus abort, model error, 2-session isolation, ask_user round-trip).
6. **Write §3 client renderer test**: assert authoritative registry dispatch identity (`getToolRenderer(name) === ExpectedRenderer`) AND render real `ChatView` from faux-derived messages to prove each renderer mounts without crashing.
7. **Add §4 VM smoke** (`qa/tests/10-faux-model.sh`): connect the node driver first, snapshot sessions, then spawn pi directly — mirror the §2 race fix; register in `run-all.sh`.
8. **Verify + typecheck**: `openspec validate`, both suites green, and crucially `npm run lint` (= `tsc --noEmit`, which IS in CI). Fix pi-ai type-import errors by importing the namespace and casting off `any` with local minimal types — the whole repo already avoids static pi-ai type imports.
9. **Archive → commit → PR → watch CI**: `/skill:openspec-archive-change …`, then Conventional-Commit, PR against `develop`, monitor `gh run` until green.

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The apply skill selected the change and read its context files, revealing a 25-task test-only spec. The AI kicked off a parallel investigation of the faux provider API, the server test harness, and the client renderers rather than reading serially.

- *Why it worked:* fanning read/grep across the three subsystems the change touches gave a full mental model cheaply before any code was written.

**Phase 2 — Empirical probe of the make-or-break assumption.** The AI singled out task 1.4 — *is `faux/faux-1` actually selectable and routable?* — as the foundational unknown and wrote a throwaway probe fixture. First result: `--list-models` was empty. It iterated: added `pi.registerProvider("faux", { api: "faux" })` → model appeared; ran a prompt → got a *real* model's text (bridge auto-load + config interference); isolated with `HOME=$(mktemp -d)` and `-ne` → scripted faux text. Recipe confirmed in isolation.

- *Why it worked:* the whole change is a tower built on this one mechanism. Proving it with a 20-line probe before building fixtures avoided designing on sand.
- *Decision point:* accept the `registerFauxProvider` + `pi.registerProvider` pairing plus isolated HOME as the canonical recipe.

**Phase 3 — Generate fixtures + server suite (the hard part).** Fixtures landed, but the AI hit the deepest bug of the session: in `--mode rpc` the prompt failed with `"No API provider registered for api: faux"`. It hypothesized module duplication, disproved it (print mode worked, rpc didn't → rpc's `rebindSession` clears the api-registry), and fixed it by embedding the stream *directly* via `getApiProvider("faux")` → `pi.registerProvider({ streamSimple })` so it survives rebind. Then five §2 tests were built against *captured* event shapes, fixing a session-discovery race (snapshot ids before spawning) and a status-location bug (`updates.status`, not `session.status`).

- *Why it worked:* every assertion was designed against real captured event shapes, not guessed field names.

**Phase 4 — Client matrix + VM smoke.** The AI chose an authoritative approach for §3 — registry dispatch identity checks + real `ChatView` renders — because stable testids weren't uniform across renderers. §4 reused the §2 race fix. It deliberately did NOT run the smoke against the live dashboard on :8000 (would inject a session into the user's env).

**Phase 5 — Verify, typecheck, land.** `openspec validate` + both suites green + a clean git diff. The subtle catch: `npm run lint` is `tsc --noEmit` and IS in CI; static pi-ai type imports don't resolve (published `index.d.ts` re-exports with `.ts` extensions). The AI matched the repo's blessed pattern (namespace import + `any` cast + local minimal types), then confirmed the server suite *skips* (not fails) when pi is absent. Steering turn 1 archived the change (with a sync-specs decision), turn 2 committed, opened PR #127, and watched CI go green (lint ✓, test ✓, build ✓, 7m53s) — proving the real-pi server suite runs on CI, not skips.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-faux-model-integration-tests`. Effective because it delegated task enumeration and sequencing to a skill; the human didn't have to hand-hold the 25-task plan. A good kickoff when a well-formed OpenSpec change already exists.
- **High-leverage follow-up** — `commit. create PR and monitor CI`. Three words that unlocked the entire land sequence (Conventional Commit → push → PR against `develop` → `gh run watch`), and importantly asked the AI to *monitor* — surfacing the CI proof that the real-pi suite runs headless.
- **Archive follow-up** — `/skill:openspec-archive-change …`. Clean because the apply phase had already left tasks 25/25 done; archive just needed the sync-specs decision (answered via `ask_user`).

Rewrite for next time: the goal prompt is already strong. Consider prefixing with a one-line constraint — *"test-only, touch no production source"* — so the scope bar is explicit from turn 1 rather than inferred from the proposal.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human / reality had to steer by… | Bake this in next time by… |
|---|---|---|
| Write fixtures into the **main repo** while the change lived in a worktree with no `node_modules` | The worktree convention (each worktree gets its own `node_modules`) forced a move + main-repo cleanup | State up front: "work in the worktree; each worktree self-installs deps" |
| Assume `registerFauxProvider()` alone makes the model selectable | Empirical `--list-models` (empty) → add `pi.registerProvider` | Save the faux recipe as a memory (done) |
| Trust the api-registry entry to survive `--mode rpc` | `"No API provider registered for api: faux"` → embed stream via `getApiProvider` | The saved memory captures the rebind quirk |
| Read `session.status` for busy→idle | Captured `session_updated` showed status in `updates.status` | Always assert against captured event shapes, not guessed fields |
| Discover "the new session" via first `session_added` | 2-session isolation race → snapshot ids *before* spawn | Reuse the snapshot-before-spawn pattern in every multi-session test |
| Statically import pi-ai types | `tsc --noEmit` (CI lint) failed — `.ts`-extension re-exports don't resolve | Namespace import + `any` cast + local minimal types (repo convention; saved as memory) |
| Consider running the VM smoke live | A dashboard was already on :8000 — would pollute the user's env | Never live-test smokes against a running dashboard |

Quality bars the human/protocol imposed: **no production source touched** (kept the change test-only; even reverted an auto-rewritten `.pi/settings.json`), and **docs writes under `docs/` delegated to a subagent** in caveman style per protocol.

## 6. Skills, tools & memory created — and why they're effective

Two durable **project memories** were saved (no new skill):

1. **Faux-model test-fixture recipe** — captures that making `faux/faux-1` selectable AND routable needs `registerFauxProvider({api:"faux",…})` *plus* `pi.registerProvider("faux",{api:"faux",streamSimple})` with the stream pulled from `getApiProvider("faux")` so it survives `--mode rpc` rebind, and that an isolated `HOME` dodges the bridge default-model gate. *Why effective:* this took the whole discovery/probe phase to derive — it removes hours of empirical spelunking for anyone adding faux-driven tests. *Invoke when:* writing any deterministic pi-session test.
2. **pi-ai type-import quirk** — `@earendil-works/pi-ai`'s published `dist/index.d.ts` re-exports members with `.ts` extensions that don't resolve under the repo's `moduleResolution: bundler`, so static pi-ai type imports fail `tsc --noEmit`. *Why effective:* explains why the whole repo avoids those imports and points to the namespace-import + `any`-cast workaround. *Invoke when:* a new file needs pi-ai types and CI lint fails.

Two **subagents** were spawned per protocol: one to add file-index rows for the new test files, one to sync the faux delta spec into main specs — keeping the main agent out of `docs/` and spec-sync mechanics.

Recommended skill to create: a **`faux-session-test`** project skill that scaffolds the fixture pair + the snapshot-before-spawn harness, since this round-trip pattern is now the blessed way to test the dashboard deterministically.

## 7. Pitfalls & dead ends

- **`registerFauxProvider` alone → empty `--list-models`.** Add `pi.registerProvider("faux", { api: "faux", … })`.
- **rpc mode → `"No API provider registered for api: faux"`** even though print mode worked. Root cause: `rebindSession` clears the api-registry. Fix: embed the stream directly via `getApiProvider("faux")` into `pi.registerProvider({ streamSimple })`. (Not module duplication — that hypothesis was tested and rejected.)
- **Fixtures written to the main repo** instead of the worktree (which had no `node_modules`). Move them; run `npm install` in the worktree.
- **2-session isolation race**: the second session's browser sees the first's `session_added` first. Snapshot existing session ids before spawning, then pick the new one.
- **Status assertion read the wrong field**: it's `updates.status`, not `session.status`; the message carries `sessionId` (not nested `session`).
- **ask_user assertion too strict**: the bridge wraps the answer as `User responded: "a"` — assert on that wrapped form.
- **`tsc --noEmit` (CI lint) fails on static pi-ai type imports.** Use namespace import + `any` cast + local minimal types.
- **Don't run the VM smoke against a live dashboard** on :8000 — it injects a session into the user's environment.

## 8. Reproduce it faster — checklist

**Inputs to have ready**

- A well-formed OpenSpec change (proposal/design/tasks) describing the test layer.
- A worktree with its own `node_modules` (`npm install` inside it).
- pi on PATH; ability to spin an isolated `HOME=$(mktemp -d)`.

**Steps**

- [ ] `/skill:openspec-apply-change <change>` — enumerate tasks.
- [ ] Probe the faux recipe with a throwaway `-e` fixture: `registerFauxProvider({api:"faux"})` + `pi.registerProvider("faux",{api:"faux",streamSimple:getApiProvider("faux")…})`, isolated HOME, `--list-models` then print-mode prompt. Confirm `faux/faux-1` streams scripted text.
- [ ] Build `qa/fixtures/`: `faux-provider.ext.ts` + `faux-scenarios.ts` + `README.md`.
- [ ] §2 server test: snapshot session ids before spawn; REST prompt; assert `/ws` events (`message_update`, `updates.status`, `stats_update`, `agent_start/end`, abort, error, isolation, ask_user).
- [ ] §3 client test: registry dispatch identity + real `ChatView` render from faux messages.
- [ ] §4 `qa/tests/10-faux-model.sh` (driver-connects-first race fix); register in `run-all.sh`.
- [ ] Verify: `openspec validate`, both suites green, **`npm run lint`** (tsc) clean, server suite *skips* when pi absent.
- [ ] Keep the diff test-only (revert any auto-rewritten config); delegate `docs/` rows to a subagent.
- [ ] `/skill:openspec-archive-change …` (decide spec-sync), then Conventional-Commit, PR against `develop`, watch `gh run` to green.

**Final artifacts produced**

- `qa/fixtures/faux-provider.ext.ts`, `qa/fixtures/faux-scenarios.ts`, `qa/fixtures/README.md`
- `packages/server/src/__tests__/faux-session.integration.test.ts` (5 tests)
- `packages/client/src/components/__tests__/faux-renderers.integration.test.tsx` (17 tests)
- `qa/tests/10-faux-model.sh` + `run-all.sh` registration
- Archived change + synced spec `openspec/specs/faux-model-integration-tests/spec.md`
- Commit `35d439f8`, PR #127 (CI green)

---

_Generated from session `019ec80d-acca-7905-a005-7a947ed3f8a6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-15. Source extract: session facts sheet (add-faux-model-integration-tests)._
