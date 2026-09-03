---
session: 019f4412
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-stuck-tool-card-on-dropped-event]
proposal_excerpt: "A tool card can stay stuck showing `Reading…` (running spinner) indefinitely while the session keeps rendering later cards normally — the agent already finished the tool, but its terminal `tool_execution_end` event ne…"
---

# How we did it: Self-heal a stuck tool card on a dropped terminal event — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened by invoking the **`openspec-apply-change`** skill on an existing change:
`fix-stuck-tool-card-on-dropped-event`. The concrete problem (from the proposal): a tool
card can stay stuck showing `Reading…` (a running spinner) forever while the session keeps
rendering later cards normally — the agent already finished, but the terminal
`tool_execution_end` event never reached the browser (dropped under WebSocket back-pressure
or evicted from the bridge ring buffer). The real objective, which the later steering turns
sharpened, was: **implement the change (a client-side self-heal + drop-site instrumentation),
deploy it to the running dashboard, commit it, then actually verify it against a live stuck
session** — and correct any diagnosis that turned out wrong under real conditions.

## 2. TL;DR playbook

1. `/opsx-apply fix-stuck-tool-card-on-dropped-event` — let the apply skill select the change and read `proposal.md` / `design.md` / `tasks.md` / spec delta.
2. **Read before writing.** Grep the real touch-points across all four packages (client reducer + App wiring, server `browser-gateway` + health route, bridge `connection.ts` buffer + `bridge.ts` heartbeat, shared `protocol.ts`).
3. **TDD the primary fix.** Write a reducer "stuck-card baseline" test + a reconcile-hook test (200 heals, 404 keeps running, re-arms) *before* the hook. Author `useStaleToolReconcile.ts` as a **session/state-scoped interval** (never a per-row `useEffect` — it must survive transcript virtualization), then wire one call into `App.tsx`.
4. **Add drop-site counters** on both hops (server `serverToBrowser` per-session, bridge `bridgeToServer`) and surface them in `/api/health`.
5. **Verify green:** `npm test` (full suite), `npx tsc --noEmit`, `openspec validate <change> --strict`.
6. **Guard surgical diffs:** run Biome only on your changed files; if `--write` reorganizes imports in a large file, **revert and re-apply only your lines** — the repo does not enforce `organizeImports`.
7. **Deploy all three tiers:** `npm run build` (client) → `POST /api/restart` (server) → `npm run reload` (extension). Verify the new `droppedFrames` field is live via `/api/health`.
8. **Commit atomically** (`git add <exact files> && git commit` in one shell step — the index is shared with concurrent sessions).
9. **Verify against the live stuck session:** probe `GET /api/sessions/:id/tool-result/:toolCallId` for every running tool → 200 = server holds the end (recoverable), 404 = deeper drop.
10. **When "refresh didn't help", root-cause the recovery path** — don't repeat the earlier hand-wave. Then correct the change docs to match reality.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the whole blast radius).** The AI selected the change via the
apply skill, read all four context artifacts, then grepped for the real symbols
(`tool_execution_end`, `bufferMessage`, `MAX_WS_BUFFER`, health/diagnostics wiring) across
`client / server / extension / shared`. *Why it worked:* the fix spans four packages; mapping
every touch-point first meant the later edits were surgical, not exploratory.

**Phase 2 — Build the primary fix TDD-first.** Wrote the failing reducer baseline + hook
tests, then `useStaleToolReconcile.ts`: a **session-scoped interval** that scans every
`status:"running"` row, and after `STALE_TOOL_MS` (25 s) fires a one-shot
`GET /api/sessions/:id/tool-result/:toolCallId`. On **200** it synthesizes a
`tool_execution_end` and pushes it through the existing idempotent, `toolCallId`-keyed
reducer path; on **404 / in-flight / evicted** it keeps the row running and re-arms. *The key
design insight:* the heal channel is **HTTP** — deliberately independent of the WS send buffer
whose back-pressure dropped the event, so the heal can't be re-dropped by the same condition.

