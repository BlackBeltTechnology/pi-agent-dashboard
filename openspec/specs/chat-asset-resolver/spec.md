# Chat Asset Resolver

## Purpose

The chat asset resolver is the client-side counterpart to the bridge's `pi-asset:` rewriting. It maintains a per-session, in-memory image-asset registry (`Map<hash, { data, mimeType }>`) populated from `asset_register` WebSocket messages, exposes the registry to descendant `MarkdownContent` components via React context (`SessionAssetsContext`), and resolves `![alt](pi-asset:<hash>)` srcs to `data:<mimeType>;base64,<data>` URLs. External (`http(s):`, `data:`, `blob:`, fragment, relative) srcs continue to render via the default ReactMarkdown `<img>` so existing web-image and tool-result-image behavior is preserved.

## Requirements

### Requirement: Client maintains per-session asset registry from asset_register messages
The client SHALL recognize the top-level `asset_register` WebSocket message and store each one's `(hash, data, mimeType)` triple into a per-session asset map keyed by hash. The asset map SHALL live on Session state (NOT in the rolling event buffer), so per-event LRU eviction does not invalidate the registry. On WebSocket reconnect, the server's subscription replay SHALL re-emit one `asset_register` per entry in the session's asset registry BEFORE the replayed events, so the registry is fully populated by the time any referencing `message_update` / `message_end` is reduced.

#### Scenario: Live asset_register populates the session map
- **WHEN** the client receives an `asset_register` message with `{ sessionId: "S", hash: "abc", data: "<base64>", mimeType: "image/png" }`
- **THEN** the session state for `"S"` SHALL contain `assets["abc"] = { data: "<base64>", mimeType: "image/png" }`

#### Scenario: Reconnect replay re-populates the registry
- **WHEN** the client disconnects and re-subscribes to a session whose server-side `Session.assets` already contains `"abc"`
- **THEN** subscription replay SHALL emit an `asset_register` for `"abc"` before the replayed events, and the resulting client-side asset map SHALL contain `"abc"`

#### Scenario: Asset survives event-buffer eviction
- **WHEN** the rolling event buffer no longer contains the originating `message_update` but `Session.assets` still contains the asset
- **THEN** the resolver SHALL still find the asset in the session map and render it

#### Scenario: Cross-session isolation
- **WHEN** session `"A"` has registered hash `"X"` and session `"B"` has not
- **THEN** the asset map for session `"B"` SHALL NOT contain `"X"` and a `pi-asset:X` reference in `"B"` SHALL render as the unresolved placeholder

### Requirement: SessionAssetsContext provides asset registry to MarkdownContent
The client SHALL expose a React context (`SessionAssetsContext`) carrying the current session's asset map. `ChatView` SHALL populate the context with the active session's assets. `MarkdownContent` instances rendered without a provider in scope SHALL receive an empty map (default value), in which case any `pi-asset:` references render as the unresolved placeholder.

#### Scenario: ChatView provides assets to descendant MarkdownContent
- **WHEN** ChatView renders the assistant message bubble for session "S" whose asset map contains hash "abc"
- **THEN** any descendant `MarkdownContent` SHALL be able to resolve `pi-asset:abc`

#### Scenario: MarkdownContent without provider has empty map
- **WHEN** `MarkdownContent` is rendered outside any `SessionAssetsContext.Provider` (e.g. inside `PackageReadmeDialog`)
- **THEN** the context value SHALL be an empty map and any `pi-asset:` reference SHALL render as the unresolved placeholder

### Requirement: MarkdownContent img override resolves pi-asset URIs
The `MarkdownContent` component SHALL register an `img` component override with ReactMarkdown. The override SHALL inspect `props.src` and:
- If `src` begins with `pi-asset:`, look up `src.slice("pi-asset:".length)` in the current `SessionAssetsContext` map. If found and its `mimeType` begins with `image/`, render `<img src="data:<mimeType>;base64,<data>" alt={alt} …>`; a registered asset with any other `mimeType` SHALL render the unresolved placeholder instead. If not found, render an unresolved placeholder (a small italic text node `[image not yet loaded]` or equivalent visual; exact wording an implementation detail but MUST be visible).
- Otherwise, for an allowed lower-case scheme — `data:image/*`, `http:`, `https:`, `blob:` — or a `#` or relative URL the agent didn't rewrite, render a default `<img>` with the original `src` unchanged so existing web-image behavior is preserved. Any other scheme (e.g. `data:text/html`, `javascript:`) reaches the override with no `src` (see `client-untrusted-content-sanitization`).

#### Scenario: pi-asset src with registered hash renders the image
- **WHEN** `MarkdownContent` renders text containing `![pic](pi-asset:abc)` and the session asset map contains `"abc": { data: "iVBOR...", mimeType: "image/png" }`
- **THEN** the rendered DOM SHALL contain `<img src="data:image/png;base64,iVBOR..." alt="pic">`

#### Scenario: pi-asset src with unregistered hash renders placeholder
- **WHEN** `MarkdownContent` renders text containing `![pic](pi-asset:zzz)` and `"zzz"` is NOT in the session asset map
- **THEN** the rendered DOM SHALL show a visible unresolved-placeholder element (not a broken-image glyph and not silent absence)

#### Scenario: External URL src unchanged
- **WHEN** `MarkdownContent` renders text containing `![logo](https://example.com/logo.png)`
- **THEN** the rendered DOM SHALL contain `<img src="https://example.com/logo.png" alt="logo">` exactly as today's default ReactMarkdown behavior

#### Scenario: data: src unchanged
- **WHEN** `MarkdownContent` renders text containing `![](data:image/png;base64,XXX)`
- **THEN** the rendered DOM SHALL contain `<img src="data:image/png;base64,XXX" …>`

#### Scenario: pi-asset with a non-image mimeType renders the placeholder
- **WHEN** the session asset map contains `"abc": { data: "PHNjcmlwdD4=", mimeType: "text/html" }` and `MarkdownContent` renders `![pic](pi-asset:abc)`
- **THEN** no `<img>` with a `data:text/html` source SHALL be rendered and the unresolved placeholder SHALL be shown

#### Scenario: Dropped-scheme image is not clickable
- **WHEN** `MarkdownContent` renders `![x](data:text/html;base64,AAAA)`
- **THEN** the rendered image SHALL have no `src` and clicking it SHALL NOT open the lightbox

### Requirement: pi-asset rendering is reactive to asset-map updates
When a `pi-asset:<hash>` reference appears in `MarkdownContent` BEFORE its corresponding `asset_register` has arrived (theoretically possible if the bridge orders events incorrectly or the client receives them out of order), the placeholder SHALL automatically be replaced with the resolved image once the asset_register lands and the session asset map is updated, without requiring a remount of the message.

#### Scenario: Asset arrives after its reference
- **WHEN** `MarkdownContent` first renders text containing `![pic](pi-asset:abc)` while `"abc"` is absent from the session map, then later the reducer adds `"abc"` to the map
- **THEN** the same `MarkdownContent` instance SHALL re-render with the resolved image, without a full unmount/remount of the chat row
