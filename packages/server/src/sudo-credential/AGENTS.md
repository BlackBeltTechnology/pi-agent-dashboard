# DOX — packages/server/src/sudo-credential

Sudo credential prompt, server half: in-memory relay between a bridge's `sudo_credential_request` and the operator's browsers. Spec: `openspec/changes/add-sudo-credential-prompt/`.

| File | Purpose |
|------|---------|
| `relay.ts` | `createSudoCredentialRelay({browsers,sendToBridge,isBridgeTrusted,ackDeadlineMs?})`. One pending slot per session keyed `(sessionId, callId)`; control-tier audience via `SudoBrowserSeam` (`browserGateway.sudoSeam`); 2 000 ms ack timer; first answer wins + `_dismiss`; refuses at once with `_cancel{reason:"unanswerable"}`; drops empty/>1024-char passwords; cache metadata + pending replay (`replayTo`); `onBridgeDisconnect`/`forgetSession`. Password never stored/logged; logs = event name + callId. Wired in `server.ts`, `event-wiring.ts` (bridge frames, `onDisconnect`) and `browser-gateway.ts` (browser frames, subscribe replay). See change: add-sudo-credential-prompt. |
