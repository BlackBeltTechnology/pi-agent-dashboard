# agent-credential-refusal.spec.ts — index

L3 pi-agent credential refusal (#E43, #F7): seeds `models.json`/`mcp.json` + a skill in container `~/.pi/agent` (removes only what it created; harness `auth.json` marker `e2e-fake`); observe-tier bearer gets 403/no bytes from `/api/file`, `/api/session-file`, `/api/pi-resource-file`, `/api/file/write-binary` (>= 400); editor pane opening `models.json` shows `denial-notice` with no grant dialog/remedy while the skill `.md` still renders. See change: close-security-map-high-findings.
