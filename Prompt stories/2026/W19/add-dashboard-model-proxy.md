---
session: 019e0471
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [add-dashboard-model-proxy, filter-oauth-incompatible-models]
proposal_excerpt: "External services (Honcho memory store, LangChain workers, CI test harnesses, custom apps) need a stable, always-on HTTP endpoint that exposes the same set of LLM models the dashboard's /model selector shows — without…"
---

# How we did it: Ship the dashboard model proxy (`/v1/*`) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the standard `/opsx:apply` prompt:

> *"Implement tasks from an OpenSpec change… Select the change… Get apply instructions… Task list…"*

The **real objective**, once the change was resolved to `add-dashboard-model-proxy`, was to
finish an already-half-built OpenSpec change (**30/76 tasks done, 46 remaining**): a
server-resident **model proxy** that exposes an always-on OpenAI-/Anthropic-compatible
`/v1/*` HTTP endpoint serving the same models the dashboard's `/model` selector shows, with
API-key auth, eager refresh on credential changes, a `/api/health` proxy status field, and an
optional second listen port. The session then went all the way to the finish line: **collect
the change across 5 sibling sessions → commit → verify → sync delta spec → archive**.

## 2. TL;DR playbook

1. `/opsx:apply add-dashboard-model-proxy` — announce the change, read `openspec status --json`
   + `instructions apply --json` to get the task list and progress (30/76).
2. Before writing any code that touches `@mariozechner/pi-ai`, **probe its real exports** —
   `node --input-type=module -e "import * as piAi from '<resolved pi-ai>/dist/index.js'; …"` —
   and lock the shape with a **precondition test** (`pi-ai-shape.test.ts`) that skips gracefully
   when pi-ai can't be resolved under a test `HOME`.
3. Build the core in dependency order: `internal-registry.ts` → `internal-auth-storage.ts` →
   `registry-singleton.ts` (lazy singleton exposing `getModelRegistry`, `refreshModelRegistry`,
   `getModelProxyStatus`, `getStreamSimpleFn`), then the `streamer.ts` wrapper.
4. Wire **eager refresh** at every credential-mutation site (`provider-routes.ts` after PUT,
   `provider-auth-routes.ts` via `notifyBridges()`, `config-api.ts` after `writeConfigPartial`) —
   do **not** invent an arm that doesn't exist (see §5/§7 on `credentials_updated`).
5. Register routes + the `/v1/*` auth gate in `server.ts`; make the JWT `onRequest` hook **skip
   `/v1/*`** so the proxy auth gate owns that path. Add `proxy:{status,reason?}` to `/api/health`.
6. After each cluster of tasks, run the scoped suite with an isolated HOME:
   `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/… --reporter=verbose`, then
   mark tasks done in `tasks.md` in batches.
7. **Collect + commit** across sibling sessions: read the 5 `add-dashboard-model-proxy*` sessions
   from disk, classify every working-tree file as model-proxy vs. the concurrently-mixed
   `openspec-groups`/`honcho` work, split the two mixed files (`SettingsPanel.tsx`, `rest-api.ts`)
   by reset-and-reapply-hunks, then commit only the model-proxy set.
8. `/opsx:verify` → map all 13 requirements to source, run the full suite (187 tests),
   `openspec validate --strict`; then `/opsx:archive` → sync delta spec to a new
   `openspec/specs/model-proxy/spec.md` and move the change to `archive/`.

## 3. How the collaboration unfolded

**Phase 1 — Resume & orient (apply).** The AI read `openspec status`/`instructions apply`,
saw 30/76 done, and read the design + spec + already-written files before touching anything.
*Why it worked:* it re-derived the true remaining surface instead of trusting the checkbox
count, and started from the lowest dependency (the pi-ai shape) upward.

**Phase 2 — Probe the dependency, then pin it with a test.** Roughly a dozen `node -e` /
`cat …/dist/*.d.ts` commands mapped pi-ai's real exports (`getModels`, `streamSimple`,
`registerBuiltInApiProviders`, the OAuth helpers, the `Model` interface). That produced
`pi-ai-shape.test.ts` — 16 tests that assert the shape and **skip gracefully** when pi-ai
can't resolve under the test HOME. *Why it worked:* the proxy is entirely built on pi-ai's
surface; freezing that surface in a test turns an upstream break into a red test instead of a
mysterious runtime failure.

