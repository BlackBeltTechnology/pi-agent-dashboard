
Denylists `/api/paired-devices/rotate` (browser bearer rotation; bearer-only credential plumbing). See change: harden-auth-credentials.
Denies verbs `prompt_response` + `extension_ui_response` and route `/api/session/:id/extension-ui-response` (agent prompt answers stay human-in-the-loop; chat gateway answers via its chat-local tier). See change: close-security-map-high-findings.

`remove_steering_entry`, `clear_steering_entries` denylisted (UI-only). See change: bridge-owned-cancellable-steer.
