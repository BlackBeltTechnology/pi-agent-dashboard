---
session: 019ebd96
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 4 memory(ies); heavy steering (10 user prompts); large facts sheet (~17257 tok)"
upgrade_status: pending
openspec_changes: [resolve-global-prompt-templates-from-dashboard, extract-openspec-as-plugin]
proposal_excerpt: "Two leftover fixes from the now-archived `fix-slash-dispatch-delivery` change. Its Issues 1 & 2 (delivery param, Path D error feedback) already landed; these two did not."
---

# How we did it: Resolve global prompt templates from the dashboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was `/skill:openspec-apply-change resolve-global-prompt-templates-from-dashboard` — apply a small, spec-driven change carrying two leftover fixes: (A) global prompt templates (e.g. `/session-summary` at `~/.pi/agent/prompts/`) should expand from disk instead of falling through to the LLM as raw slash text, and (B) `hasDispatchCommand` needs a getter/Proxy-safe fallback.

But the *real* objective emerged through steering: **don't trust the tasks.md checkboxes or the unit tests — prove the fix end-to-end in a real browser against an isolated dashboard, and do it without letting mDNS discovery contaminate the real running dashboard.** That single requirement turned a 2-file TDD change into a 4½-hour investigation that uncovered *two* additional real bugs — including one that meant the original change never actually worked.

## 2. TL;DR playbook

1. **Apply the change TDD-first**: read the design doc, write failing tests, add the `source: "prompt"` probe in `prompt-expander.ts` Step 3 and the `hasDispatchCommand` `in`-operator fallback in `bridge-context.ts`. Confirm the 40 unit tests pass.
2. **Don't stop at green unit tests.** If the change touches a runtime path (slash-command routing through the live bridge), build an **isolated** dashboard to verify in a browser.
3. **Isolate hard**: dedicated `HOME=/tmp/pi-iso-env`, dedicated ports (`--port 8123 --pi-port 9123`), copy auth + a *uniquely-marked* template, and set **`PI_DASHBOARD_NO_MDNS=1`** on the server.
4. **Discover the mDNS asymmetry**: the *bridge* has no NO_MDNS gate — it always runs discovery in `server-auto-start.ts` and hijacks the explicit `PI_DASHBOARD_URL` onto the real dashboard. Add the symmetric bridge-side gate (TDD, 3 tests).
5. **Clear the jiti cache** (both `node_modules/.cache/jiti` *and* the OS-tmpdir `/var/folders/.../T/jiti`) whenever an extension edit "doesn't take effect" — pi transpiles TS extensions via jiti and caches to tmpdir.
6. **Send a real prompt, inspect what reached the agent.** This is where the E2E earned its keep: `/session-summary` arrived **raw** — proving the fix used the wrong field.
7. **Read pi's actual source** (`agent-session.js` `getCommands()`): the path is at `c.sourceInfo.path`, **not** `c.path`. Fix the probe with a `path` fallback; correct the unit-test mocks (they mocked the wrong shape).
8. **Tear down by port/HOME scope only** — never `pi-dashboard stop` (it defaults to 8000/9999 and will kill the *real* dashboard).
9. Correct the design doc, archive + sync specs (fixing any pre-existing delta-header corruption), commit, PR, watch CI, handle CodeRabbit, squash-merge, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply blocked, then TDD implementation.** The `openspec-apply` skill wasn't found at first (skill-resolution confusion in a worktree). The user prodded twice ("why not found?", "stucked"). Once unblocked, the AI implemented both fixes cleanly via TDD: a parallel `source: "prompt"` probe next to the existing `source: "skill"` probe, and an `in`-operator fallback for `hasDispatchCommand`. 40 tests green. **This looked done.**

**Phase 2 — The user forced an E2E (the decisive redirect).** Prompt 4: *"create isolated pi-dashboard env with dedicated ports and home directory and test with browser."* The AI built the isolated stack (dedicated HOME, ports 8123/9123, copied auth, a marker template) and got the UI loading in the browser. But every spawned session's bridge WebSocket dropped immediately and never reconnected — sends returned "no bridge connection."