**Phase 3 — Build core in dependency order + wire refresh.** Registry → auth-storage →
singleton → streamer, then eager-refresh calls threaded through every credential write path.
*Decision point:* the task said "wire refresh into `event-wiring.ts`'s `credentials_updated`
arm" — the AI checked and found **no such arm** (`credentials_updated` is outbound
server→bridge), so it did **not** fabricate one and instead covered the real inbound mutation
sites. The `require()`→ESM-import slip and the "expose `streamSimple` via the singleton"
refactor both happened here and were caught by the compile/test loop.

**Phase 4 — Register + auth-gate in server.ts.** Routes mounted after `registerProviderRoutes`;
the JWT hook amended to skip `/v1/*`; `auth.admin?` added to `AuthConfig` + `parseAuthConfig`;
`/api/health` gained `proxy:{status,reason?}`; optional second port wired with lifecycle
teardown. Scoped test runs (71 → later 131) stayed green.

**Phase 5 — Collect across siblings & commit (steering #2).** The human asked to *collect all
sessions attached to `add-dashboard-model-proxy` and commit related changes*. The HTTP-blocking
hook stopped `curl`, so the AI read the 5 sessions from disk. The working tree held **two
concurrent changes mixed together** (model-proxy + openspec-groups/honcho). It classified each
file by diff, **split the two genuinely-mixed files** (`SettingsPanel.tsx`, `rest-api.ts`) via
git reset + reapply-only-model-proxy-hunks, staged the clean set, and committed
`1a855190 feat(model-proxy): add dashboard model proxy /v1/* with API-key auth` (68 files).

**Phase 6 — Verify → sync → archive (steering #3, #4).** `/opsx:verify` mapped 13/13
requirements to source files and passed 187 tests + `openspec validate --strict`. `/opsx:archive`
synced the delta spec into a new `openspec/specs/model-proxy/spec.md` (13 requirements) and moved
the change to `openspec/changes/archive/2026-05-08-add-dashboard-model-proxy/`.

## 4. Prompts that worked

- **Goal prompt** — the `/opsx:apply` command template. Effective because it carries the whole
  contract (select → status → instructions → task list) so the AI resumes a half-done change
  without re-litigating scope. To reproduce, just name the change: `/opsx:apply add-dashboard-model-proxy`.
- **`"go on"`** — a one-word unlock after the AI paused for a status check. High-leverage: it
  authorized the model to keep marching through the task list rather than confirming each task.
- **`"Collect from all sessions which have attached session add-dashboard-model-proxy. Collect
  the changes and commit all related changes"`** — the pivotal steering turn. It reframed the job
  from "finish tasks" to "reconcile a multi-session, multi-change working tree and land a clean
  commit." A stronger version states the split up front: *"The working tree also contains
  openspec-groups and honcho work — commit ONLY the model-proxy files; split any mixed file."*
- **`/opsx:verify` then `/opsx:archive`** — sequencing verify before archive is the effective
  move: verify catches a spec/impl gap while it's still cheap to fix, archive only after green.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "apply" as the whole job and stop at task completion | "Collect from all sessions… commit all related changes" | State the end-to-end goal (apply→commit→verify→archive) in the kickoff |
| Assume the working tree held only this change | (implicit) the collect prompt surfaced two mixed changes | Warn up front: "tree also has X/Y work — commit only model-proxy; split mixed files" |
| Follow a task literally ("wire into `credentials_updated` arm") | Verify the arm exists before wiring | Tell it to grep-verify every named symbol in a task before editing |
| Reach for `curl`/HTTP to read live state | HTTP-blocking hook forced disk reads | Prefer reading sessions/state from disk; the dashboard blocks outbound HTTP in-session |
| Batch-mark tasks done before implementing (3.8) | Revert the premature mark, implement, then mark | Mark a task done only after its scoped test passes |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session, but three **repeatable moves** earned their
keep and should be codified:

- **Dependency-shape precondition test** (`pi-ai-shape.test.ts`). Captures the exact upstream
  surface a feature depends on and skips gracefully when the dep can't resolve. Invoke it
  whenever you build on a third-party module's runtime exports — it converts silent upstream
  drift into a named red test. *Candidate skill: "pin-dependency-shape-with-a-skip-test".*
- **Split-a-mixed-working-tree-by-hunk** (git reset + reapply only the target change's hunks on
  `SettingsPanel.tsx` / `rest-api.ts`). The reusable answer to "two changes got interleaved in
  one file." Invoke when a commit must be scoped to one OpenSpec change but the tree is dirty
  with a sibling. *Candidate skill: "split-mixed-file-by-change".*
- **Isolated-HOME scoped vitest** (`HOME=$(mktemp -d) npx vitest run <path> --reporter=verbose`).
  Makes credential/registry tests deterministic by denying them the real `~/.pi` config. Invoke
  for any test that reads provider/auth/models state from HOME.

## 7. Pitfalls & dead ends

- **`credentials_updated` arm doesn't exist.** The task named an inbound arm in `event-wiring.ts`
  that isn't real (the event is outbound server→bridge). If a task points you at a symbol, grep
  it first; wire refresh into the actual mutation sites (`provider-routes`, `provider-auth-routes`,
  `config-api`) instead.
- **`require()` in ESM.** An early wiring used `require()` — invalid in this ESM server. Fix:
  proper `import`, and expose `streamSimple` through the singleton accessor rather than reaching
  into the registry.
- **`npm test -- --reporter=verbose -- <path>` failed.** The double `--` passthrough didn't work;
  use `npx vitest run <path> --reporter=verbose` directly.
- **Tests read real `~/.pi`.** Without `HOME=$(mktemp -d)`, the pi-ai shape test couldn't resolve
  pi-ai / picked up real config. Always sandbox HOME for these.
- **`curl` blocked mid-session.** An HTTP-blocking hook prevents in-session HTTP; read live/session
  state from disk instead.
- **Premature `tasks.md` check (3.8).** The AI marked a task done before implementing it, then had
  to revert. Only check the box after the scoped suite is green.
- **Mixed-change commit hazard.** Two OpenSpec changes shared the tree; a naive `git add -A` would
  have polluted the commit. Classify every modified file by diff before staging.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (`add-dashboard-model-proxy`); the resolved
path to `@mariozechner/pi-ai`; a clean-enough tree (or a plan to split mixed files); test HOME
via `mktemp -d`.

- [ ] `/opsx:apply add-dashboard-model-proxy` → read `status --json` + `instructions apply --json`.
- [ ] Probe pi-ai exports; write/keep `pi-ai-shape.test.ts` (skip-on-unresolvable).
- [ ] Build in order: `internal-registry` → `internal-auth-storage` → `registry-singleton` → `streamer`.
- [ ] Thread eager refresh through `provider-routes` (post-PUT), `provider-auth-routes` (`notifyBridges`), `config-api` (post-`writeConfigPartial`). Grep-verify any task-named symbol first.
- [ ] `server.ts`: mount `/v1/*` routes + auth gate; JWT hook skips `/v1/*`; `/api/health` gains `proxy:{status,reason?}`; optional second port + teardown; `auth.admin?` in config + parser.
- [ ] After each cluster: `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/… --reporter=verbose`; batch-mark `tasks.md`.
- [ ] Collect the 5 sibling sessions from disk; classify tree files; split `SettingsPanel.tsx` + `rest-api.ts` by hunk; commit only the model-proxy set.
- [ ] `/opsx:verify` (13/13 reqs mapped, full suite green, `validate --strict`) → `/opsx:archive` (sync delta → `openspec/specs/model-proxy/spec.md`, move to `archive/`).

**Final artifacts:** commit `1a855190` (68 files) incl. `packages/server/src/model-proxy/{internal-registry,internal-auth-storage,registry-singleton,streamer}.ts`, `routes/model-proxy-refresh-routes.ts`, `pi-ai-shape.test.ts`; edits to `server.ts`, `auth-plugin.ts`, `config-api.ts`, `provider-routes.ts`, `provider-auth-routes.ts`, `system-routes.ts`, `packages/shared/src/config.ts`, `SettingsPanel.tsx`; and the archived change + new `openspec/specs/model-proxy/spec.md`.

---

_Generated from session `019e0471-2e2b-726e-84a1-94e90a850f2b` · `pi-agent-dashboard` · 2026-05-08. Source extract: deterministic facts sheet._
