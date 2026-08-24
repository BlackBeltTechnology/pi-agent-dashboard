---
session: 019dc8e5
week: 2026/W17
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts); large facts sheet (~11564 tok)"
upgrade_status: pending
openspec_changes: [add-extension-ui-decorations, fix-slot-fallback-masks-content, extension-ui-system, add-extension-ui-modal, add-dashboard-shell-slots-runtime, extract-flows-as-plugin]
proposal_excerpt: "Phase 2 of the Generalized Extension UI System (see design `extension-ui-system`). Implements five live in-page decoration slots that extensions can register via the same `ui:list-modules` probe established in Phase 1:"
---

# How we did it: Add Extension UI Decorations (Phase 2 slots) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `/opsx:ff` slash command:

> "Fast-forward through artifact creation — generate everything needed to start implementation."

Behind that generic wrapper, the real objective was concrete: ship **Phase 2 of the
Generalized Extension UI System** — five live in-page decoration slots
(`footer-segment`, `agent-metric`, `breadcrumb`, `gate`, `toast`) that extensions
register via the same `ui:list-modules` probe established in Phase 1, wired end-to-end
across the `shared → extension (bridge) → server → client` stack, tested, documented,
manually smoke-verified in a real browser session, and finally archived through
OpenSpec. It grew one scope branch mid-flight: a **production chat-view bug** surfaced
during deploy and spun off its own change, `fix-slot-fallback-masks-content`.

## 2. TL;DR playbook

1. `/opsx:ff add-extension-ui-decorations` → scaffold + create `design.md`, `specs/…/spec.md`, `tasks.md` (proposal pre-existed).
2. `/opsx:apply` → implement bottom-up by layer: **shared schema first** (`types.ts`, `protocol.ts`, `browser-protocol.ts`), then bridge, server, client — tests-first at each layer.
3. Add the `ext_ui_decorator` single-union message to **both** protocol unions and a type-level membership test.
4. Extend the bridge probe to partition modules vs decorators; add a 50 ms leading+trailing throttle (= 20 Hz `ui:invalidate` cap).
5. Server: cache decorators on `Session.uiDecorators` keyed `${kind}:${namespace}:${id}`, extend `replayUiState`.
6. Client: dispatch in `useMessageHandler`, build 5 slot components, mount as **siblings** (never inside `?? fallback` chains).
7. `npm test` → establish the develop baseline (69 pre-existing failures) so you can prove **zero new regressions**.
8. `build and deploy`: `npm run build` → `curl -X POST /api/restart` → `npm run reload`.
9. Manual smoke via a throwaway one-file pi extension in `/tmp` wired into `~/.pi/agent/settings.json`; **spawn a fresh session** to load it, verify all 5 slots in the browser, then clean up.
10. `/opsx:archive` → sync 6 ADDED requirements to main specs, archive.

## 3. How the collaboration unfolded

**Phase A — Scaffold (Discovery).** `/opsx:ff` created `design.md` (10 decisions),
`specs/extension-ui-system/spec.md` (6 ADDED requirements, 17 scenarios), and a
36-checkbox `tasks.md`. The AI first read the **Phase-1 implementation** to understand
what it was extending — the effective move that made every later layer additive rather
than a rewrite.

