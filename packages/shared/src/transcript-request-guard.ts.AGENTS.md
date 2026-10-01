# transcript-request-guard.ts — index

`decideTranscriptRequest()` — pure, fs-free. Sessions are addressed by id ONLY: any path-bearing field refuses with `path-on-the-wire`, checked BEFORE the `foreign-session` check so two refusals cannot be differenced into an existence oracle. MOVED here from `extension/src` so the bridge's wire rule and the dashboard's retained-transcript read route enforce ONE rule from ONE source. See changes: add-pi-gateway-transport-identity (tasks 11.3/11.4), serve-retained-remote-transcripts.
