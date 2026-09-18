## 1. Slot definition (shared + runtime validation)

- [ ] 1.1 Add `custom-entry-renderer` to `SlotId` and `SLOT_DEFINITIONS` in `packages/shared/src/dashboard-plugin/slot-types.ts` (multiplicity `many`, payload tier `react-only`, `SlotPredicateInput` → `never`, mirroring `tool-renderer`) and verify the existing slot-types unit tests still pass plus a new case asserting the definition's shape.
- [ ] 1.2 Validate the required `customType` string field for the new slot in `packages/dashboard-plugin-runtime/src/manifest-validator.ts`, and reject intra-plugin duplicate `(custom-entry-renderer, customType)` pairs beside the existing `tool-renderer`/`command-route` duplicate checks; verify with manifest-validator tests: missing `customType` rejected, missing `component` rejected, error names the plugin and the claim index, well-formed accepted, same-plugin duplicate rejected (deltas: "Claim declares a customType", "One plugin declares the same customType twice").
- [ ] 1.3 Add `customType?: string` to `ClaimEntry` and a `forCustomType` exact-match filter beside `forToolName` in `packages/dashboard-plugin-runtime/src/slot-registry.ts`; verify unit tests cover exact match and non-match (delta: "Claim matches by exact customType").
- [ ] 1.4 Implement **cross-plugin** `(custom-entry-renderer, customType)` collision detection in `packages/dashboard-plugin-runtime/src/vite-plugin/`, where the generated `packages/client/src/generated/plugin-registry.js` is assembled — NOT the server-side `loader.ts`, which governs activation rather than the browser registry that resolves react claims. That path runs `validateManifest` per manifest with no aggregate check today, so this is new code. Verify a test asserting the build fails with an error naming both plugins and the conflicting `customType` (delta: "Two plugins claim the same customType"). Do NOT retrofit the check to `tool-renderer` — explicitly out of scope.

## 2. Client resolution chain

- [ ] 2.1 Resolve plugin claim → `CustomEntryCard` fallback in the `role: "custom"` branch of `packages/client/src/components/chat/ChatView.tsx`, using a one-shot `useMemo` lookup via `useSlotRegistryOrNull` (mirroring `ToolCallStep`), and verify a test where a registered claim renders instead of the fallback (delta `custom-entry-rendering`: "plugin claim wins over the fallback").
- [ ] 2.2 Treat a throwing `claimShouldRender` as `false` (fail-closed) and wrap the resolved component in a per-claim `ErrorBoundary` that lands on `CustomEntryCard`; verify with tests for a throwing predicate and a throwing renderer (deltas: "shouldRender gates the claim fail-closed", "Throwing renderer falls back").
- [ ] 2.3 Keep the claim lookup **after** the `customEventGroups` gate at both the `isRowVisible` and render sites; verify a test that a claimed row in a hidden group renders nothing (delta: "hidden group suppresses a claimed row too").

## 3. Burst transparency

- [ ] 3.1 Add the optional `isTransparentCustomType?: (customType: string) => boolean` parameter to `packages/client/src/lib/chat/group-tool-bursts.ts` so a claimed custom row is absorbed instead of terminating the burst, importing no registry; verify unit tests for "Claimed custom row is absorbed", "Unclaimed custom row still terminates the burst", and "Burst formation is unchanged with no claims registered".
- [ ] 3.1b Thread the same predicate through the INNER pass `packages/client/src/lib/chat/group-tool-calls.ts`, whose separate `TRANSPARENT_ROLES` + `next.role !== "toolResult"` break currently splits a `×N` run on any custom row; verify the `consecutive-tool-call-grouping` deltas "Claimed custom row is absorbed into the run", "Unclaimed custom row ends the run", and "Grouping is unchanged with no claims registered".
- [ ] 3.2 Supply the registry-backed predicate from `ChatView`, memoized on the claim-list identity so an asynchronously-mounting registry re-groups at most once rather than live; verify tests that grouping is byte-identical with an empty registry AND that a claim set arriving after first render does not re-form bursts on subsequent unrelated re-renders.
- [ ] 3.3 Add a `role: "custom"` branch to `BurstBodyItem` in `packages/client/src/components/chat/ToolBurstGroup.tsx` (it currently hits `if (msg.role !== "toolResult") return null` and renders **nothing**), carrying the same resolution chain as the top-level site, then apply the `prefs.customEventGroups[groupId ?? "other"] !== false` gate; verify BOTH scenarios — group visible + absorbed row in an expanded burst → plugin component renders ("absorbed row still renders when its group is visible"), and group hidden → renders nothing ("gate holds for a row absorbed into a burst"). The visible case is load-bearing: without it the hidden-case test passes vacuously.
- [ ] 3.3b Add the same `role: "custom"` branch + group gate to `packages/client/src/components/chat/CollapsedToolGroup.tsx` — the SECOND vanish site, which draws the inner `×N` group's absorbed rows and also falls through to `return null` (it already mirrors the `prefs.toolCalls` gate, so follow that pattern), carrying the SAME collapsed presentation and expand affordance as the top-level site so content never varies by absorption site; verify the `consecutive-tool-call-grouping` deltas "Absorbed custom row renders inside the expanded group" and "Hidden group suppresses an absorbed custom row".
- [ ] 3.3c Stop both containers from suppressing visible absorbed custom rows when the per-tool `prefs.toolCalls` gate empties them — the THIRD vanish path (`ToolBurstGroup.tsx:183` and `CollapsedToolGroup.tsx:34` both `return null` when no tool member survives); verify the deltas "absorbed row survives an empty container" and "Absorbed custom row survives an empty group".
- [ ] 3.4 Verify toggling a display preference never re-forms bursts — assert identical burst boundaries before and after a `customEventGroups` toggle (delta: "Display preferences do not re-form bursts").
- [ ] 3.5 Verify the bare-group interaction: a lone `×N` group flanked only by a claimed custom row is WRAPPED rather than left bare, since a claimed custom row is content not structural chrome (delta: "Lone repetitive group flanked by a claimed custom row is wrapped").