**Phase 3 — Two isolation hazards surfaced.** (a) The OpenSpec poller blocked the event loop for 43s, starving the gateway heartbeat → disabled openspec polling. (b) **mDNS pulled a *real* session into the test gateway** — cross-contamination. The server had `PI_DASHBOARD_NO_MDNS=1`; enabling it made the server network-silent.

**Phase 4 — The user named the root cause.** Prompt 6 repeated the ask **plus**: *"The pi-dashboard do not use mDns for bridge and server."* That was the key hint. The AI traced `autoStartServer` → `discoverDashboard` (mDNS) → `connection.updateUrl()`: the **bridge always runs discovery and overrides the explicit URL**, hijacking onto the real dashboard advertising on 9999. The server had an opt-out; the bridge had none. The AI added the symmetric bridge gate (`mdnsDisabled()`), TDD, 3 tests.

**Phase 5 — The E2E caught the real bug.** After clearing a *stale tmpdir jiti cache*, the bridge finally stayed on 9123. Sending `/session-summary` showed the agent received it **raw** — expansion never happened. Root cause in pi 0.78's `getCommands()`: templates expose their path at **`sourceInfo.path`**, not `c.path`. The design doc's "use `c.path`" guidance was simply wrong for pi 0.78, and the unit tests passed only because they mocked the wrong shape. Fixed with a `sourceInfo.path` + `path` fallback and corrected mocks.

**Phase 6 — Land it.** The user drove archival, PR, CI, and CodeRabbit through short prompts. Archival hit pre-existing main-spec corruption (a stray `## ADDED Requirements` header) and a delta miscategorization (a *new* requirement marked `MODIFIED`) — both fixed. CI green, CodeRabbit handled (2 valid fixes applied, 2 false-positives declined with reasons posted), squash-merged, worktree removed.

## 4. Prompts that worked

- **The goal prompt** (`/skill:openspec-apply-change <name>`) is a fine kickoff for a spec-driven change — it loads the design and tasks. Stronger next time: pair it with *"then verify end-to-end in an isolated browser env before archiving,"* so the E2E isn't an afterthought.
- **High-leverage follow-up — Prompt 6**: *"...The pi-dashboard do not use mDns for bridge and server."* This one sentence named the exact mechanism (mDNS hijack) that had burned an hour of log-diving. **When you know the failure mode, state it — don't let the AI rediscover it.**
- **"create isolated pi-dashboard env with dedicated ports and home directory and test with browser"** — a precise, reusable spec for a verification harness. It forced real-world proof and directly exposed the `sourceInfo.path` bug.
- Terse driving prompts (**"commit, create PR, monitor CI"**, **"check codrabbit issues"**, **"merge PR, delete branch and delete worktree"**) worked because the ship-change procedure was already known — one line each moved a whole phase.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust 40 green unit tests as "done" | "test with browser" (Prompt 4) | Treat runtime-path changes as unverified until an isolated E2E proves them |
| Rediscover the mDNS hijack via long log-diving | naming it: "do not use mDns for bridge and server" | When you know the failure mode, say it in the prompt |
| Call `pi-dashboard stop` for the iso env | (self-corrected after killing the real dashboard on 8000) | Never `stop`; kill by port/HOME scope only — `stop` defaults to 8000/9999 |
| Assume its edit loaded when behavior didn't change | (self-corrected: found stale tmpdir jiti cache) | Clear `node_modules/.cache/jiti` **and** `/var/folders/.../T/jiti` before concluding "code didn't load" |
| Follow the design doc's `c.path` guidance literally | the E2E showing raw `/session-summary` | Verify field shapes against pi's actual source, not the design's assumption |
| Apply all 4 CodeRabbit suggestions because "select all" | (self-corrected: 2 were false-positives) | Judge each review comment on merit; post reasons when declining |

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **4 durable memories** were saved — each removes a costly rediscovery:

