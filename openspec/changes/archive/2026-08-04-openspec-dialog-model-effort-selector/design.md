## Context

Model and thinking-effort selection ships today as `settings/ModelSelector.tsx` and `settings/ThinkingLevelSelector.tsx`, mounted in the composer toolbar (`chat/CommandInput.tsx`). `App.tsx` owns the state — `selectedState.model`, `selectedState.thinkingLevel`, `modelsMap.get(selectedId)`, `favoriteModels` — and emits `set_model` / `set_thinking_level` / `request_models` over the browser WebSocket. The server (`browser-handlers/directory-handler.ts`) forwards those verbatim to the bridge, where `extension/command-handler.ts` calls `options.setModel(provider, modelId)` and `options.setThinkingLevel(level)`.

The three OpenSpec dialogs (`ExploreDialog`, `ProposeDialog`, `NewChangeDialog`) are presentational: they collect text and call `onSend(prompt, images?)`, which `SessionOpenSpecActions` forwards to `onSendPrompt`. They know nothing about models. `SessionOpenSpecActions` is mounted from three places — `SessionCard`, `ComposerSessionActions`, `MobileActionMenu`.

Design evidence for this change lives in `mockups/` — a served HTML mockup of all five states plus `ux-test.md`, which records the scored accessibility floor (7/7), heuristic rubric (12/12), and eight defects found and fixed during the design loop.

## Goals / Non-Goals

**Goals:**
- Let the user set model and effort at the moment they launch an OpenSpec workflow, without leaving the dialog.
- Reuse the shipped selector components and the shipped protocol verbatim — no new message types.
- Make the sticky side-effect legible before it happens.
- Guarantee the chosen model is the one that actually runs the prompt, or fail visibly rather than silently.

**Non-Goals:**
- Per-run model override that reverts afterwards. Rejected — see Decision 1.
- Model selection for the folder-level "New Spec" spawn path.
- Fixing the two inherited sub-AA token pairs surfaced by the UX test (popover group headings, dark-theme primary button). Repo-wide token work, tracked separately.
- Persisting a per-workflow model preference (e.g. "always explore with opus").
- **Serializing the bridge's WebSocket message pump.** The spike proved `connection.ts:201` dispatches handlers concurrently, so the `set_model` → prompt race exists for ANY caller, not just these dialogs. Fixing it properly means chaining `onMessage` behind a promise queue — a change to the hot path for every message type, with its own ordering and back-pressure questions. Out of scope here; see Decision 7.

## Decisions

### 1. Sticky, not per-run

Changing a control mutates the session's model / thinking level, exactly as the composer toolbar does. The alternative — a per-run override that reverts after the turn — requires threading an override through `send_prompt` in the browser protocol, the server forwarder, the bridge, and into pi's turn construction. That is a protocol change across three packages for a semantic most users would not notice.

Sticky also matches the mental model the dashboard already teaches: there is one model per session, shown in one place. Two competing model values (session vs. this-run) would be a worse surface than the problem being solved.

Cost: the dialog silently mutates session state. Mitigated by Decision 3, not by a confirm step — a confirm on every launch would violate the accelerator heuristic for the common case where the user did not touch the control.

### 2. Context, not prop drilling

Expose `{ model, models, thinkingLevel, favorites, setModel, setThinkingLevel, refreshModels }` from `App.tsx` via a React context consumed by the dialogs. The alternative is passing seven values through `SessionOpenSpecActions` at three mount sites, where none of the intermediate components use them. Context also makes the row reusable by any future dialog (e.g. the worktree spawn dialog) without touching the call sites again.

### 3. Disclose, don't confirm

When a control differs from the session's value, the dialog renders a text line: "Model changes for this session, not just this run." No line when nothing changed. This satisfies error prevention without adding a step, and the text (not the tint) is the accessible channel.

### 4. Confirm-before-send ordering gate

**Validated by the Task 1 spike — see Spike Findings below. The gate is REQUIRED, not defensive.**

On Send, when either control changed:

1. emit `set_model` and/or `set_thinking_level`
2. disable Send, show a live status ("Applying model & effort to the session, then sending…")
3. wait for a `model_update` message whose `(model, thinkingLevel)` pair matches BOTH chosen values
4. send the prompt
5. on timeout (see Risk 1), send anyway and surface that the model may not have applied

Alternative considered: fire all three messages back-to-back and trust ordering. **Rejected — the spike proved this race is real, not theoretical.** The bridge's WebSocket `onMessage` is invoked fire-and-forget (`connection.ts:201` calls `this.onMessage?.(parsed)` without `await`), so the `set_model` handler yields at its first `await` and a `send_prompt` arriving in the next socket tick executes concurrently, on the old model. The failure is silent and produces a run that looks correct.

Wait on the **pair**, not on message count. `sendModelUpdateIfChanged` (`model-tracker.ts:15`) dedupes on `(model, thinkingLevel)` together and emits a single `model_update`, so changing both controls may yield one message or two depending on timing.

### 5. Reuse `ModelSelector` / `ThinkingLevelSelector` unmodified

Both already handle grouping, favorites, capability badges, `supportedLevels` filtering, popover flipping, and the refresh footer. Reimplementing a compact variant would fork behavior. The dialog footer is a narrower container, so both get the existing `boundaryRef` treatment; the popover flips upward because the row sits at the dialog's bottom edge.

### 6. One header anatomy across the three dialogs

