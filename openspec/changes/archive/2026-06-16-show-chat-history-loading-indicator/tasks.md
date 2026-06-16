## 1. Loading-state plumbing (App + message handler)

- [x] 1.1 In `packages/client/src/App.tsx`, add reactive per-session loading state: `const [loadingHistory, setLoadingHistory] = useState<Map<string, boolean>>(new Map())`. Add a `loadingHistoryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())` for the safety-net timers.
- [x] 1.2 At the lazy-subscribe site (~`App.tsx:737`), when sending `subscribe` for `selectedId`, set `loadingHistory[selectedId] = true` and arm a 15s safety-net timer that clears the flag and removes itself. Clear any existing timer for that id first.
- [x] 1.3 Pass `setLoadingHistory` and `loadingHistoryTimersRef` into the `useMessageHandler` deps object (mirror how `setSessionStates` / `maxSeqMapRef` are threaded).
- [x] 1.4 Add a small helper `clearLoadingHistory(id)` (in App or a tiny util) that sets the flag false and clears+deletes the safety-net timer. Use it from every exit edge.

## 2. Wire the exit edges in `useMessageHandler.ts`

- [x] 2.1 In `case "event_replay"`: after reducing the batch, if `msg.events.length > 0` (first/any content) → `clearLoadingHistory(msg.sessionId)`.
- [x] 2.2 In `case "event_replay"`: if `msg.isLast === true` → `clearLoadingHistory(msg.sessionId)` (covers the genuinely-empty session whose only message is `events:[], isLast:true`).
- [x] 2.3 In the `session_updated` handler: if `updates.dataUnavailable === true` → `clearLoadingHistory(msg.sessionId)` (load-failure path from the cold branch's `.catch` / unsuccessful result).
- [x] 2.4 Confirm the warm `subscribe` path still clears: warm replay sends non-empty batches → covered by 2.1; a warm subscribe to an empty in-memory session sends `event_replay{events:[],isLast:true}` → covered by 2.2.

## 3. `ChatView` 3-way empty state

- [x] 3.1 Add a `loadingHistory?: boolean` prop to `ChatView` (the selected session's value, read in `App.tsx` from the `loadingHistory` map and passed down).
- [x] 3.2 Replace the single empty-state block (`ChatView.tsx:636`) with a 3-way branch:
  - `loadingHistory && state.messages.length === 0 && !state.streamingText && !pendingPrompt && !pendingSteering` → loading indicator (spinner + i18n "Loading conversation…").
  - else if the existing empty condition holds → "No messages yet".
  - else → bubbles (unchanged).
- [x] 3.3 Use the existing `mdiLoading` icon with `animate-spin` (already imported in ChatView) and `i18nT("auto.loading_conversation", undefined, "Loading conversation…")`. Match the empty-state container styling (`flex items-center justify-center h-full text-[var(--text-tertiary)]`).
- [x] 3.4 Ensure `loadingHistory` for a session is keyed to the currently-selected session so switching sessions shows the correct state.

## 4. Tests

- [x] 4.1 `packages/client/src/components/__tests__/ChatView.test.tsx`: with `loadingHistory={true}` and empty messages → renders the loading indicator, does NOT render "No messages yet".
- [x] 4.2 Same file: with `loadingHistory={false}` and empty messages → renders "No messages yet" (existing behavior preserved).
- [x] 4.3 Same file: with messages present → renders bubbles regardless of `loadingHistory` (no spinner over content).
- [x] 4.4 `useMessageHandler` test: a non-empty `event_replay` batch clears the loading flag for that session.
- [x] 4.5 `useMessageHandler` test: an `event_replay{events:[],isLast:true}` (empty session) clears the loading flag (→ ChatView will show "No messages yet").
- [x] 4.6 `useMessageHandler` test: `session_updated{dataUnavailable:true}` clears the loading flag.

## 5. Verification

- [x] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` — all green; grep for FAIL. (18 pre-existing failures in pi-image-fit/git-worktree-lifecycle only; all loading-history + ChatView + useMessageHandler tests pass.)
- [x] 5.2 Manual (remote): connect a remote client, open a large old/ended session → spinner shows during transfer, content replaces it, no "No messages yet" flash on a non-empty session.
- [x] 5.3 Manual (host): open the same session on localhost → spinner is sub-perceptible / brief, content shows immediately, no regression.
- [x] 5.4 Manual: open a genuinely empty/new session → "No messages yet" still shows (no stuck spinner).
- [x] 5.5 Docs: update matching `docs/file-index-client.md` rows for `App.tsx`, `useMessageHandler.ts`, `ChatView.tsx` (delegate to a docs subagent, caveman style).
