# Route file previews to the grant dialog, explain when it can't ask, and fix the dialog's defects

## Why

`add-access-grant-dialog` shipped (archived `2026-09-23`, merge `f827e381e`).
`/api/file/raw` already passes a hold target, so a denied preview read *can*
suspend and raise the dialog. A spike against the compiled build shows it never
does for images:

| Transport (same page, same file, prompting enabled, host gate `enforce`) | Result |
|---|---|
| `<img src>` / `new Image()` | `img ERROR`, no status or body, server logs `degraded:ineligible`, **no prompt** |
| `fetch(rawUrl)` | dialog "Allow file access? `/private/tmp`" → Allow once → **200 image/png, 251,511 B** |

The filesystem plane is *held*, so eligibility needs the request itself to carry
`X-Pi-Grant-Channel`. The global fetch wrapper (`installGrantChannelFetch`) adds
that header, but a browser subresource load (`<img>`, `<video>`, `<audio>`)
never goes through `fetch`. **Image and streamed-media previews are structurally
ineligible.** The operator sees `Couldn't load image: /tmp/grid-s15-500.png` and
nothing else. (pdf.js loads through the global `fetch`, so PDFs already reach the
dialog, but with several requests per document, which Allow once cannot cover.)

The spike and two adversarial review cycles found more.

**Defects this change fixes:**

1. **The dialog can offer an answer that can never apply.** The filesystem
   plane's `subjectOf` does not apply `isUngrantableSubject` (the cwd plane
   does, `planes.ts:99`). When the subject is an ancestor of `$HOME`, the
   operator is prompted, answers Allow, and the resume path refuses. Reproduced.
2. **The forbidden list is not platform-scoped.** On POSIX the Windows literals
   become cwd-prefixed junk (`<cwd>/C:\Windows`); on Windows the POSIX literals
   become drive-root paths (`C:\etc`), and a system drive other than C: is not
   covered. The junk is not inert: because the shipped containment rule refuses
   any candidate that *contains* a forbidden entry, the junk entries make the
   server's cwd and its ancestors ungrantable. The containment rule itself is
   correct and stays; the junk entries go.
3. **The denial body names a different folder than the dialog.** The body names
   the lexical `/tmp`; the dialog and the store name `/private/tmp`.
4. **Agent-opened surfaces can raise the dialog.** Canvas auto-open
   (`CanvasDriver`) opens files with no user click. Every registered viewer that
   loads through `fetch` (markdown, HTML, monaco, PDF via pdf.js, …) already
   carries the capability. An agent, possibly prompt-injected, can put a grant
   prompt in front of the operator by opening a file outside the cwd.

**Behaviour this change explains but does not alter:** the 120 s post-answer
backoff, allow-once admitting only one request, routes that can never suspend a
request, prompting being off by default, the host gate in report mode. Each
reaches the operator as a silent 403 today; each gets a named outcome.

## What changes

- **Eligible transport for click-opened images.** Images in the editor tab,
  preview overlay and lightbox (same-origin file-route sources only) load
  through `fetch`, so a click-opened image reaches the shipped dialog. The dialog
  itself is unchanged.
- **Only declared operator surfaces can raise the dialog.** Provenance fails
  closed: a preview opts out unless the editor pane (per tab, from a persisted
  `autoOpened` field decided by the action that activated the tab), the file
  preview overlay or the lightbox declares it operator-opened. Agent-emitted
  chat cards and any undeclared surface are therefore opted out, makes every
  registered viewer (pdf.js included) send an explicit opt-out. The notice offers
  **Ask for access**, a click-triggered eligible re-request, when the client can
  carry a capability.
- **Multi-request media (video, audio, PDF) keeps ranged loading**, never
  prompts without a click on its notice, and says before the click that a
  one-time answer admits only a check, not the stream or document.
- **A self-describing denial body.** The 403 gains `promptOutcome`, a closed enum
  covering every reason the coordinator and registry emit plus routes that can
  never suspend. It is disclosed only to authenticated or genuinely local
  callers, under the predicate `/api/health` uses for its access block (extracted
  into one shared helper). The subject is exactly what a grant would store.
- **One shared `DenialNotice`** on six surfaces. It explains the outcome and
  offers only a re-request or a Settings pointer. It never grants.
