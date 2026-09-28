# push-webhook-settings.spec.ts — index

L3 #F9: enables `push` in harness config.json + starts loopback receiver in-container (docker exec), restarts; adds webhook via Settings ▸ Sessions, Send test → exactly 1 POST `type:"session_attention"`; row shows `label (origin)` only, page never shows path/query. afterAll removes token, drops `push`, restarts. See change: add-server-push-notifications.
