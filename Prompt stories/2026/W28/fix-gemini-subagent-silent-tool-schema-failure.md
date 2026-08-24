---
session: 019f5487
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-gemini-subagent-silent-tool-schema-failure]
proposal_excerpt: "Selecting a Gemini model (e.g. `google-vertex/gemini-2.5-pro`) for a **dashboard \"spawn new session\"** with the full toolset produces a silent failure: the session starts, the model never responds, and no error surfaces."
---

# How we did it: Fix Gemini subagent silent tool-schema failure — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash command: `/skill:openspec-apply-change fix-gemini-subagent-silent-tool-schema-failure`. There was no prose brief — the intent lived entirely in the OpenSpec change already on disk. The *real* objective: implement a fully-specified fix for a nasty class of silent failure — a dashboard-spawned Gemini session (`google-vertex/gemini-2.5-pro`) that starts, returns a **thinking-only turn** (`stopReason=stop`, zero visible text, no tool call), then idles forever with no error surfaced anywhere. The change spec called for a provider-agnostic guard that detects the dead turn, either auto-continues (bounded) or surfaces a visible notice in the dashboard, plus server-side logging and a client status affordance. This was a large, cross-cutting change spanning extension → server → client → shared, driven strictly TDD.

## 2. TL;DR playbook

1. **Kick off with the apply skill against a ready change**: `/skill:openspec-apply-change <change-name>`. Let the skill pull the apply instructions and context files — don't re-plan a spec that already exists.
2. **Read before writing**: open the bridge (`packages/extension/src/bridge.ts`), the server event flow (`event-wiring.ts`, `spawned-turn-log.ts`), and the client status path (`event-reducer.ts`, `session-status-visuals.ts`, `SessionCard.tsx`). Find the **captured transcript fixture** to learn the exact message-content shape pi delivers.
3. **Build the risk-free core first (TDD)**: a pure classifier (`turn-actionability.ts`) + shared fixtures + failing unit tests, run with an **ephemeral `HOME=$(mktemp -d)`** so vitest doesn't touch the real profile.
4. **Add the bounded guard** (`empty-actionable-guard.ts` + `-config.ts`): continue-or-surface, retry cap, per-session counter reset on any non-empty turn; env-configurable.
5. **Wire the guard into the bridge** at the `agent_end` handler; emit an `empty_actionable_surface` event (free-string `eventType`, no protocol union change needed).
6. **Thread the surface through server + client**: server log lines with secret redaction; client reducer `notice` field → `hasNotice` flag → `SessionCard` status token (`--status-notice`), mirroring the existing `errorSessionIds` pattern exactly.
7. **Prove the upstream root cause statically**: inspect pi-ai's Google adapter (`streamGoogle`) to show it faithfully assembles parts — so the dead turn is Gemini returning thinking-only with `finishReason=STOP`, not an adapter drop.
8. **Gate**: `npm test | tee /tmp/pi-test.log`, isolate pre-existing failures (Jimp/`pi-image-fit`), typecheck with the repo command, Biome on changed files only, `openspec validate`.
9. **Delegate every `docs/` write to a subagent** (Rule 6, caveman style) — the FAQ entry, never edit `docs/` directly.
10. **Ship**: mark QA/manual tasks deferred, archive + sync specs, commit via a message file, open PR against `develop`, watch CI, apply CodeRabbit's substantive items, re-run flaky jobs, squash-merge.

## 3. How the collaboration unfolded

**Discovery (≈06:15–06:37).** The AI ran the apply skill, pulled the change's context files, then spent ~20 minutes reading the real code: the large `bridge.ts` follow-up mechanism, the thinking/text/tool content-part shapes, the server `server.log` writers and event broadcast path, and the client error/status derivation. Crucially it hunted down the **captured transcript fixture** to ground the classifier in real message shapes rather than guessing. *Why it worked:* the guard is only correct if it matches the exact turn shape pi emits — reading the fixture first removed all speculation.

**Core build, TDD (≈06:37–06:44).** Pure classifier + guard + shared fixtures + failing tests, then green (23 tests). *Decision point:* start with the "risk-free core" (pure functions, no I/O) before touching the stateful bridge — so the hardest logic is proven in isolation. *Effective bit:* the classifier is **shape-only** (stop reason + content parts + error) and never inspects the provider id — that's what makes it provider-agnostic and future-proof.

**Wire-through (≈06:40–06:52).** Guard into the bridge `agent_end` handler; `empty_actionable_surface` event; server redaction + log builders; client `notice` field threaded reducer → visuals → `SessionCard` → `SessionList` → `App.tsx`, mirroring `errorSessionIds`. *Why it worked:* copying an existing working pattern (`errorSessionIds` → `noticeSessionIds`) kept the cross-cutting change mechanical and low-risk.

**Root-cause proof (≈06:52–06:57).** Static inspection of pi-ai's `streamGoogle` adapter showed parts assemble faithfully; combined with the captured `output=1351, reasoning=1351, 0 visible-text tokens`, this proved Gemini itself returned a thinking-only candidate — not an adapter bug. Recorded and marked the investigation task.

**Gate + docs (≈06:57–07:06).** Full suite via `tee`; isolated the 17 pre-existing `pi-image-fit` Jimp failures as untouched; Biome on changed files (new files clean, whole-file warnings pre-existing); `openspec validate` green; AGENTS.md rows added; the FAQ entry delegated to a subagent.

