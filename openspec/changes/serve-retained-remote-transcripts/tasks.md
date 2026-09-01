# Tasks — serve-retained-remote-transcripts

Carries task 12.52 and the struck "serves history predating the attach" clause
of 13.5 from `add-pi-gateway-transport-identity`, where the read path was
deferred. `RemoteTranscriptStore.read()` already exists; nothing calls it.

## 1. Read path

- [ ] 1.1 Add a route serving a retained remote transcript BY SESSION ID ONLY, refusing any path-bearing field via `decideTranscriptRequest` (D12/D13)
- [ ] 1.2 Return the store's completeness flag alongside the entries — a partial transfer must never render as the whole conversation
- [ ] 1.3 Refuse the read for a session that is NOT remote-origin, so the route cannot become a second way to read local transcripts

## 2. Client

- [ ] 2.1 Request retained history for a remote-origin session
- [ ] 2.2 Render INCOMPLETE distinctly from EMPTY, so "nothing was captured" and "the read failed" are not the same screen

## 3. Tests

- [ ] 3.1 Write the L3 scenario deferred as 12.52 (history predating the attach renders), modelled on `tests/e2e/large-session-replay.spec.ts`
- [ ] 3.2 Prove it fails on revert: with the route removed the spec must go red
- [ ] 3.3 Restore the struck clause of 13.5 in the archived parent change's record

## 4. Ship

- [ ] 4.1 `openspec archive serve-retained-remote-transcripts`