**Phase B — Implement bottom-up (Build).** `/opsx:apply` drove a strict layer order:
shared schema → bridge → server → client, **writing tests before each layer**. Two
self-corrections landed here: the first rate limiter let the first 20 events through
before throttling, so it was rewritten as a proper leading+trailing throttle; and a
Phase-1 test that asserted *synchronous* re-probe had to be migrated to fake timers
because the new throttle defers to a trailing edge (the contract "invalidate triggers
re-probe" still held).

**Phase C — Baseline & prove-no-regression (Verify).** The full client suite showed
failures. Instead of chasing them, the AI **stashed the change and re-ran on develop** —
confirming *69 failing tests already exist on develop*, identical count. That single
`git stash` move converted "did I break something?" into a provable "zero new
regressions," and all 66 new tests passed.

**Phase D — Deploy & the bug branch (Steer).** The human said `build and deploy`. After
reload, they reported *"I reloaded, a bug was fixed. What other things I have to check?"*
and pointed to the fix session id. The AI traced an `App.tsx` `ContentViewSlot` edit:
`(<ContentViewSlot/> : null) ?? sessionDetail` — the JSX **element is always truthy**, so
`?? sessionDetail` never fired and the chat view rendered blank. It correctly diagnosed
the bug as **orthogonal** to Phase 2 (it came from the plugin-architecture change) and,
when the human said `both`, spun off `fix-slot-fallback-masks-content` with a behavior
test **and** a repo-lint test that scans `App.tsx` for the anti-pattern. Getting that
lint regex right took ~6 iterations (see §7).

**Phase E — Manual smoke via throwaway extension.** The `/smoke:*` commands live in the
**bridge process**, not the browser, so they couldn't be pasted into devtools. The AI
wrote a self-contained one-file pi extension in `/tmp/pi-decorator-smoke/`, wired it into
`~/.pi/agent/settings.json`, and learned two pi quirks live: extensions load via
`jiti.import(path, { default: true })` (needs a **default export**, not `activate`), and
`/reload` re-imports code but does **not** re-read `settings.json#packages` — so a
**fresh session** is required to pick up a newly-added package. Fresh session
`019dca28…` registered all 5 decorators + 1 modal; the human confirmed four slots
visually (`1. yes 2. yes 3. yes 4. yes`).

**Phase F — Archive.** `/opsx:archive` synced 6 ADDED requirements into the main
`extension-ui-system` spec (Phase-1 requirements preserved verbatim), archived to
`archive/2026-04-26-add-extension-ui-decorations/`, all 36 tasks done.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:ff …`) — worked because the change name already carried a
  pre-written `proposal.md`; the slash command just fast-forwarded the remaining
  artifacts. A stronger kickoff for a *cold* start: name the change AND state the layer
  contract, e.g. *"FF `add-extension-ui-decorations`; it's Phase 2 of the extension UI
  system — 5 decoration slots wired shared→bridge→server→client, additive to Phase 1."*
- **High-leverage follow-ups** — these tiny prompts each unlocked a lot:
  - `build and deploy` → triggered the full build → restart → reload chain.
  - `both` → authorized both the fix *and* capturing it as an OpenSpec change in one word.
  - `1. yes 2. yes 3. yes 4. yes` → closed out the manual smoke checklist in one line.
- **The pointer prompt** — *"The bug fixed in session 019dc93e…"* — handed the AI an exact
  session id to trace instead of describing the symptom. Feeding a concrete artifact id
  is far higher-leverage than prose.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation, treating deploy as optional | `build and deploy` | Make `build → restart → reload` a standing step of every apply that touches runtime code. |
| Treat a surfaced bug as "check later" | *"a bug was fixed. What other things I have to check?"* | Proactively run the post-reload regression checklist and diff recent edits after any reload. |
| Consider only fixing the bug in place | `both` (fix **and** capture as OpenSpec) | Default to spinning a `fix-*` change + regression test for any production bug found mid-flight. |
| Assume `/reload` picks up a new extension package | (repeated failed reloads) | Remember: new `settings.json#packages` load only on a **fresh session**; `/reload` re-imports existing code only. |
| Push the human to hunt a nameless session in the sidebar | (couldn't find it) | Give the smoke session a clear name up front (`session.setName("📍 SMOKE TEST …")`) before asking for visual confirmation. |

## 6. Skills, tools & memory created — and why they're effective

- **Repo-lint regression test** — `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts`.
  Scans `App.tsx` for the `(<XSlot/> : null) ?? fallback` anti-pattern and fails CI with
  `file:line`. It captures a **class** of bug (a JSX element is always truthy, so `??`
  never reaches the fallback) that no type-checker or behavior test would catch. Invoke
  the pattern whenever a new slot consumer (`command-route`, `anchored-popover`, …) gets
  wired into a fallback chain.
- **Throwaway smoke extension** — `/tmp/pi-decorator-smoke/extension.js`.
  A reusable recipe for exercising bridge-side UI wiring end-to-end: register all
  decorator kinds + a modal + live-update commands (`bump-counter`, `remove-toast`,
  `burst`), wire into `~/.pi/agent/settings.json`, spawn a fresh session, verify, delete.
- **A subagent** (`general-purpose`) synced Phase-2 specs — offloading the mechanical
  delta-spec merge.

*Recommended skill to formalize:* a **"deploy + manual-smoke a bridge UI feature"** skill
that codifies the throwaway-extension + fresh-session + cleanup loop, since it's clearly
repeatable and carries two non-obvious pi quirks.

## 7. Pitfalls & dead ends

- **`openspec new change` failed** (❌) — the change dir already existed from a prior
  proposal. If FF errors on `new change`, the scaffold is already there; skip to artifact
  creation.
- **Rate limiter let the first 20 events through** — a naive "count then throttle" limiter
  isn't a rate cap. Use a leading+trailing throttle (one probe per 50 ms).
- **Phase-1 sync-reprobe tests broke** under the new throttle — expected; migrate them to
  fake timers rather than reverting the throttle.
- **The lint regex took ~6 iterations** — it bled across hundreds of lines (non-greedy
  match), tripped on `onClose={() => …}` arrows (the `>` char), and false-positived on
  sibling `<ToastSlot/>`. Fix: **cap the slot-tag span (~300 chars)** and restrict the
  inter-token vocabulary between `/>` and `??` to `[\s:)null]`. Always confirm a lint
  catches the bug by **temporarily reverting the fix** and watching it fail at the right
  `file:line`.
- **69 "failing" client tests** are a **pre-existing develop baseline**, not your
  regression — `git stash && npm test` on develop to prove it before you spend time.
- **`/reload` won't load a new extension package** — only re-imports already-loaded code.
  Spawn a fresh session.
- **`pi.events` / `/smoke:*` live in the bridge**, not the browser — you cannot paste them
  into devtools; you need a real loaded extension.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a pre-written `proposal.md` for the change; a running dashboard
server (`/api/health` = production); write access to `~/.pi/agent/settings.json` for the
smoke extension.

- [ ] `/opsx:ff <change>` — scaffold design/spec/tasks (skip `new change` if dir exists).
- [ ] `/opsx:apply` — implement bottom-up (shared → bridge → server → client), tests-first.
- [ ] Add `ext_ui_decorator` to **both** protocol unions + a type-membership test.
- [ ] Bridge: partition probe, 50 ms leading+trailing throttle (20 Hz cap).
- [ ] Server: cache on `Session.uiDecorators`, extend `replayUiState`.
- [ ] Client: dispatch + 5 slot components mounted **as siblings**, each returns `null` when empty.
- [ ] `git stash && npm test` on develop → record the baseline failure count; prove zero new regressions.
- [ ] `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`.
- [ ] Smoke: one-file `/tmp` extension (default export!) → wire `settings.json` → **fresh session** → verify → name it → confirm → clean up.
- [ ] `/opsx:archive` — sync ADDED requirements to main spec, archive.

**Artifacts produced:** `openspec/changes/archive/2026-04-26-add-extension-ui-decorations/`;
5 slot components under `packages/client/src/components/extension-ui/`; 66 tests across 6
files; `fix-slot-fallback-masks-content` change (behavior + lint regression tests);
`docs/architecture.md` + `AGENTS.md` updated.

---

_Generated from session `019dc8e5-8087-709e-b92f-e7a5cfac69e1` · `pi-agent-dashboard` · 2026-04-26. Source extract: `/tmp/facts-q2Yiig`._
