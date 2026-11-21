## Why

Links in the chat window are plain blue text: a file, a web page, a GitHub PR and a JIRA ticket look the same. A dead file link looks alive until you click it. A relative path printed by a tool that ran in a subdirectory resolves against the wrong folder. Web links always leave the dashboard, and an `.html` file opens in one fixed way.

Most building blocks already exist but chat links do not use them:
- `fileIcon()`;
- `openUrlTarget`;
- the served HTML preview with its Scripts/Static toggle;
- the Phase-2 fuzzy-fallback requirement, which is specified but not implemented.

## What Changes

**Depends on `fix-file-link-editor-routing`** (`dependencies.yaml`). That change makes file links open in the Edit pane (absolute, `~/` and out-of-cwd too) and returns `outside: true` without a stat for paths outside scope. This change builds on that routing. Where both touch the same `tool-output-linkification` requirement, this change's MODIFIED text starts from the text that change introduces.

- **Type icon prefix on file links.** Every file link in the dashboard chat transcript shows the extension icon from `fileIcon()` (`packages/client/src/lib/preview/file-icon.ts:118`), the same glyph as the file tree and tabs. It sits in a fixed-size slot from first paint. It is decorative and never copied.
- **Provider recognition for full URLs.** A new pure, non-throwing classifier returns provider, icon and label for GitHub, GitLab, JIRA, YouTube, npm, Stack Overflow, Google Docs and Drive, and localhost, with a globe fallback.
  - In the dashboard chat transcript only, autolinks get a short label (`org/repo#123`, `PROJ-9 (acme)`). Author-written link text is kept. Other surfaces are unchanged.
  - The full URL stays in `href` and the tooltip, and copying gives the original URL.
  - Bare references (`#123`, `PROJ-123`) are out of scope.
- **File links are pre-confirmed in batches.** This explicitly supersedes archived `server-side-file-mention-resolution`: D1, D6's opt-in clause and its non-repo skip (which now applies only to fuzzy matching), and its non-goals "picker" and "eager indexing".
  - Applies only to links in the dashboard's chat transcript.
  - A link is pre-confirmed only once its content has settled (no streaming, no running tool) and it is in view.
  - Requests are batched per flush window, never one per link.
  - The link element and text never change, only a state (`found | recovered | ambiguous | missing | gated`).
  - A click still resolves anew.
  - Out-of-scope mentions report `gated` without a stat.
  - The batch path applies the same worktree re-root as a click.
- **Real-file recovery** (opt-in per request, so older clients see no change).
  - When a tool call ran in another directory (its `cwd` argument or a leading literal `cd <dir> &&`), relative mentions are tried there as well as in the session cwd. When both exist the link is ambiguous.
  - Otherwise fuzzy fallback runs over tracked files (`git ls-files`). It resolves only a unique tracked match that is on disk, with a stat budget.
  - Recovered links name the real path in their tooltip; several matches open a picker.
