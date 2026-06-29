# fix-file-preview-survives-message-churn

## Why

In chat view, clicking a file link opens the inline `FilePreviewOverlay`
(remote / no-editor fallback). When a new chat message arrives — or the
in-flight assistant message streams another token — **the open preview closes
itself**, forcing the user to reopen it.

Root cause: the overlay's open-state lives at the **leaf**, inside each
`FileLink`:

```
ChatView
 └─ message (key=msg.id)
     └─ MarkdownContent(content)        ← react-markdown REBUILDS this tree
         └─ renderInlineString → tokenize   on every content change
             └─ <FileLink>
                 └─ useFileOpenRouting()
                     └─ useState<preview>   ◄── state lives HERE (leaf)
                         └─ <FilePreviewOverlay/>  (in a DialogPortal)
```

`useFileOpenRouting.ts:38` holds `useState<PreviewTarget|null>(null)`. The
`DialogPortal` only relocates DOM nodes; React ownership stays under
`FileLink`. So **any remount of `FileLink` resets `preview` to `null` and the
overlay disappears.** A new message remounts `FileLink` through two
independent paths:

```
TRIGGER 1 — streaming → committed transition
  streaming:  ChatView:559  <MarkdownContent content={state.streamingText}>   (live, unkeyed branch)
  completed:  ChatView:532  <div key={msg.id}><MarkdownContent .../></div>    (committed branch)
  → different render branch → FileLink unmounts → preview=null → overlay gone

TRIGGER 2 — react-markdown reparse
  new token / re-render → react-markdown re-parses → new element tree
  → `keyPrefix-i` keys cannot preserve identity across a structural reparse
  → FileLink remounts → overlay gone
```

(A latent third path: `ChatView:318` `key={`group-${idx}`}` uses index keys on
tool-call groups, so any grouping shift remounts that branch too — same bug
class, not the user's current trigger.)

"Give FileLink a stable key" does **not** fix this — react-markdown throws away
and rebuilds the element tree on content change, and streaming→committed is two
genuinely different branches. Leaf-local state in a rebuilt subtree is
structurally doomed.

## What Changes

Hoist the preview open-state **above** the churning message subtree:

- Add a `FilePreviewProvider` / `FilePreviewContext` exposing
  `{ target, open(path, line, cwd), close() }`, mounted once at `ChatView`
  level (above `groupedMessages.map`).
- `FileLink` becomes **stateless** for preview: its `onClick` calls
  `ctx.open(...)` instead of owning a `useState`. The `useFileOpenRouting`
  editor-vs-preview routing decision stays; only the preview *state ownership*
  moves up.
- Render **one** `<FilePreviewOverlay>` at the provider level, reading `target`
  from context. Its owner sits above all message reconciliation, so streaming
  transitions, markdown reparses, and new messages can no longer close it.

Bonus consequences (in-scope, fall out of the design):
- Only one preview can be open at a time (today every `FileLink` carries its
  own latent overlay instance).
- `cwd` is resolved once at the call site rather than read per-`FileLink`.

Out of scope:
- The `/view` command + `ViewTarget` editor-pane preview path
  (`file-and-url-preview` capability) — separate surface, unaffected.
- Reworking `groupConsecutiveToolCalls` index keys (TRIGGER 3) — tracked
  separately; this change fixes the file-preview symptom, not all index-key
  fragility.

## Impact

- Affected spec: `tool-output-linkification` (overlay lifecycle requirement).
- Affected code:
  - `packages/client/src/components/tool-renderers/useFileOpenRouting.ts` — drop preview `useState`, dispatch to context.
  - `packages/client/src/components/tool-renderers/FileLink.tsx` — stop rendering own overlay; call context `open`.
  - `packages/client/src/components/FilePreviewOverlay.tsx` — rendered once by provider; props now sourced from context target.
  - `packages/client/src/components/ChatView.tsx` — wrap message list in `FilePreviewProvider`, render single overlay.
  - New: `packages/client/src/components/FilePreviewContext.tsx` (provider + hook).
- No server, protocol, or persistence changes. Pure client render-tree refactor.
- Risk: low. Behavior-preserving for the open/close interaction; the only
  observable change is that the overlay now survives message updates.