**Phase 3 — Instrument the drop sites.** Added counters at both hops (server
`browser-gateway` per-session `serverToBrowser`, bridge `connection.ts` `bridgeToServer`),
merged the bridge counter into its heartbeat, and surfaced everything in `/api/health` so the
*next* stuck-card incident is attributable rather than mysterious.

**Phase 4 — Verify + defend the diff.** Full suite green (9589 passing), `tsc` clean,
`openspec validate --strict` clean. A Biome `--write` reorganized imports in `bridge.ts` and
others; the AI checked `biome.json`, confirmed `organizeImports` is *not* enforced, and
**reverted the churn to re-apply only its own lines** — honoring the surgical-changes rule.

**Phase 5 — Deploy + commit (steering: "build and redeploy", "commit").** Client build →
server restart → extension reload; verified the live `droppedFrames` health field; committed
exactly 17 files as `28e0c2b5e` (staged + committed in one step because the git index is
shared with concurrent sessions).

**Phase 6 — Verify against a real stuck session (steering: "in session … there are stuck").**
Probed the tool-result route for all 50 tool calls: **43/50 → 200 (recoverable), 7/50 → 404
(deeper drop / evicted).** This is the moment the fix earned its keep — a real incident,
classified.

**Phase 7 — Root-cause the "hard refresh doesn't help" surprise (steering: "hard refres
doen't helped").** The AI's first explanation (refresh = full replay) was **wrong**. It
systematically checked two suspects — a stale service-worker bundle and the durable replay
cache — proved the reconcile code *was* in the served bundle, and found the real cause: on
reload the client rehydrates from its IndexedDB replay cache and re-subscribes with
`lastSeq = persistedMaxSeq`, so the server delta-replays only newer seqs — the dropped
terminal events have **older** seqs and are never re-sent. Only an **in-app Refresh**
(`subscribe { lastSeq: 0 }`) or a **bridge reconnect re-sync** heals them; a browser reload
does not. It then corrected all three change artifacts (`yes` → go ahead) and committed the
fix as `7bdbeb726`.

## 4. Prompts that worked

- **Goal prompt (the apply skill invocation).** Effective because it handed the AI a
  fully-specified OpenSpec change — proposal, design, tasks, spec delta — so "read the spec,
  then implement" had a real contract to anchor to. *Reproduce it:* always start from a
  written change, not a verbal bug report.
- **`build and redeploy`** — a high-leverage 3-word unlock. Because the change touched all
  three tiers, this correctly triggered the full client-build → server-restart →
  extension-reload matrix. *Stronger version to bake in:* "rebuild all three tiers (client
  build, server restart, extension reload) and verify the new health field is live."
- **`in session 019f43ae… there are stucked`** — pointed the AI at a *real* live incident,
  turning an abstract fix into an empirical verification. *This is the best kind of steering:*
  give the AI a concrete failing case to check its own work against.
- **`hard refres doen't helped`** — five words that invalidated the AI's confident-but-wrong
  recovery claim and forced a real root-cause. *Reproduce it:* when the AI asserts a recovery
  path, test it and report the negative result plainly; it will re-investigate.
- **`yes`** — the one-word go-ahead to correct the now-known-inaccurate docs.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "implemented + committed" | "in session … there are stuck" | State up front: *verify against a live stuck session, not just the test suite.* |
| Assert a recovery path (refresh = full replay) that was wrong | "hard refres doen't helped" | Demand the AI **prove** each recovery claim (probe the actual route / bundle) before stating it as fact. |
| Let a Biome `--write` reorganize unrelated imports | (implicit — the surgical-changes rule) | Run Biome read-only on changed files; only `--write` your own lines; check `biome.json` before trusting an assist. |
| Leave the change docs describing the wrong heal | "yes" (correct them) | When runtime reality contradicts the spec, fix the artifacts (`openspec validate --strict`) in the same session. |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session (a `memory_search` and a `skill_read` were
used for context only). The workflow, however, is highly repeatable and *should* be captured:

