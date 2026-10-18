# Test Plan — update-pi-core-1-3-adopt-apis

Stage: design   Generated: 2026-10-18

No open clarifications.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-core-version-check: lockstep floor | BVA | L1 | automated | `piCompatibility` min `1.3.0`, rec `1.3.0`; running `1.2.0` / `1.3.0` / `1.3.1` | `computeCompatibility()` | `1.2.0` → `error` naming `1.2.0` and `1.3.0`; `1.3.0` → no error, no hint; `1.3.1` → no error |
| E2 | pi-core-version-check: governed pins coherent | decision-table | L1 | automated | repo after the bump; then fixtures drifting one pin each (pi-tui override `1.1.0`; a peer `>=1.1.0`; `minimum` `1.1.0`) | `verify-release-deps.mjs` (coherence test) | coherent → pass; each drift → fail naming exactly that location |
| E3 | CI workflow pin equals the Dockerfile pin | EP | L1 | automated | `docker/Dockerfile` `@1.3.0`; `.github/workflows/ci-e2e-browser.yml` lines with `@1.3.0`, then one line left at `@1.1.0` | `e2e-browser-workflow-contract.test.ts` (E3) | all equal → pass; the drifted line → fail |
| E4 | Node floor row for the new minimum | EP | L1 | automated | `piCompatibility.minimum = "1.3.0"` | `bundled-node-meets-pi-floor` lookup | row `{major:22, minor:19}` found; bundled Node satisfies it |
| E5 | below-floor session flag | BVA | L1 | automated | minimum `1.3.0`; sessions report `1.1.0`, `1.3.0`, `0.73.1` (fork), and nothing | server session update (`pi-version-update-handling` X3) | flag set for `1.1.0` and `0.73.1` with `{minimum:"1.3.0"}`; none for `1.3.0` or unreported |
| E6 | settings: sessionShareDestination typed key | EP | L1 | automated | settings file without the key | PATCH `sessionShareDestination` = `"auto"`, `"gist"`, `"radius"`, then `null` | each value is written verbatim; `null` deletes the key; every other key is deep-equal before and after |
| E7 | settings: invalid enum value | EP | L1 | automated | PATCH `sessionShareDestination = "s3"` (and `true`) | settings route | `400` with a per-field error on `sessionShareDestination`; file byte-identical |
| E8 | settings parity with pi 1.3.0 docs | EP | L1 | automated | installed pi 1.3.0 `docs/settings.md`; schema with 50 typed keys | `pi-settings-schema-parity.test.ts` | passes; `sessionShareDestination` documented default `"auto"` equals the schema default |
| E9 | settings form row | EP | L1 | automated | file without `sessionShareDestination` | render PiSettingsPage Form mode | one row in "Sessions and context": segmented control with `auto` / `gist` / `radius` plus default; shows pi default `auto`; no "Changed" marker |
| E10 | single-bang idle send | EP | L1 | automated | idle mock pi; `pi.exec` returns stdout `hi`, exit 0 | `send_prompt` `!git status` | `pi.sendUserMessage` called once with a string starting `$ git status` and options exactly `{ deliverAs: "followUp" }` |
| E11 | single-bang busy send | EP | L1 | automated | bridge streaming state true; `pi.sendUserMessage` mock rejects when options lack `deliverAs` | `send_prompt` `!ls` | the call carries `{ deliverAs: "followUp" }`; no call without options; no rejection recorded |
| E12 | double-bang and exec template still silent | decision-table | L1 | automated | `!!ls`; exec template `executable: bash` without `excludeFromContext`; exec template with `excludeFromContext: false` | handler | first two → `bash_output` only, no `sendUserMessage`; third → `sendUserMessage` with `{ deliverAs: "followUp" }` |
| E13 | drain gate decision table (pure `followup-drain.ts`) | decision-table | L1 | automated | combinations: buffer empty / `hasPendingMessages` true / `isIdle` false / all pass | drain call | empty → no calls; pending → no pop, no send; not idle → no pop, no send, no timer scheduled (`vi.getTimerCount() === 0`); all pass → order `shift` → `emitQueueUpdate` → `sendUserMessage` |
| E14 | drain content shapes and bytes | EP | L1 | automated | entries `{text:"plain"}` and `{text:"describe", images:[PNG]}` (5 MiB) | two drains | first sends the bare string `"plain"`; second sends the `[text, image]` content array; neither passes options; the buffer byte total drops by the entry's size |
| E15 | drain trigger moves to agent_settled | state-transition | L1 | automated | `bridgeFollowUp = [{text:"a"}]`, idle probe true, fake timers | forwarders receive `agent_end` only, then `agent_settled` | after `agent_end` + timer flush: no send, buffer unchanged; after `agent_settled` + flush: `sendUserMessage("a")` once |
| E16 | auto-retry chain drains once | state-transition | L1 | automated | buffer `[{text:"a"}]`; event sequence `agent_start, agent_end(error)` ×2, `agent_start, agent_end`, `agent_settled` | forwarders + timer flush | exactly one `sendUserMessage("a")`, after `agent_settled` |
| E17 | aborted settle drains next entry | state-transition | L1 | automated | buffer `[{text:"a"}]`; `agent_settled {aborted:true}`; idle true; pending false | forwarders + timer flush | `sendUserMessage("a")` once; the abort latch is already cleared when it is called |
| E18 | busy at drain → next settle | state-transition | L1 | automated | buffer `[{text:"a"}]`; first `agent_settled` with `isIdle` false; second with `isIdle` true | two settles + flushes | first: no pop, no send, no retry timer; second: `sendUserMessage("a")` once |
| E19 | system follow-up enqueue | state-transition | L1 | automated | `enqueueSystemFollowup("continue")` called (a) while idle, (b) while busy and followed by `agent_settled` | timer flush | (a) sent within one macrotask; (b) not sent until after `agent_settled`, then sent once |
| E20 | Retry turn gets the context fragment | EP | L1 | automated | injector with `attachedChange` set; event `{messageType:"custom", message:{customType:"pi-dashboard:retry"}, systemPrompt:"…\nCurrent working directory: /x"}` without `prompt` | `before_agent_start` handler | returns `systemPrompt` containing the sessionId and the attached change name, with the trailing cwd line replaced |
| E21 | custom-message event tolerated by every handler | decision-table | L1 | automated | `{messageType:"custom", message, systemPrompt, systemPromptOptions}` without `prompt` / `images` | kb-extension doctrine hook, roles bridge, untrusted-content guard, path-gate capture, team guard | no handler throws; each one's documented mutation is applied (doctrine inserted, guideline pushed, resources captured) |
| E22 | team guard filters skills on a Retry turn | EP | L1 | automated | policy granting skill `a`; `systemPromptOptions.skills` = `[a, b]`; two consecutive custom-message starts | team-guard `before_agent_start` | after each start `skills` equals `[a]` (fresh filter per start) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | dashboard follow-up delivered after settle | state-convergence | L3 | automated | docker harness, faux provider streaming a 2 s reply | POST `/api/session/:id/prompt` `"follow-1"` (followUp) during the stream | the queue chip shows `follow-1` while streaming, then clears; the transcript ends assistant reply → user `follow-1` → its assistant reply; exactly one `follow-1` user bubble |
| F2 | drained follow-up ordering | state-convergence | L3 | automated | same harness | stream completes with `follow-1` queued | the `follow-1` user bubble renders below the assistant's final message (DOM order), never above |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | single-bang during compaction | fault-injection (abort) | L1 | automated | `pi.sendUserMessage` throws `Cannot submit a prompt while compaction is in progress` | `send_prompt` `!ls` | `bash_output` event still emitted with the output and `excludeFromContext:false`; the handler resolves without throwing |
| X2 | drain sync throw drops the entry | fault-injection (abort) | L1 | automated | `sendUserMessage` throws synchronously | drain with buffer `[{text:"a"}]` | `console.warn` containing `drainFollowupQueue` and `entry lost`; buffer `[]`; the next settle is a no-op |
| X3 | install with new pins | fault-injection | L2 | automated | clean checkout after the bump | `pnpm install --frozen-lockfile` then `node scripts/verify-release-deps.mjs` | both exit 0; exactly one resolved copy of pi-coding-agent / pi-ai / pi-tui at 1.3.0; no `@earendil-works/chord` in `pnpm-lock.yaml` |
| X4 | docker floor smoke | fault-injection | L3 | automated | docker harness image built with pi `1.3.0` | session registers; GET `/api/health` | `/api/health` reports pi `current === "1.3.0"`; no below-floor banner; session card shows no below-floor warning |
| X5 | QA install floor | fault-injection | L2 | automated | VM install via `qa/tests/01-install.sh` with `PI_FLOOR="1.3.0"` | install + resolved-copy probe | prints `Every resolved pi-coding-agent / pi-ai / pi-tui copy is at or above 1.3.0` and exits 0; with a staged 1.1.0 copy it prints `FAIL: pi copies below the 1.3.0 floor` and exits non-zero |

---

## Coverage summary

- Requirements covered: 14/14 (pi-core-version-check ×3, agent-session-context-injection ×1, command-routing ×2, bridge-extension ×1, mid-turn-prompt-queue ×5 incl. the drain REMOVED/ADDED pair, pi-agent-settings-editor ×1, pi-api-feature-detection ×1 via E8/X3 evidence plus the archive audit).
- Scenarios by class: edge 22 · perf 0 · frontend 2 · error 5
- Scenarios by level: L1 24 · L2 2 · L3 3
- Scenarios by disposition: automated 29 · manual-only 0

## New infra needed

- none. The pure `followup-drain.ts` module (task 3.0a) is production code that makes E13/E14/X2 testable without a mirror. Forwarder-level rows (E15–E19) drive the real `bridge-handlers/forwarders.ts` with a mock `inst`, as `bridge-agent-settled-contract.test.ts` does.