- **`stop` defaults to 8000/9999** (failure · tool-quirk): prevents accidentally killing the real dashboard during isolated work. Invoke the memory whenever tearing down an isolated env.
- **`getCommands()` returns path under `sourceInfo.path`** (project): the exact pi-0.78 shape (`{path,source,scope,origin,baseDir}`). Saves the whole Phase-5 investigation next time a prompt/skill probe reads a command's path.
- **Bridge mDNS overrides `PI_DASHBOARD_URL`** (failure · tool-quirk + project): the isolation hazard and its fix (`PI_DASHBOARD_NO_MDNS` on both server *and* bridge). Invoke before building any isolated dashboard stack.
- **Isolated-testing gotchas** (project): the consolidated checklist (mDNS, openspec-poll event-loop starvation, jiti cache, port-scoped teardown).

**Skill worth creating:** an `isolated-pi-dashboard-e2e` project skill that scripts the whole harness (dedicated HOME + ports + auth copy + marker template + `PI_DASHBOARD_NO_MDNS=1` + jiti-cache clear + port-scoped teardown). This session rebuilt it by hand ~4 times.

## 7. Pitfalls & dead ends

- **Green unit tests ≠ working feature.** The tests mocked the wrong command shape (`{name,source,path}`), so they passed against a fix that never matched real pi. Only the browser E2E caught it.
- **mDNS hijack.** Explicit `PI_DASHBOARD_URL` is only the *initial* connection; the bridge's mDNS discovery overrides it via `updateUrl()`. Both server and bridge need `PI_DASHBOARD_NO_MDNS=1`.
- **Stale jiti cache in the OS tmpdir.** pi's loader disables the in-memory cache but not the FS cache at `/var/folders/.../T/jiti`. An edit "not taking effect" was really a stale cached transpile. Nuke both jiti caches.
- **`pi ... 2>&1 | tee` kills interactive pi.** Piping stdout makes pi see a non-TTY and exit interactive mode. In tmux, use `tmux pipe-pane` to capture, never pipe pi's stdout.
- **`pi-dashboard stop` defaults to port 8000** — it killed the real dashboard once. Scope teardown to iso ports only.
- **openspec polling can block the event loop** (43s tick) and drop bridge WS heartbeats — disable it in isolated configs.
- **Headless `--mode rpc` bridges churn session IDs** on reconnect; the gateway drops sends whose `sessionId` ≠ the bridge's current one. Re-fetch the session id immediately before each send, or use a stable interactive session.
- **Pre-existing spec corruption** (`## ADDED Requirements` header in a *main* spec) blocks `openspec archive` sync — fix to `## Requirements` and split delta into correct `## ADDED` / `## MODIFIED`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change name, a valid `~/.pi/agent/auth.json` to copy, a uniquely-marked template (e.g. `SESSION_SUMMARY_TEMPLATE_MARKER`), Docker/tmux available, `gh` authed.

- [ ] Apply the change TDD-first; confirm unit tests green (but distrust them for runtime paths).
- [ ] Build isolated env: `HOME=/tmp/pi-iso-env`, ports 8123/9123, copy auth + marker template.
- [ ] Set `PI_DASHBOARD_NO_MDNS=1` on **both** server and bridge; disable openspec polling.
- [ ] Clear both jiti caches (`node_modules/.cache/jiti` + tmpdir) after every extension edit.
- [ ] Spawn a session into the worktree; verify the bridge stays on 9123 (not 9999).
- [ ] Send the real slash command; **inspect what reached the agent** — expanded, not raw.
- [ ] If raw: check the field shape against pi's actual `getCommands()` source (`sourceInfo.path`).
- [ ] Tear down by port/HOME scope only — never `pi-dashboard stop`.
- [ ] Correct the design doc, archive + sync specs (fix any stray delta headers), commit, PR, CI, CodeRabbit, squash-merge, remove worktree.

**Final artifacts:** `packages/extension/src/prompt-expander.ts` (`sourceInfo.path` probe), `packages/extension/src/bridge-context.ts` (`hasDispatchCommand` fallback), `packages/extension/src/server-auto-start.ts` (`PI_DASHBOARD_NO_MDNS` bridge gate) + tests; synced `openspec/specs/command-routing/spec.md`. Merged as PR #104 (squash `bbf00824`).

---

_Generated from session `019ebd96-d41f-7ba6-a6ae-296e962c5457` · `pi-agent-dashboard` · 2026-06-13. Source extract: `/tmp/facts-resolve-global.md`._