`Dialog.tsx` ships an `icon` prop that none of the OpenSpec dialogs use. Adopting it — plus a hint line on each, and the change name as a chip rather than concatenated into the title — makes Explore a structural peer of the other two instead of a stripped-down variant. This is cosmetic but touches asserted markup, so it is called out as breaking in the proposal.

### 7. Close the race at the client, not in the bridge

The client-side gate (Decision 4) fixes the dashboard's own OpenSpec dialogs. It does **not** fix the underlying bridge concurrency, so any other caller that emits `set_model` immediately followed by a prompt still races.

Chosen deliberately over serializing the bridge pump, because that touches every message type on the hot path and deserves its own change with its own tests. The trade-off is explicit: **this change leaves a known trap in place for future callers.** It is recorded here and in the follow-up so the next person hits documentation instead of a silent wrong-model run.

## Risks / Trade-offs

**Risk 1 — RESOLVED by the spike. The race is real; the gate closes it.** The bridge does not serialize message handling, so an unguarded `set_model` → `send_prompt` sequence races. The confirmation signal is trustworthy, so gating on it is sound.
→ **Mitigation**: Decision 4, now validated rather than assumed.

**Risk 7 — the bridge race stays open for other callers.** Per Decision 7, only these three dialogs are protected. A future feature that sets a model and prompts in one gesture will silently reproduce the bug.
→ **Mitigation**: documentation only — Decision 7 above, plus the follow-up change proposed in task 1.4. Accepted, not solved.

**Risk 6 (NEW, from the spike) — a failed model change is indistinguishable from a slow one.** `bridge.ts:1149` returns silently on three paths: no cached registry, model not found in the registry, and `pi.setModel()` throwing. None of them emit anything, so the client sees the same nothing it sees while waiting.
→ **Mitigation**: the timeout copy must NOT claim the model was applied. Word it as "Sent — the model change may not have applied", and keep the composer selector as the authoritative display so the user can see the real value immediately after.

**Risk 2 — silent session mutation.** A user who ignores the disclosure line changes their session model without intending to. The UX walkthrough rates this step yellow and accepts it.
→ **Mitigation**: disclosure line + the composer selector visibly reflecting the new value immediately after.

**Risk 3 — empty model list.** `modelsMap` is empty until `models_list` arrives for that session, so a dialog opened early would show an empty selector.
→ **Mitigation**: `request_models` on open; render the current model as a disabled chip with "Loading models…" until the list lands. Effort stays interactive (it needs no server list). Send is never blocked by this.

**Risk 4 — test churn.** The header restructure breaks markup assertions in `Dialogs.test.tsx` and any Playwright spec matching `Explore: <name>`.
→ **Mitigation**: update the specs in the same change; keep every `data-testid` stable so only text assertions move.

**Risk 5 — three mount sites drift.** The context provider must wrap all three, or the row silently renders in a degraded state in one surface.
→ **Mitigation**: the hook throws when used outside the provider, turning a silent gap into a test failure.

## Migration Plan

Client-only, no persisted state, no protocol change — deploy is a normal client build (`npm run build` + `/api/restart`). Rollback is reverting the commit; sessions whose model was changed through the new row keep that model, which is indistinguishable from having changed it in the composer.

## Spike Findings (Task 1 — resolved)

Answered by reading the shipped bridge; no runtime debugger was required.

**Q1 — Is the confirmation truthful or optimistic? TRUTHFUL.**
`bridge.ts:1149` `setModel` does `await pi.setModel(model)` and only then schedules `setTimeout(() => sendModelUpdateIfChanged(), 50)`. `sendModelUpdateIfChanged` (`model-tracker.ts:15`) re-reads live state via `getCurrentModelString(bc)` and `pi.getThinkingLevel()` and emits `model_update` only when the value actually differs from the last sent one. The confirmation is a post-hoc read of real state, not an echo of the request. **Gating on it is sound.**

The effort control is covered too: `bridge.ts:1063` fires the same 50ms `sendModelUpdateIfChanged` after `set_thinking_level`, and pi 0.71+'s `thinking_level_select` event triggers it as well (`bridge.ts:1614`).

Correction to the proposal: the confirmation message is **`model_update`**, not `session_updated`.

**Q2 — Does a prompt sent immediately after `set_model` race it? YES.**
`connection.ts:197` — `this.ws.onmessage = (ev) => { ... this.onMessage?.(parsed); }`. The handler is `async` but is invoked **without `await`**, so every inbound message starts an independent concurrent task. `set_model`'s handler yields at `await options.setModel(...)`; the next socket tick delivers `send_prompt`, whose handler runs to completion during that yield and submits the prompt on the old model.

Ordering on the wire is preserved end-to-end (client → server `directory-handler.ts:245` → bridge), but wire order buys nothing because handling is concurrent.

**Consequence**: Decision 4 stands and is now load-bearing. The naive implementation would have shipped a silently wrong feature.

**Consequence 2**: wait for the `(model, thinkingLevel)` pair, not for N messages — the dedupe guard in `model-tracker.ts:18` compares both fields together and can collapse two logical changes into one `model_update`.

## Open Questions

1. ~~Does the confirmation reflect live state?~~ **RESOLVED** — see Spike Findings. Yes; `model_update` is a post-hoc read.
2. Should the effort selector be hidden for models whose `supportedLevels` is empty, or shown disabled? Deferring to `ThinkingLevelSelector`'s existing fallback behavior for now.
3. Should the run-config row also appear in the archive/verify dialogs? Out of scope here; revisit once this lands.
