# Tasks

## 1. Semantic pass carries absorbed narration
- [x] 1.1 `group-tool-calls.ts`: add `rendered: ChatMessage[]` to `ToolCallGroup` — the full interleaved slice (toolResults + absorbed transparent rows) in original order. Keep `messages` (toolResult-only) for count/summary.
- [x] 1.2 Populate `rendered` in `groupConsecutiveToolCalls` from the walked window `[i, lastToolEnd)`; leave the sub-threshold verbatim-emit path unchanged.
- [x] 1.3 Update/extend `group-tool-calls` unit tests: `rendered` includes absorbed thinking/prose; `messages` unchanged; trailing transparents NOT absorbed; sub-threshold path byte-identical.

## 2. Flip burst composition to semantic-first
- [x] 2.1 `group-tool-bursts.ts`: run `groupConsecutiveToolCalls(messages)` over the FULL stream first; walk the resulting `ChatItem[]`.
- [x] 2.2 Form bursts over runs of tool-like items (`toolResult` row OR `×N` group = one member); non-empty `assistant` prose stays a HARD boundary; `thinking`/separators/`rawEvent`/`commandFeedback`/empty-`assistant` transparent.
- [x] 2.3 Keep threshold ≥ 3 members; sub-threshold emits items verbatim; burst `id` = first tool-like member id (group → its `messages[0].id`).
- [x] 2.4 Remove the obsolete raw-array `burstEnd`/`memberCount`/`isTransparent(message)` walk superseded by the semantic-first walk.

## 3. Render narration in expanded views
- [x] 3.1 `CollapsedToolGroup.tsx`: expanded view iterates `group.rendered` — `toolResult` → `ToolCallStep`; `thinking`/non-empty `assistant` → lightweight inline text (`data-testid=collapsed-group-narration`); empty/separator rows skipped. Count badge/summary unchanged (still `group.messages`).
- [x] 3.2 `ToolBurstGroup.tsx`: consume the semantic-first shape; render absorbed narration rows inside the scrollbox interleaved with members (`data-testid=tool-burst-narration`); skip empty/separator rows.

## 4. Update burst tests
- [x] 4.1 Invert `does NOT over-merge identical calls split by prose` → `collapses identical calls split by prose into a ×N`.
- [x] 4.2 Add: `[curl, curl, prose, curl, curl]` → single `×4` group with prose present in `rendered`.
- [x] 4.3 Keep/verify heterogeneous prose-splits-burst scenarios pass under semantic-first composition (existing HARD-boundary tests green).
- [x] 4.4 Add: heterogeneous burst with an internal NARRATED `×N` poll loop nests correctly under the new composition.

## 5. Spec sync
- [x] 5.1 Confirm the two `chat-view` requirement deltas match the implemented behavior (semantic-first composition, `rendered` fold-in).
- [x] 5.2 `openspec validate collapse-tool-calls-across-narration --strict` passes.

## 6. Verify + deploy
- [x] 6.1 `vitest run group-tool-calls group-tool-bursts CollapsedToolGroup` green (36 tests; no `ToolBurstGroup.test` file exists). Full client suite: 3039 passed / 3 skipped, 0 fail.
- [x] 6.2 Biome clean on all changed grouping/component files (`groupToolBursts` refactored via `burstWindow` helper to clear the >15 complexity warn); `groupConsecutiveToolCalls` complexity warn is PRE-EXISTING (one line added). tsc clean for grouping code; the only tsc errors are the section-7 `keepReasoning` shared-field resolution (worktree shares root `node_modules` symlink → main checkout; clears on merge/install — not a code bug).
- [x] 6.3 Browser check via Playwright E2E against the Docker harness (repo convention: browser scenarios = `tests/e2e/` specs, not manual). Added `tests/e2e/tool-collapse-narration.spec.ts` + faux scenarios `poll-narrated`, `burst-split-by-reply` (`qa/fixtures/faux-scenarios.ts`). Booted per-worktree image (baked from this checkout), ran `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=18091`: (1) narrated poll loop → one `×4` `collapsed-group`, expand reveals absorbed `still starting` narration; (2) heterogeneous run split by mid-turn reply → two `tool-burst-group`s with the reply at top level. Both PASS. Managed `npm run test:e2e -- tool-collapse-narration.spec.ts` also passes end-to-end (build→boot→run→teardown, 2 passed 58.8s). A `beforeEach` health-stability gate (3 consecutive `/api/health` OKs) guards the post-boot server-stabilization race (managed globalSetup starts specs at first-healthy, before the server finishes hydrating — boot event-loop spike + degraded proxy — which briefly shows "Server offline" and makes a fresh spawn mis-detect an empty container). Verified stable across 4 warm-container executions. Container torn down, image untagged, state discarded.
- [x] 6.4 `npm run build` + `POST /api/restart` + `npm run reload` — N/A in worktree per AGENTS.md (deploy pushes worktree code onto the local running instance). DEFERRED to post-merge on `main`; run there to deploy the merged change.

## 7. `keepReasoningOpenUntilTurnEnds` pref (DONE — recorded post-implementation)
- [x] 7.1 `display-prefs.ts`: add `keepReasoningOpenUntilTurnEnds: boolean` to `DisplayPrefs`, all three `DISPLAY_PRESETS` (`false`), and `mergeDisplayPrefs`.
- [x] 7.2 `preferences-store.ts`: `backfillDisplayPrefs` defaults `false` for legacy files; `setDisplayPrefs` base literal + merge include the field.
- [x] 7.3 `ThinkingBlock.tsx`: add `keepOpenUntilTurnEnds` + `turnActive` props; TWO effects (doubt-review) — effect 1 ms-timer+demotion deps `[streamedLive, isStreaming, keepOpenUntilTurnEnds]` (turnActive excluded so a turn-end flip cannot re-arm the timer), suppressed when hold on; effect 2 hold `setExpanded(Boolean(turnActive))` deps `[keepOpenUntilTurnEnds, turnActive, streamedLive, isStreaming]`.
- [x] 7.4 `ChatView.tsx`: pass `keepOpenUntilTurnEnds={prefs.keepReasoningOpenUntilTurnEnds}` + `turnActive={state.status === "streaming"}`.
- [x] 7.5 `SettingsPanel.tsx` + `ChatViewMenu.tsx`: add toggle (disabled when `reasoning` off; per-session override in the menu).
- [x] 7.6 Tests: `ThinkingBlock.test.tsx` (held open past ms while active; collapses on turn-end edge; turnActive change does NOT re-arm ms timer when hold off — doubt-review regression guard); `display-prefs.test.ts` (preset default false + override precedence). All green (11/11).
- [x] 7.8 Doubt-driven review: single-model (Claude) + cross-model (deepseek-v4-pro) both flagged `turnActive`-in-deps ms-timer re-arm → fixed via two-effect split. Premature-collapse finding (referenced shared 4-state `SessionStatus`) classified NOISE: `ChatView` uses client reducer `state.status` (3-state, `"streaming"` for the whole turn, `"idle"` at agent_end).
- [x] 7.7 Per-file `AGENTS.md` records updated (shared/server tree rows + ThinkingBlock/SettingsPanel/ChatViewMenu sidecars).
