## Context

Today's `ask_user{method:"input"}` dialog renders a single-line `<input type="text">` and shuttles a bare string back through `ctx.ui.input` (pi-coding-agent API). The main prompt composer in `CommandInput` has long since gained a multiline `<textarea>` with image paste, riding to the agent as a mixed content block via `pi.sendUserMessage([{type:"text"}, {type:"image"}, …])`. The asymmetry is user-visible and obnoxious: when an agent asks "paste the screenshot here," the user has to switch to the main prompt.

The interactive-renderer registry (`packages/client/src/components/interactive-renderers/registry.ts`) maps `type:"input"` → `InputRenderer` globally. Any callsite routing through `PromptBus` with `type:"input"` lands in the same renderer — standalone `ask_user{method:"input"}`, the per-sub-question `input` step inside `method:"batch"`, and any other extension issuing input prompts. One renderer change ripples through all of them.

The `markdown-image-inliner` (`packages/extension/src/markdown-image-inliner.ts`) already establishes a convention for assistant-side image bytes flowing in the *other* direction: rewrite `![alt](path)` → `![alt](pi-asset:<hash>)` and ship bytes out-of-band via `asset_register` events. Crucially, `pi-asset:<hash>` is a display-only convention — the LLM cannot resolve it as a filesystem path. To put images in front of the LLM via `ask_user`, we need a real on-disk path the LLM's `Read` tool can open.

`useImagePaste` is already controlled-mode-friendly. `ImagePreviewStrip` is already shared. The wire pattern for shipping `ImageContent[]` from browser to bridge already exists end-to-end via `send_prompt`. The pieces are all here; this change wires them together.

## Goals

- Make `ask_user{method:"input"}` (and the `input` sub-question arm of `method:"batch"`) feel identical to the main prompt composer: autosizing textarea, `Cmd/Ctrl+Enter` to submit, clipboard image paste, thumbnail strip.
- Persist pasted images to disk so the LLM's `Read` tool can see them. Reuse existing hash / MIME / size conventions.
- Render thumbnails of pasted images in the `ask_user` tool card via `asset_register` so chat history shows what was sent.
- Zero behavioral regression when no images are pasted — the tool result for a plain text response is unchanged.

## Non-Goals

- No image-paste support in `confirm` / `select` / `multiselect` methods. (No surface for it; no demand.)
- No "image-paste supported" hint in the textarea or in the tool's schema description. Discovery is silent, matching the main composer.
- No `pi-dashboard prune-attachments` CLI in v1. Best-effort cleanup on `session_end`; orphan-accumulation rate is expected to be negligible.
- No file uploads beyond image MIME types (jpeg/png/gif/webp). Drag-drop is out of scope for v1 — paste only, matching the existing `useImagePaste` contract.
- No multi-block tool_result content (`[{type:"text"}, {type:"image"}, …]`). Option A from explore was rejected because tool_result image-content support is provider-dependent; option C (paths-in-text, LLM Reads on demand) is provider-agnostic.
- No change to TUI behavior. The terminal fallback path through `ctx.ui.input` is text-only and stays text-only.

## Decisions

### Decision 1: Bypass `ctx.ui.input` for `method:"input"` (option C from explore)

The `ask_user` tool currently dispatches every method through `ctx.ui.*`, which returns plain strings. To get `ImageContent[]` out of the dashboard back to the bridge, the standalone `input` case and the batch `input` sub-question case must bypass `ctx.ui.input` and call the lower-level `bridgeContext.promptBus.request(...)` directly, where the resolved `PromptResponse` carries the optional `images` field.

**Alternatives considered:**

