# Test Plan — add-custom-entry-renderer-slot

Stage: apply   Generated: 2026-02-12

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shell-slots: Claim matches by exact customType | EP | L1 | automated | claim `customType: "om.reflections.recorded"`; rows typed `om.reflections.recorded`, `om.reflections`, `om.reflections.recorded.v2`, `""` | `forCustomType(claims, rowType)` | returns the claim for the exact value only; `[]` for the other three |
| E2 | shell-slots: Claim declares a customType | decision-table | L1 | automated | claims: `{customType, component}`, `{component}` only, `{customType}` only, `{customType: "", component}` | `validateManifest` | only the first is accepted; each rejection is a `ManifestValidationError` naming the plugin id and the claim index |
| E3 | shell-slots: One plugin declares the same customType twice | EP | L1 | automated | one manifest with two `custom-entry-renderer` claims, both `customType: "om.observations.recorded"` | `validateManifest` | throws naming the plugin and the duplicated `customType` |
| E4 | shell-slots: Two plugins claim the same customType | EP | L1 | automated | two manifests, each one claim, same `customType` | vite-plugin assembles the generated client registry | build fails with an error naming BOTH plugin ids and the conflicting `customType`; no registry file is emitted |
| E5 | shell-slots: Two plugins claim the same customType (negative control) | EP | L1 | automated | two manifests claiming DIFFERENT `customType` values | same assembly | build succeeds; both claims present in the generated registry |
| E6 | blackhole: Parseable body yields a count / Unparseable body omits the count | BVA | L1 | automated | bodies: valid JSON with 0, 1, 4 records; a head-truncated slice of a 303-line payload; a non-JSON plain string | collapsed renderer derives its summary from the row body | counts `0`/`1`/`4` render for the first three; NO count renders for the last two (label only) |
| E7 | burst-grouping: Claimed vs unclaimed custom row | decision-table | L1 | automated | `toolResult · custom · toolResult` with the custom row (a) claimed, (b) unclaimed | `groupToolBursts` with the claimed-type predicate | (a) one burst, custom row inside `items`; (b) two bursts, custom row emitted at top level |
| E8 | consecutive-grouping: Claimed custom row is absorbed into the run | decision-table | L1 | automated | three identical `read` toolResults with a claimed custom row between #2 and #3 | `groupConsecutiveToolCalls` | one `×3` group; the custom row appears in `rendered` in original order |
| E9 | consecutive-grouping: Unclaimed custom row ends the run | decision-table | L1 | automated | same stream, custom row unclaimed | `groupConsecutiveToolCalls` | run ends before the custom row; no `×3` group forms |
| E10 | burst-grouping: Burst formation is unchanged with no claims registered | EP | L1 | automated | a fixture stream containing `custom` rows; empty claim set | both grouping passes | output is deep-equal to the pre-change grouping of the same fixture |
| E11 | burst-grouping: Lone repetitive group flanked by a claimed custom row is wrapped | decision-table | L1 | automated | a single `×N` group whose only absorbed neighbour is a claimed custom row | `groupToolBursts` | the bare-group exception does NOT apply; group is wrapped in a burst container with that row |
| E12 | server: Custom entry returns full payload | BVA | L1 | automated | fixture JSONL holding a custom entry whose payload is 303 pretty-printed lines / 13 KB | `GET /api/sessions/:id/entry/:entryId` | `200`; returned payload deep-equals the on-disk entry data — byte length exceeds the 4 KB per-string store cap, proving it did not come from the event store |
| E13 | blackhole: Compaction-borne fold metadata is not claimed | EP | L1 | automated | the blackhole manifest | read its `custom-entry-renderer` claim set | exactly `om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`; `om.folded` absent |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | custom-entry-rendering: Collapsed rows issue no requests | threshold | L1 | automated | a transcript of 500 claimed custom rows, all collapsed, mounted with a stubbed `fetch` | `fetch` call count === 0 | full mount + 1 re-render |
| P2 | custom-entry-rendering: Expansion issues exactly one request | threshold | L1 | automated | same transcript; expand exactly one row carrying an `entryId` | `fetch` call count === 1, and its URL targets that row's entryId | until the expanded view settles |
| P3 | proposal claim: burst-transparency reduces burst splits | comparative measurement | L1 | automated | a real captured session fixture containing `om.*` rows (the ~4.3k-row profile) | burst count with claims registered < burst count with none; both recorded in the test output | single grouping pass |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | custom-entry-rendering: plugin claim wins over the fallback | state | L1 | automated | a claimed custom row | chat renders it | the plugin component renders; `CustomEntryCard` does not |
| F2 | custom-entry-rendering: hidden group suppresses a claimed row too | decision-table | L1 | automated | claimed row in group `memory`; `customEventGroups.memory = false` | chat renders | nothing renders for that row, and it is excluded from row-visibility computations |
| F3 | custom-entry-rendering: absorbed row still renders when its group is visible | state-transition | L1 | automated | claimed row absorbed into a burst; its group visible | burst expanded | the plugin component renders inside the expanded burst, with the same collapsed line and expand affordance it shows at top level |
| F4 | custom-entry-rendering: gate holds for a row absorbed into a burst | state-transition | L1 | automated | same, group visibility `false` | burst expanded | the absorbed row renders nothing |
| F5 | consecutive-grouping: Absorbed custom row renders inside the expanded group | state-transition | L1 | automated | claimed row absorbed into a `×N` group's `rendered` slice; group visible | `CollapsedToolGroup` expanded | the plugin component renders — content identical to the top-level and burst sites |
| F6 | consecutive-grouping: Hidden group suppresses an absorbed custom row | state-transition | L1 | automated | same, group visibility `false` | group expanded | renders nothing |
| F7 | custom-entry-rendering: absorbed row survives an empty container | decision-table | L1 | automated | burst whose every tool member is hidden by `prefs.toolCalls`, holding one claimed custom row whose own group IS visible | chat renders | the custom row still renders; the container does not collapse to `null` |
| F8 | consecutive-grouping: Absorbed custom row survives an empty group | decision-table | L1 | automated | same shape against a `×N` group | chat renders | the custom row still renders |
| F9 | burst-grouping: Display preferences do not re-form bursts | state-transition | L1 | automated | a transcript with a claimed custom row absorbed into a burst | toggle its custom event group off, then on | burst boundaries are deep-equal across all three states; only the row's visibility differs |
| F10 | burst-grouping: claimed-type set is read once, not live | state-transition | L1 | automated | mount with an empty registry, then register a claim (mirroring the async registry mount) | subsequent unrelated re-render | bursts re-form at most once; a later re-render with an unchanged claim list produces identical boundaries |
| F11 | custom-entry-rendering: Row without an entry id offers no expand affordance | decision-table | L1 | automated | a claimed row with `entryId: undefined` (the `message_end` reducer arm) | chat renders it | the collapsed line renders; NO expand affordance is present; zero `fetch` calls |
| F12 | blackhole: Each claimed type is visually distinguishable | decision-table | L1 | automated | one row of each of the three claimed types | all render collapsed | three distinct icons; each line also exposes its event kind as text (accessible name is not icon-only) |
| F13 | blackhole: Record text is never interpreted | EP | L1 | automated | a record whose content is `**bold** https://example.com <img src=x onerror=1>` | expanded view renders it | the literal characters appear as text; no `<strong>`, no anchor, no element injection |
| F14 | blackhole: Observations / reflections / dropped expand as discrete records | state | L1 | automated | a fetched payload with 4 observations; one with 3 reflections; one dropped set | each row expanded | each record renders as its own item showing its content |
| F15 | end-to-end: om rows render through the plugin in a live dashboard | state-transition | L3 | automated | the docker harness with the blackhole plugin loaded and a session emitting an `om.observations.recorded` entry | the transcript renders, then the row is expanded | the collapsed line shows the labelled summary (not a JSON blob); expanding shows discrete records |
| F16 | blackhole: collapsed line reads well at real density | visual/subjective | — | manual-only | a real session transcript carrying hundreds of `om.*` rows | a human scrolls it | [judgment: the transcript reads as compact and scannable rather than noisy — no automatable observable] |
| F17 | D10: per-type icon choice | visual/subjective | — | manual-only | the three collapsed line variants | a human looks at them | [judgment: the icons read as meaningfully distinct and match their event's meaning] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | custom-entry-rendering: Throwing renderer falls back | fault-injection (abort) | L1 | automated | a claimed component that throws on render | chat renders that row | `CustomEntryCard` renders in its place; surrounding rows render normally; the transcript does not unmount |
| X2 | shell-slots: shouldRender gates the claim fail-closed | fault-injection (abort) | L1 | automated | `shouldRender` (a) returns false, (b) throws | claim resolution | both cases skip the claim and fall through to the generic fallback; the throw is contained |
| X3 | custom-entry-rendering: Evicted entry falls back to the stored body | fault-injection (abort) | L1 | automated | payload endpoint returns 404 | user expands a claimed row | the row's stored truncated body renders as plain text, unlinkified; no error screen |
| X4 | server: Unknown or evicted entry | fault-injection (abort) | L1 | automated | `entryId` absent from the session file | endpoint requested | `404` |
| X5 | server: Entry not yet flushed to disk | fault-injection (abort) | L1 | automated | a session whose custom entry is still buffered (no assistant message appended, so no/short `.jsonl`) | endpoint requested | `404`, logged as a normal miss rather than an error; a later request after the flush returns `200` |
| X6 | server: Entry on an abandoned branch | fault-injection (abort) | L1 | automated | a session file with a branch structure; request an entry outside the active leaf→root branch | endpoint requested | `404` |
| X7 | server: Entry belongs to a different session | fault-injection (abort) | L1 | automated | a valid `entryId` from session B | requested under session A | `404`; session B's payload is not returned |
| X8 | server: Traversal-shaped identifier is rejected | fault-injection (abort) | L1 | automated | `entryId` values `../../etc/passwd`, `a/b`, `..%2f..%2fetc%2fpasswd` | endpoint requested | `404` for each; no filesystem read outside the addressed session occurs (assert via a spied reader) |
| X9 | server: network guard | fault-injection (abort) | L1 | automated | a non-local request per the shared `networkGuard` contract | endpoint requested | rejected identically to its sibling session routes |
| X10 | custom-entry-rendering: payload fetch fails with a network error | fault-injection (abort) | L1 | automated | `fetch` rejects | user expands a claimed row | degrades to the stored body exactly as the 404 arm does; no unhandled rejection |

---

## Coverage summary

- Requirements covered: 17/17 delta requirements (6 capabilities)
- Scenarios by class: edge 13 · perf 3 · frontend 17 · error 10
- Scenarios by level: L1 40 · L2 0 · L3 1 · manual-only 2
- Scenarios by disposition: automated 41 · manual-only 2

## New infra needed

- none. L1 rows extend existing `__tests__` suites beside each touched module; F15 extends the
  existing Playwright suite against the `docker/test-up.sh` harness (port read from
  `.pi-test-harness.json`, never hardcoded).

## Notes on routing

- No L2 rows: this change adds no install, spawn, or multi-OS runtime surface. Its server
  addition is a single route testable in-process.
- Only ONE L3 row. Every gate, fallback, and grouping scenario is deterministic pure logic or a
  component-level render, which the unit tier asserts faster and more precisely. F15 exists
  because "om rows no longer look like JSON in a real dashboard" is the change's user-visible
  promise and deserves one end-to-end proof.
- E12's observable is deliberately a byte-length assertion above the store's 4 KB per-string cap.
  That is what distinguishes a correct JSONL-sourced implementation from a store-sourced one that
  would otherwise pass a naive "returns a payload" check.