- **A "stuck tool card triage" runbook** — given a session id, probe
  `GET /api/sessions/:id/tool-result/:toolCallId` for every running tool, bucket into 200
  (server-recoverable → heals via reconcile timer or in-app Refresh) vs 404 (deeper
  bridge→server drop / evicted → not REST-recoverable), and prescribe the heal (in-app
  Refresh with `lastSeq:0`, **not** Cmd-R). This session did exactly that ad hoc; codifying it
  would remove the re-derivation each incident.
- **The durable-replay-cache gotcha is worth a memory:** a browser reload delta-subscribes
  from IndexedDB (`lastSeq = persistedMaxSeq`) and never re-reads older-seq dropped events —
  only an in-app Refresh (`lastSeq:0`) or a bridge reconnect re-sync does. This tripped the AI
  mid-session and will trip the next operator.

## 7. Pitfalls & dead ends

- **"Refresh fixes it" is false for this bug.** A browser hard-reload rehydrates from the
  durable replay cache and re-subscribes at `lastSeq = persistedMaxSeq`; dropped terminal
  events have older seqs and are never re-sent. Use the **in-app Refresh** control
  (`subscribe { lastSeq: 0 }`) or wait ~30 s for the reconcile timer.
- **Biome `--write` reorganizes imports** even though the repo does **not** enforce
  `organizeImports`. If you `--write` a large file, it will churn the whole import block —
  revert and re-apply only your lines to keep the diff surgical.
- **`biome check --changed` finds nothing on `develop` with uncommitted/untracked files** and
  exits non-zero — a harness artifact, not a lint failure. Verify the real gate parts (tsc,
  full suite, per-file Biome) instead.
- **Tests need an ephemeral HOME** — `HOME=$(mktemp -d) npx vitest run …` avoids polluting /
  reading the real `~/.pi`.
- **`npm run build` builds `@blackbelt-technology/pi-dashboard-web` = `packages/client`,
  serving from `packages/client/dist`** (repo-root `dist/` is nearly empty). Grepping the
  wrong dist path nearly produced a false "my code didn't ship" conclusion — confirm the
  served bundle path before drawing a shipping conclusion.
- **The git index is shared with concurrent sessions** — stage + commit in one step with an
  explicit file list, then verify the commit contains exactly your files.

## 8. Reproduce it faster — checklist

- [ ] Start from the written OpenSpec change; `/opsx-apply <change>`.
- [ ] Map every touch-point across `client / server / extension / shared` before editing.
- [ ] TDD the reconcile hook: session-scoped interval (not per-row), HTTP heal channel, 200-heals / 404-keeps-running / re-arms.
- [ ] Add drop-site counters on both hops; surface in `/api/health`.
- [ ] Verify: `npm test` · `npx tsc --noEmit` · `openspec validate <change> --strict`.
- [ ] Keep the diff surgical: Biome read-only on changed files; revert any import churn.
- [ ] Deploy all three tiers: `npm run build` → `POST /api/restart` → `npm run reload`; confirm `droppedFrames` live in `/api/health`.
- [ ] Commit atomically with an explicit file list; verify no leakage.
- [ ] Verify against a live stuck session; probe tool-result → 200/404 buckets.
- [ ] Prove every recovery claim before stating it; correct the spec if reality differs.

**Key inputs to have ready:** a running local dashboard, the failing session id, an ephemeral
`HOME` for vitest.
**Artifacts produced:** `useStaleToolReconcile.ts` (+ App.tsx wiring), 5 test files,
server/bridge/shared instrumentation edits, corrected OpenSpec artifacts. Commits
`28e0c2b5e` (fix + tests + instrumentation) and `7bdbeb726` (doc correction).

---

_Generated from session `019f4412-bad4-7793-aaab-3125f5347154` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-09. Source extract: session facts sheet._