- **Option A — multi-block tool_result with `{type:"image"}` content.** Tool result becomes `[{type:"text", text:"User responded: …"}, {type:"image", data, mimeType}, …]`. Rejected: Anthropic accepts image content blocks in tool_results, but OpenAI's Chat Completions tool messages are historically text-only. We do not control the LLM provider; making the tool unusable on OpenAI is a non-starter.
- **Option B — bridge follow-up-injects images as a separate user message.** Tool returns text-only; bridge then calls `pi.sendUserMessage([{type:"image"}, …])` as a synthetic user turn. Rejected: works on more providers than A but creates phantom user turns in the transcript and breaks the tool-call-is-one-round-trip invariant. Confusing UX, debugging hazard.
- **Option C — write to disk, return paths.** Tool result is a single `{type:"text"}` block whose body is `User responded: ${JSON.stringify({value, attachments: [...]})}`. LLM sees the paths and uses its `Read` tool to view them. Reuses the LLM's existing vision-via-Read path. Provider-agnostic. Tokens are minimized — base64 only flows when the model chooses to look. **Selected.**

### Decision 2: Attachments live at `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`

Per-session subdirectory under the dashboard's home-owned directory tree. Matches the ownership pattern already established by `~/.pi/dashboard/config.json`, `server.log`, `model-proxy.jsonl`, `tool-overrides.json`.

**Alternatives considered:**

- `<cwd>/.pi-attachments/<hash>.png` — rejected, pollutes the user's repo / cwd.
- `/tmp/pi-ask-user/<sessionId>/<hash>.png` — rejected, cross-platform path handling is gnarly and disappears across reboots mid-session.

**Naming:** `<hash>.<ext>` where `hash = sha256(bytes).slice(0,16)` (matching `markdown-image-inliner.hashBytes`) and `ext` derives from the MIME via the existing allowlist (`image/png` → `.png`, `image/jpeg` → `.jpg`, etc.). Content-addressable, so accidental re-pastes of the same image dedup automatically.

### Decision 3: Tool result evolves only when attachments are present

For a plain text-only response:

```
User responded: "the typed text"
```

(unchanged from today.)

For a response with attachments:

```
User responded: {"value":"the typed text","attachments":[{"path":"/Users/.../pi-asset-1.png","mimeType":"image/png","bytes":142336}]}
```

The JSON-as-text shape parses cleanly and is the least-disruptive evolution of the existing `User responded: ${JSON.stringify(result)}` pattern in `ask-user-tool.ts:455`. Models can ignore it as prose or parse it as JSON; either works.

**Alternatives considered:**

- Always JSON, even for the no-attachment case. Rejected: gratuitous behavior change for the 99% of `ask_user` calls that will never carry attachments.
- Free-form prose with paths: `User responded: "…"\nAttachments:\n- /path/a.png\n- /path/b.jpg`. Rejected: less parseable; harder to extend if we later want byte counts or alt text.

### Decision 4: `asset_register` for dashboard thumbnails, disk write for LLM

Two paths in parallel for the same bytes. The `asset_register` event makes thumbnails appear in the `AskUserToolRenderer` card (so chat history shows what was pasted); the disk write makes paths Readable by the LLM. Duplicated I/O is acceptable — one base64 send per asset, one disk write per asset, both fire-and-forget after the resolve.

Hash dedup applies independently on each path: `markdown-image-inliner`-style per-session `alreadyEmitted: Set<string>` for `asset_register`, and check-before-write for disk (content-addressable, so re-writing is a no-op anyway).

### Decision 5: Caps mirror `markdown-image-inliner`

5 MB per image, 20 MB cumulative per `ask_user` response. Matches the assistant-side caps already enshrined in `MAX_PER_IMAGE_BYTES` / `MAX_PER_MESSAGE_BYTES` so the rules are symmetric across both directions.

Oversize images are dropped client-side with the existing `useImagePaste` transient-banner UX (3-second toast, then ignored). The bridge re-validates caps as a defense-in-depth check and silently drops oversize bytes if the client somehow bypasses them.

### Decision 6: Best-effort cleanup on `session_end`

Wire a `session_end` hook in `bridge.ts` that `rmSync(attachmentDirForSession(sid), { recursive: true, force: true })`. Failures are logged and swallowed.