- **Dialog fixes:** no prompt for an ungrantable subject (with a log line); a
  platform-scoped forbidden list whose junk entries are removed, keeping the
  shipped both-directions containment rule; a sharper deny reason for requests
  that join an existing entry (the verdict is unchanged).

## What does not change

- No new grant path. Grants come from the shipped dialog or Settings → Access.
- The dialog, its verdicts, the backoff, the registry's bounds, types and stats,
  and prompting's off-by-default setting are unchanged. Two things change around
  them: a deny reason string is refined (the verdict is not), and a registry
  entry's dialog gets its own owner (`dialogChannel`), so a dialog is decided
  and charged against the requester that raises it. The registry gains that
  field and an optional reason on the `joined` outcome; no bound value changes. The only eligibility
  changes are one request-declared opt-out and one never-prompt condition.
- Registered viewers outside the six notice surfaces keep their current error
  state; they only gain the auto-open opt-out.
- The inline chat-card image, the expanded `/view` preview route, and images
  rendered inline inside markdown stay silent (follow-up). Clicking one open in the lightbox is an operator action
  and behaves like any click-opened image.
- With a cross-origin API base, images keep loading through `<img>` as today.

## Impact

- New spec: `preview-denial-remedy`
- Modified specs: `access-grant-dialog` (ungrantable subjects are never
  prompted), `access-grant-eligibility` (a request can declare itself
  ineligible), `access-grant-registry` (a dialog is decided and charged against the
  requester that raises it), `path-anchor-grants` (body subject = stored subject,
  `promptOutcome`, platform-scoped forbidden list)
- **Security-relevant widening:** after the forbidden-list fix, the server's cwd
  and its ancestors below `$HOME` (for this checkout: `/Users/robson/Project`)
  become grantable unless they contain a specified forbidden subject. The
  ancestor ladder can then offer them as rungs and YOLO's scope reaches them,
  as it already does for any other directory under `$HOME`. Decided by the
  operator on 2026-09-24.
- Server: `access/planes.ts`, `access/forbidden-subjects.ts`,
  `access/pending-grant-registry.ts` (promotion re-attribution),
  `access/containment-gate.ts`, `access/grant-coordinator.ts` (log line, reason
  refinement for joined requests), `routes/file-routes.ts` (disclosure option at
  every gate call, incl. `gateFilePath`/`gateOfficeFile`),
  `routes/session-routes.ts` (session-file read), `routes/system-routes.ts` + a
  shared disclosure-predicate helper
- Client: `lib/access-grants/grant-channel.ts`,
  `lib/layout/editor-pane-state.ts` (persisted `autoOpened`, clear-only reducer),
  `components/editor-pane/` (`types.ts`, `viewer-registry.tsx`, provenance
  context, `MarkdownViewer`), `components/preview/` (`ImagePreview`,
  `PdfPreview`, `VideoPreview`, `AudioPreview`, `HtmlPreview`,
  `FilePreviewOverlay`, `ImageLightbox`, new `DenialNotice`, `denial-fetch`),
  every registered viewer that fetches, `components/canvas/CanvasDriver.tsx`,
  `components/split/SplitWorkspaceContext.tsx`
- Compatibility: `promptOutcome` is additive; existing 403 keys keep their names.
  The body's `subject` becomes the store's canonical form; the grant endpoint
  normalises both sides, so `denialId` bindings keep working (tested).
- Rollback: revert the change. Persisted tabs may keep an `autoOpened` key; the
  previous code ignores unknown tab fields. Tabs saved before this change seed
  `autoOpened` from `restrictCsp`. Grants created under the widened
  forbidden list stay in the store and are revocable in Settings → Access.

## Discipline Skills

- `security-hardening`: the opt-out mechanism, the auto-open provenance boundary
  (every viewer, pdf.js, overlay, lightbox), `promptOutcome` disclosure, and the
  forbidden-list widening.
- `doubt-driven-review`: ran on this proposal and its design before tasks were
  folded; findings reconciled into D1–D9.
- `scenario-design`: the outcome × transport × provenance matrix, almost all
  error paths.
- `review-code`: before commit, per project doctrine.