- **HTML links: mode menu.** A plain click keeps the normal file-link routing. The existing HTML viewer already frames a served static target (`packages/client/src/components/preview/HtmlPreview.tsx:2-6`). With a split workspace, a small menu beside the link offers Rendered, Static (no scripts) and Source (read-only text tab). The dashboard still does not spawn dev servers.
- **Web links open in the Edit pane.** This explicitly supersedes the archived `improve-canvas-html-and-url-ux` non-goals "rendering non-loopback URLs inline", "reworking `UrlViewer`'s fallback card" and "LAN URLs are handled by guidance only".
  - A plain click on a non-loopback http(s) link in the transcript of the session the pane belongs to opens a web tab. Cmd/Ctrl/Shift/middle-click, and every other surface, open the browser.
  - A web page view probes and frames only after an operator action. Agent canvas and URL-route opens show a card with "Check and embed".
  - The probe is a CSRF-gated `POST` carrying only the target origin. It sends `HEAD /` to the origin root (never the user's path or query), only to public `https` on port 443, with full re-checks on every redirect hop. It returns a verdict only and needs the `control` tier. A new public-only address predicate is used, because webhook vetting deliberately allows LAN.
  - Allowed pages are framed in an opaque-origin sandbox (scripts and forms only: no same-origin, no popups, no top navigation). Sites that need storage or cookies are better opened in the browser.
  - Refused and ineligible pages show an "Open in browser" card. Undetermined pages also offer "Try to embed".
- **BREAKING (security policy): dashboard CSP `frame-src` widens from `'self'` to `'self' https:`** (`packages/server/src/auth/csp.ts:68`). This is required for any external frame in `enforce` mode. `http:`, `data:`, `blob:` and `*` frames stay blocked. The markdown sanitizer keeps stripping injected iframes.
- **Relative markdown anchors become file links.** `[guide](docs/x.md)` currently renders a same-origin `<a>` (`MarkdownAnchor`, `packages/client/src/components/preview/MarkdownContent.tsx:580`) that navigates the dashboard. Relative hrefs now resolve against the previewed document's directory, or the chat session cwd. Root-relative `/…` and fragments are unchanged.

## Capabilities

### New Capabilities
- `link-provider-recognition`: pure URL → provider, icon and label classification, short-label rules, accessible naming, and copy semantics.

### Modified Capabilities
- `tool-output-linkification`:
  - MODIFIED: "Loopback URLs in tool output open in the internal split viewer", "Fuzzy fallback resolves only on a unique, on-disk match", "File links resolve lazily on open", "Server-side file-mention resolution" (both rebased on `fix-file-link-editor-routing`), and "Selection and copy preservation".
  - ADDED: file-type icon; provider icon and label; web URLs open in the pane; HTML mode menu; batched pre-confirmation; no swap or reflow; gated without stat; bounded batch endpoint; client state cache; tool-dir first; recovered disclosure; ambiguous picker; pre-confirmed state matches the click.
- `chat-markdown-rendering`:
  - MODIFIED: "Loopback URLs in chat markdown open in the internal split viewer" (credentialed-host scenario).
  - REMOVED: "Non-loopback and non-URL anchors are unchanged".
  - ADDED: external anchors open in the pane; modifier escape for web anchors; relative anchors as file links; provider icon; fragments unchanged.
- `file-and-url-preview`:
  - MODIFIED: "Renderer dispatch is purely shape-based" (`webpage` kind, not a canvas type) and "Overlay and editor-pane surfaces share renderers" (`WebPagePreview`; both shells offer "Open in browser").
  - ADDED: frame only after an allowed verdict; isolation; open-in-browser card; header escape; probe target rules; side-effect-free probe; verdict rules.
- `baseline-content-security-policy`:
  - MODIFIED: "Baseline policy directives" (`frame-src 'self' https:`).

## Discipline Skills

- `security-hardening`:
  - the batch route and the tool-directory hint (untrusted, re-gated, no existence oracle);
  - the frame-policy probe (SSRF, DNS rebinding, redirects, side effects, port scanning);
  - the CSP `frame-src` widening;
  - the sandbox of framed third-party pages.
- `performance-optimization`: batch cost (settled and visible only, flush window, 200 cap, client cache), `git ls-files` cost (single-flight, buffer and size caps, stat budget). Measure on a long tool-heavy session before and after.
- `doubt-driven-review`: pre-confirmation supersedes a deliberate archived decision, and the CSP change is a security-policy change.
- `observability-instrumentation`: per-request log lines for the batch and probe routes (counts, verdicts, timings; host only, never full URLs).

## Impact

- Client:
  - `components/tool-renderers/{FileLink,UrlLink,LinkifiedText}.tsx`, `components/chat/ToolCallStep.tsx` (tool directory), `components/chat/ChatView.tsx` (provider opt-in prop), `lib/chat/chat-selection-copy.ts` (`data-copy-text`);
  - `components/preview/MarkdownContent.tsx` (`MarkdownAnchor`);
  - new `lib/chat/classify-link.ts`;
  - new link-resolution provider and store, mounted by the dashboard's `ChatView` only;
  - `lib/use-loopback-link-open.ts` → generalised web-link hook;
  - `components/split/SplitWorkspaceContext.tsx` (source tab, HTML initial mode);
  - `lib/preview/preview-dispatch.ts` and a new web-page renderer;
  - `components/editor-pane/DocumentBar.tsx` and the overlay route header ("Open in browser").
- Server:
  - `lib/resolve-file-mention.ts` (tool directory, fuzzy index, tagged result);
  - `routes/file-routes.ts` (batch route; additive fields on `/api/file/resolve-mention`);
  - new frame-policy probe route, plus a shared `isPublicUnicastAddress` built on `preview-egress`'s private-address classifiers;
  - `auth/csp.ts` (`frame-src`).
- Shared: tool-directory parser.
- Docs: `docs/security/http-route-inventory.md` rows (DocScribe).
- Compatibility:
  - all routes and fields are additive;
  - an older server without the batch route leaves links unknown with today's click behaviour;
  - an older server without the probe yields the card only;
  - an older client never sends `recover`, so it gets identical results.
- No data migration.