Orphans accumulate if the dashboard crashes between paste and session end. Expected rate is negligible at human paste cadence; revisit only if telemetry warrants. No prune CLI in v1.

### Decision 7: Renderer-level change applies universally

`InputRenderer.tsx` is the global handler for `type:"input"` in the registry. Replacing its body upgrades every callsite: standalone `ask_user{method:"input"}`, batch sub-questions with `sq.method === "input"`, and any other extension routing through `PromptBus` with `type:"input"`. This is intentional and per agreement.

A corollary: the renderer must keep the historical `enteredValue` display in the post-resolve "answered" state working for the no-attachment case (the existing one-line green-check summary), and extend it to show "(+N image)" or similar in the attachment case.

### Decision 8: Schema-description silence

The `ask_user` tool's `method:"input"` schema description does not mention image paste. Two reasons: (a) the affordance is end-user-driven, not LLM-driven — the LLM can't "ask for an image attachment" — and (b) advertising it inflates the tool description on every turn for an edge-case capability. The LLM discovers attachments naturally when they appear in the tool result; no upfront prompt-tax.

Likewise the textarea shows no "Paste images supported" hint. The main composer doesn't have one either; symmetry is the right precedent.

## Risks / Trade-offs

- **Two bypass sites in `ask-user-tool.ts`** create a fork from the otherwise-uniform `ctx.ui.*` dispatch. → Mitigation: explicit comment above each bypass call referencing this design doc; both arms call the same private helper so duplication is just one line per site.
- **`PromptResponse.images` is a new field on a shared interface.** → Mitigation: optional field, backward compatible; existing adapters and renderers ignoring it continue to work. The `dashboard-default-adapter` is the only adapter that needs to know how to surface it (and via the renderer, which is what changes).
- **Disk leaks on crash.** → Mitigation: documented; not load-bearing; revisit if telemetry warrants. `~/.pi/dashboard/attachments/` is easy to manually clean.
- **LLM tries to `Read` a path that no longer exists** (e.g. session ended between tool response and follow-up turn). → Mitigation: paths only get cleaned up on `session_end`, which is also when the LLM stops running. The window for stale-path reads is functionally zero. If it does happen, the LLM's `Read` returns ENOENT and the LLM can apologize.
- **Per-image base64 transmitted twice** — once as `asset_register` for the dashboard thumbnail, once as the disk write. → Mitigation: both flows are bounded by the caps (5 MB / 20 MB); the duplication is the cost of clean separation between user-facing display and LLM input.
- **Batch summary format changes** for sub-questions that received images. → Mitigation: the per-sub-question entry's JSON value naturally grows from `"text"` to `{value, attachments}`; the surrounding `${i}. ${title}:` framing is unchanged. Existing consumers that only `.match()` the leading line are unaffected.

## Migration Plan

No migration required. This is purely additive:

1. Ship the renderer change first (textarea + paste UI), keyed to ignore the `images` field if the protocol round-trips it. Renderer change is independently useful even before the protocol change lands (multiline alone).
2. Ship the protocol field next (`PromptResponse.images?`). No-op when no images are pasted.
3. Ship the bridge attachment writer + `asset_register` emission. When all three are deployed, paste-with-images works end-to-end.

**Rollback strategy:** the renderer change is a single-file revert. The protocol field is optional; reverting it is field-removal with no schema migration. The bridge attachment writer is gated on `response.images?.length > 0` — if removed, behavior collapses back to text-only, no orphan paths in tool results.

## Open Questions

None at this time. All v1 decisions are locked per the explore session.

Possible follow-ups (out of scope for this change):

- `pi-dashboard prune-attachments` CLI for periodic cleanup if disk leaks become real.
- Drag-and-drop attachment support in the textarea (paste-only for now, matching `useImagePaste`'s current contract).
- Generalize the attachment store helper so other tools (`request-changes`, future `confirm` upgrades, etc.) can reuse it.
- Extend to non-image MIME types (PDF, text snippets) if a use case appears.
