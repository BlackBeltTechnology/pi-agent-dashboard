## MODIFIED Requirements

### Requirement: Pasted images surface as thumbnails in the ask_user tool card

For each successfully persisted image, the bridge SHALL emit one `asset_register` message (per-session-deduplicated by hash) so the dashboard's `AskUserToolRenderer` card can render a thumbnail. This is independent of the disk-write path: the disk file is for the LLM's `Read`, the `asset_register` is for the user's chat-history view. Both fire on resolve.

The emission SHALL use the same `connection.send({type: "asset_register", sessionId, hash, mimeType, data})` shape established by `markdown-image-inliner` callsites in the bridge extension.

#### Scenario: asset_register fires once per new hash per session
- **WHEN** an image with hash `H1` is pasted in `ask_user{method:"input"}`
- **THEN** the bridge SHALL emit `asset_register {sessionId, hash: H1, mimeType, data}` exactly once for that session
- **WHEN** the same image (same hash `H1`) is pasted again later in the same session
- **THEN** the bridge SHALL NOT emit a second `asset_register` for `H1` (the dashboard already has the bytes)

#### Scenario: Multiple images emit multiple asset_register events
- **WHEN** an `ask_user{method:"input"}` response carries three distinct images
- **THEN** the bridge SHALL emit three `asset_register` events (one per unique hash) BEFORE returning the tool result