## 4. Payload endpoint + hook

- [ ] 4.1 Add an entry-by-id lookup helper to `packages/server/src/session/session-file-reader.ts` (it already builds a `byId` map over `entry.id`) mirroring `findSessionToolCallPayload`; verify a unit test that it returns the untruncated entry from a fixture JSONL and `undefined` for an unknown id.
- [ ] 4.2 Add `GET /api/sessions/:sessionId/entry/:entryId` in `packages/server/src/routes/session-routes.ts`, resolving `session.sessionFile` via `sessionManager` and reading the **on-disk JSONL** — NOT `eventStore`, which truncates strings to 4 KB and clobbers arrays >20 at ingest — session-addressed, never path-addressed, `networkGuard`-guarded; verify a route test returning a >200-line payload untruncated.
- [ ] 4.3 Verify the endpoint's negative paths with tests: unknown/evicted entry → 404, not-yet-flushed entry → 404 (not an error), entry on an abandoned branch → 404, entry belonging to a different session → not returned, traversal-shaped identifier → rejected (delta `dashboard-server`, all six scenarios).
- [ ] 4.4 Add `useCustomEntryPayload` in `packages/client/src/hooks/` mirroring `useToolFullResult` (skips when either id is missing, 404 → "entry evicted"); verify a hook test that no request is issued with a missing `entryId` and that a 404 surfaces the evicted state.
- [ ] 4.5 Wire the hook so it is invoked **only** from the expanded branch, and verify the enforcing test: a mounted-but-collapsed claimed row issues zero `fetch` calls; expanding issues exactly one (delta: "Collapsed rows issue no requests", "Expansion issues exactly one request").
- [ ] 4.6 Suppress the expand affordance when the row carries no `entryId` (the `message_end`/`pi.sendMessage` reducer arm deliberately does not stamp one), rather than offering a control whose fetch can never fire; verify the test "Row without an entry id offers no expand affordance".

## 5. Blackhole plugin renderer

- [ ] 5.1 Declare the three `custom-entry-renderer` claims (`om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`) in the `packages/blackhole-plugin/` manifest and verify manifest validation passes and the three types resolve to the plugin renderer in a registry test (delta `blackhole-om-entry-rendering`: "Claimed type renders through the plugin", "Unclaimed om type keeps the fallback").
- [ ] 5.2 Implement the collapsed renderer deriving its line from the row body only — `JSON.parse` success → labelled count, parse failure (truncated body) → label + expand affordance with **no count**; verify tests for a parseable body, a head-truncated body, and that no partial count is ever shown (deltas: "Parseable body yields a count", "Unparseable body omits the count", "Collapsed summary never reports a partial count").
- [ ] 5.2b Give each claimed type its own collapsed-line icon per D10, additive to the text label and marked decorative (`aria-hidden`) so the type is never conveyed by icon or colour alone; verify the test "Each claimed type is visually distinguishable" (three distinct icons AND each line still exposes its event kind as text).
- [ ] 5.3 Implement the expanded view rendering observations/reflections/dropped as discrete records from the fetched payload, text nodes only — no markdown, no linkification, no `dangerouslySetInnerHTML`; verify tests for each of the three types plus "Record text is never interpreted" (markdown/HTML in a record renders literally).
- [ ] 5.4 Fall back to the row's stored truncated body as plain text when the payload fetch 404s or errors, and verify the test for "Evicted entry falls back to the stored body".
- [ ] 5.5 Assert the plugin declares no claim for `om.folded` (it travels as a field inside compaction entries, not as a custom entry) and verify a manifest test that the claim set is exactly the three types (delta: "Compaction-borne fold metadata is not claimed").