**Ship (≈10:49–11:27, after a long gap).** The operator returned with the steering prompt and the AI drove ship-change: archive + sync, commit via message file, PR #281, CI watch, applied two substantive CodeRabbit items (a 🟠 Major bridge guard-reset, a 🟡 Minor FAQ wording via subagent), re-ran a flaky `EditorFileTree` job, squash-merged. *Dead end at the very end:* the worktree got removed out from under the Bash tool, so the final local-branch delete couldn't run — everything substantive was already done.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-gemini-subagent-silent-tool-schema-failure`. Effective because the change was already fully specified: the one-liner delegates *implementation* to a skill that knows how to pull context and tasks. The lesson: front-load the spec into an OpenSpec change, then the kickoff is a single command.
- **High-leverage follow-up** — `I will tests later, ship-change`. Two words of intent ("ship-change") unlocked the entire land sequence: defer QA/manual tasks, archive, PR, CI, review, merge. Effective because the ship-change skill encodes all the ceremony; the human only had to signal the transition and the deferral policy.

Rewrite of the terse follow-up into a stronger form for next time: *"Defer the manual/QA verification tasks as post-merge, then run ship-change: PR against develop, apply any substantive CodeRabbit items, re-run flaky CI, squash-merge."* — same intent, but states the deferral policy and review bar explicitly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Keep implementing exhaustively without transitioning to ship | "I will tests later, ship-change" | State the ship trigger + a deferral policy up front ("QA tasks are post-merge") |
| Risk touching the live profile when running vitest | (implicit repo convention) | Always run tests with `HOME=$(mktemp -d)` for isolation |
| Want to edit `docs/faq.md` directly | Rule 6 forces a subagent for `docs/` writes | Delegate every `docs/` prose write to a general-purpose subagent, caveman style |
| Treat all test failures as its own | isolate the pre-existing `pi-image-fit`/Jimp failures | `tee` the run, grep FAIL, diff against HEAD before blaming the diff |
| Register a new event in the protocol union | discovered `eventType` is a free string | Confirm whether the surface path needs a type change before editing shared |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session ran on existing ones (`openspec-apply-change`, `ship-change`) and produced code, not tooling. Two **subagents** were spawned, both for docs: one to add the FAQ entry for the Gemini silent turn, one to fix the FAQ auto-continue wording. They're effective because they enforce the repo's Rule 6 (docs writes go through a subagent in caveman style) without the main agent context-switching into prose mode.

*Recommended skill to create:* a **"guard a silent provider turn"** playbook capturing the reusable pattern here — pure shape-only classifier + bounded continue-or-surface guard + mirror an existing `*SessionIds` client flag for the UI affordance. That trio recurs whenever a provider can emit a technically-valid-but-dead turn, and codifying it would skip most of the Discovery phase next time.

## 7. Pitfalls & dead ends

- **Running vitest against the real HOME**: an early test run needed re-running with `HOME=$(mktemp -d)`. If a vitest run behaves oddly or writes to your profile, prepend the ephemeral HOME.
- **`npx tsc --noEmit` at repo root surfaces pre-existing rootDir/test-config errors** that aren't yours — use the repo's actual typecheck command (per-package `tsc -p …/tsconfig.json`).
- **Biome lints whole files**, so changed large files show hundreds of pre-existing warnings. Isolate the **error-level** items and diff against HEAD to prove they're pre-existing before spending time on them.
- **17 `pi-image-fit` (Jimp) test failures are pre-existing** and unrelated to any dashboard change — don't chase them; CI's fresh install is the authoritative gate.
- **Flaky `EditorFileTree.test.tsx`** (jsdom `scrollIntoView`/`waitFor` timing) can redden CI on an unrelated commit — re-run the failed job rather than editing your diff.
- **Squash-merge from inside a worktree breaks cleanup**: `gh pr merge --delete-branch` tries to checkout `develop` locally and collides with the worktree; and removing the worktree pins the Bash tool's cwd to a deleted dir so it can't spawn. Do the final local-branch delete from the parent repo, not the worktree.

## 8. Reproduce it faster — checklist

- [ ] The OpenSpec change exists and is fully specified before you start.
- [ ] Kick off: `/skill:openspec-apply-change <change-name>`.
- [ ] Read the bridge, server event flow, client status path, **and the captured transcript fixture** before writing.
- [ ] Build the pure classifier + fixtures + failing tests first; run with `HOME=$(mktemp -d)`.
- [ ] Add the bounded guard + env config; wire into the bridge `agent_end`.
- [ ] Thread the surface through server (redacted log lines) and client (mirror `errorSessionIds` → `noticeSessionIds`).
- [ ] Prove the root cause statically in the provider adapter; record it.
- [ ] Gate: `npm test | tee /tmp/pi-test.log`, isolate pre-existing failures, per-package typecheck, Biome on changed files, `openspec validate`.
- [ ] Delegate the `docs/faq.md` entry to a subagent (caveman style).
- [ ] Ship: defer QA/manual tasks, archive + sync specs, commit via message file, PR vs `develop`, watch CI, apply substantive CodeRabbit items, re-run flaky jobs, squash-merge — do final cleanup from the parent repo.

**Key inputs to have ready:** the change name, the captured Gemini transcript fixture, an ephemeral `HOME`, and merge/CI access. **Final artifacts:** `turn-actionability.ts`, `empty-actionable-guard.ts` (+`-config.ts`), server `spawned-turn-log.ts`, client `notice`/`hasNotice` thread, tests across all four packages, AGENTS.md rows, FAQ entry — merged as PR #281 (squash `efb28e88`).

---

_Generated from session `019f5487` · `pi-agent-dashboard` · 2026-07-12. Source extract: `/tmp/facts-1784849728N.md`._