## 6. Verification and closeout

- [ ] 6.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures across shared, runtime, client, server, and plugin suites.
- [ ] 6.2 Run the `security-hardening` discipline pass on the new endpoint and the expanded renderer, and verify the recorded findings show session-addressed lookup plus no-interpretation of payload text.
- [ ] 6.3 Measure the burst-transparency effect on a real session transcript (burst count before vs after claims are registered) and verify the result is recorded, per the `performance-optimization` discipline commitment not to assume it.
- [ ] 6.4 Update the nearest directory `AGENTS.md` rows for every changed file and verify `node scripts/check-conventions.mjs` passes.

## 7. Slot + manifest scenarios (test-plan fold)

Harness exemplars: `packages/dashboard-plugin-runtime/src/__tests__/claim-entry-typing.test.ts` (claim typing), `packages/dashboard-plugin-runtime/src/__tests__/config-validator.test.ts` (validator error assertions).

- [ ] 7.1 E1 exact-match filter: claim `customType:"om.reflections.recorded"` plus rows typed `om.reflections.recorded` / `om.reflections` / `om.reflections.recorded.v2` / `""` (input) · call `forCustomType` (trigger) · returns the claim for the exact value only, `[]` for the other three (observable). See `claim-entry-typing.test.ts`. (test-plan #E1)
- [ ] 7.2 E2 claim shape validation: claims `{customType,component}` / `{component}` / `{customType}` / `{customType:"",component}` (input) · `validateManifest` (trigger) · only the first accepted; each rejection is a `ManifestValidationError` naming plugin id and claim index (observable). See `config-validator.test.ts`. (test-plan #E2)
- [ ] 7.3 E3 intra-plugin duplicate: one manifest with two `custom-entry-renderer` claims sharing `customType` (input) · `validateManifest` (trigger) · throws naming the plugin and the duplicated `customType` (observable). See `config-validator.test.ts`. (test-plan #E3)
- [ ] 7.4 E4 cross-plugin collision: two manifests each claiming the same `customType` (input) · vite-plugin assembles the generated client registry (trigger) · build fails naming BOTH plugin ids and the conflicting `customType`, no registry emitted (observable). See `packages/dashboard-plugin-runtime/src/vite-plugin/` and `config-validator.test.ts`. (test-plan #E4)
- [ ] 7.5 E5 collision negative control: two manifests claiming DIFFERENT `customType` values (input) · same assembly (trigger) · build succeeds, both claims present in the generated registry (observable). (test-plan #E5)
- [ ] 7.6 E13 blackhole claim set: the blackhole manifest (input) · read its `custom-entry-renderer` claims (trigger) · exactly the three `om.*` types, `om.folded` absent (observable). See `packages/blackhole-plugin/src/__tests__/manifest-discoverability.test.ts`. (test-plan #E13)

## 8. Grouping scenarios (test-plan fold)

Harness exemplars: `packages/client/src/lib/__tests__/group-tool-bursts.test.ts` (outer pass), `packages/client/src/lib/__tests__/group-tool-calls.test.ts` (inner ×N pass).

- [ ] 8.1 E7 claimed vs unclaimed absorption: `toolResult · custom · toolResult` with the custom row claimed, then unclaimed (input) · `groupToolBursts` with the predicate (trigger) · claimed → one burst with the row in `items`; unclaimed → two bursts, row at top level (observable). See `group-tool-bursts.test.ts`. (test-plan #E7)
- [ ] 8.2 E8 inner-pass absorption: three identical `read` toolResults with a claimed custom row between #2 and #3 (input) · `groupConsecutiveToolCalls` (trigger) · one `×3` group, custom row in `rendered` in original order (observable). See `group-tool-calls.test.ts`. (test-plan #E8)
- [ ] 8.3 E9 inner-pass boundary: same stream with the custom row unclaimed (input) · `groupConsecutiveToolCalls` (trigger) · run ends before the custom row, no `×3` group forms (observable). See `group-tool-calls.test.ts`. (test-plan #E9)
- [ ] 8.4 E10 zero-claim invariance: a fixture stream containing `custom` rows plus an empty claim set (input) · both grouping passes (trigger) · output deep-equals the pre-change grouping of the same fixture (observable). See `group-tool-bursts.test.ts`. (test-plan #E10)
- [ ] 8.5 E11 bare-group interaction: a lone `×N` group whose only absorbed neighbour is a claimed custom row (input) · `groupToolBursts` (trigger) · bare-group exception does NOT apply; group is wrapped in a burst container with that row (observable). See `group-tool-bursts.test.ts`. (test-plan #E11)
- [ ] 8.6 F9 preference stability: a transcript with a claimed custom row absorbed into a burst (input) · toggle its custom event group off then on (trigger) · burst boundaries deep-equal across all three states, only visibility differs (observable). See `group-tool-bursts.test.ts`. (test-plan #F9)
- [ ] 8.7 F10 async claim arrival: mount with an empty registry then register a claim (input) · a subsequent unrelated re-render (trigger) · bursts re-form at most once; an unchanged claim list yields identical boundaries (observable). See `group-tool-bursts.test.ts`. (test-plan #F10)
- [ ] 8.8 P3 burst-split reduction: a captured session fixture carrying the `om.*` row profile (input) · group with claims registered vs none (trigger) · burst count with claims < burst count without, both numbers printed in the test output (observable). See `group-tool-bursts.test.ts`. (test-plan #P3)

## 9. Rendering scenarios (test-plan fold)

Harness exemplar: `packages/client/src/components/chat/__tests__/CustomEntryCard.test.tsx`.

- [ ] 9.1 F1 claim precedence: a claimed custom row (input) · chat renders it (trigger) · plugin component renders, `CustomEntryCard` does not (observable). (test-plan #F1)
- [ ] 9.2 F2 hidden group gate: claimed row in group `memory` with `customEventGroups.memory = false` (input) · chat renders (trigger) · nothing renders and the row is excluded from row-visibility computations (observable). (test-plan #F2)
- [ ] 9.3 F3 absorbed + visible (burst): claimed row absorbed into a burst, group visible (input) · burst expanded (trigger) · plugin component renders with the same collapsed line and expand affordance as top level (observable). (test-plan #F3)
- [ ] 9.4 F4 absorbed + hidden (burst): same with group visibility `false` (input) · burst expanded (trigger) · renders nothing (observable). (test-plan #F4)
- [ ] 9.5 F5 absorbed + visible (×N group): claimed row in a `×N` group's `rendered` slice, group visible (input) · `CollapsedToolGroup` expanded (trigger) · plugin component renders, content identical to the other two sites (observable). (test-plan #F5)
- [ ] 9.6 F6 absorbed + hidden (×N group): same with group visibility `false` (input) · group expanded (trigger) · renders nothing (observable). (test-plan #F6)
- [ ] 9.7 F7 empty burst container: a burst whose every tool member is hidden by `prefs.toolCalls`, holding one claimed custom row whose own group IS visible (input) · chat renders (trigger) · the custom row still renders; the container does not collapse to `null` (observable). (test-plan #F7)
- [ ] 9.8 F8 empty ×N container: the same shape against a `×N` group (input) · chat renders (trigger) · the custom row still renders (observable). (test-plan #F8)
- [ ] 9.9 F11 no-entryId row: a claimed row with `entryId: undefined` (input) · chat renders it (trigger) · collapsed line renders, NO expand affordance, zero `fetch` calls (observable). (test-plan #F11)
- [ ] 9.10 E6 collapsed summary counts: bodies with 0/1/4 records, a head-truncated 303-line slice, and a non-JSON string (input) · collapsed renderer derives its summary (trigger) · counts `0`/`1`/`4` for the first three, NO count for the last two (observable). (test-plan #E6)
- [ ] 9.11 F12 per-type icons: one row of each claimed type (input) · all render collapsed (trigger) · three distinct icons, each line also exposing its event kind as text so the accessible name is never icon-only (observable). (test-plan #F12)
- [ ] 9.12 F13 no interpretation: a record whose content is `**bold** https://example.com <img src=x onerror=1>` (input) · expanded view renders it (trigger) · literal characters appear as text; no `<strong>`, no anchor, no element injection (observable). (test-plan #F13)
- [ ] 9.13 F14 structural expansion: payloads with 4 observations, 3 reflections, and a dropped set (input) · each row expanded (trigger) · each record renders as its own item showing its content (observable). (test-plan #F14)
- [ ] 9.14 P1 collapsed rows issue no requests: 500 claimed collapsed rows mounted with a stubbed `fetch` (input) · full mount plus one re-render (trigger) · `fetch` call count === 0 (observable). (test-plan #P1)
- [ ] 9.15 P2 expansion issues one request: the same transcript, expand exactly one row carrying an `entryId` (input) · expansion (trigger) · `fetch` call count === 1 and its URL targets that row's entryId (observable). (test-plan #P2)
- [ ] 9.16 X1 throwing renderer: a claimed component that throws on render (input) · chat renders that row (trigger) · `CustomEntryCard` renders in its place, neighbours render normally, transcript does not unmount (observable). (test-plan #X1)
- [ ] 9.17 X2 shouldRender fail-closed: `shouldRender` returns false, then throws (input) · claim resolution (trigger) · both skip the claim and fall through to the generic fallback; the throw is contained (observable). (test-plan #X2)
- [ ] 9.18 X3 evicted payload: payload endpoint returns 404 (fault) · user expands a claimed row (trigger) · stored truncated body renders as plain text, unlinkified, no error screen (observable). (test-plan #X3)
- [ ] 9.19 X10 fetch rejects: `fetch` rejects (fault) · user expands a claimed row (trigger) · degrades to the stored body exactly as the 404 arm does, no unhandled rejection (observable). (test-plan #X10)

## 10. Server endpoint scenarios (test-plan fold)

Harness exemplars: `packages/server/src/__tests__/session-routes-tool-result.test.ts` (sibling route), `packages/server/src/__tests__/session-file-reader.test.ts` (JSONL fixtures).

- [ ] 10.1 E12 full payload: a fixture JSONL holding a custom entry of 303 pretty-printed lines / 13 KB (input) · `GET /api/sessions/:id/entry/:entryId` (trigger) · `200` and the payload deep-equals the on-disk entry, with byte length exceeding the store's 4 KB per-string cap — proving it did not come from the event store (observable). See `session-routes-tool-result.test.ts`. (test-plan #E12)
- [ ] 10.2 X4 unknown entry: `entryId` absent from the session file (fault) · endpoint requested (trigger) · `404` (observable). (test-plan #X4)
- [ ] 10.3 X5 unflushed entry: a session whose custom entry is still buffered, no assistant message appended (fault) · endpoint requested (trigger) · `404` logged as a normal miss, and a later request after the flush returns `200` (observable). (test-plan #X5)
- [ ] 10.4 X6 abandoned branch: a session file with branch structure, entry outside the active leaf→root branch (fault) · endpoint requested (trigger) · `404` (observable). See `session-file-reader.test.ts`. (test-plan #X6)
- [ ] 10.5 X7 cross-session isolation: a valid `entryId` from session B (fault) · requested under session A (trigger) · `404`, session B's payload not returned (observable). (test-plan #X7)
- [ ] 10.6 X8 traversal rejection: `entryId` values `../../etc/passwd`, `a/b`, `..%2f..%2fetc%2fpasswd` (fault) · endpoint requested (trigger) · `404` each, and a spied reader proves no filesystem read outside the addressed session (observable). (test-plan #X8)
- [ ] 10.7 X9 network guard: a non-local request per the shared `networkGuard` contract (fault) · endpoint requested (trigger) · rejected identically to its sibling session routes (observable). See `session-routes-tool-result.test.ts`. (test-plan #X9)

## 11. End-to-end scenario (test-plan fold)

Harness exemplar: `tests/e2e/chat-render-fx.spec.ts` (chat transcript rendering vs the docker harness; read `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`).

- [ ] 11.1 F15 om rows render through the plugin: the docker harness with the blackhole plugin loaded and a session emitting an `om.observations.recorded` entry (input) · the transcript renders, then the row is expanded (trigger) · the collapsed line shows the labelled summary rather than a JSON blob, and expanding shows discrete records (observable). (test-plan #F15)

## 12. Manual verification (deferred post-merge)

- [ ] 12.1 F16 scroll a real session transcript carrying hundreds of `om.*` rows and judge whether it reads as compact and scannable rather than noisy (test-plan: manual-only)
- [ ] 12.2 F17 look at the three collapsed line variants and judge whether the per-type icons read as meaningfully distinct and match their event's meaning (test-plan: manual-only)
