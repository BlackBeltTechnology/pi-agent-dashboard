# Design: rich-chat-links

## Context

See proposal.md for why this change exists and the `specs/` deltas for the contracts. This section covers only the current state the change builds on.

**File links.** `FileLink` (`packages/client/src/components/tool-renderers/FileLink.tsx`) renders a `<button>` immediately and resolves the path on click via `POST /api/file/resolve-mention` (`packages/server/src/routes/file-routes.ts:1223`, route tier `observe` in `packages/shared/src/route-tiers.ts:339`). The prerequisite change `fix-file-link-editor-routing` reshapes this:
- routing becomes pane-first;
- when containment fails, the server returns `{resolved, outside:true}` without a stat, and grants count as contained;
- worktree re-rooting stays on the client (its D4).

**Web links.** `UrlLink` and `MarkdownAnchor` (`packages/client/src/components/preview/MarkdownContent.tsx:580`) share `useLoopbackLinkOpen` (`packages/client/src/lib/use-loopback-link-open.ts:22`). That hook only checks that a split context exists. `SplitWorkspaceProvider` wraps the whole shell, so dialogs, file previews and plugin chat views all have one. `MarkdownAnchor` is the `a` renderer for every `MarkdownContent`. File previews provide the document directory through `ImageBaseContext` (`MarkdownContent.tsx:83`).

**Split workspace openers.** `SplitWorkspaceContext` (`packages/client/src/components/split/SplitWorkspaceContext.tsx`) provides:
- `openLiveTarget` (`:322`);
- `openStaticTarget` (`:341`);
- `openUrlTarget` (`:360`), which opens a `url:` tab. `dispatchPreview` (`packages/client/src/lib/preview/preview-dispatch.ts:30`) gives such a tab a renderer only for YouTube hosts;
- `openDiffTab` (`:391`), which uses the virtual-path pattern.

URL tabs are also opened by agent canvas declarations, the `?url=` route and `/pi-view?url=`.

**HTML files.** `.html` opens via `openInSplit` in `HtmlPreview` (`packages/client/src/components/preview/HtmlPreview.tsx:2-6`): a served static target, opaque sandbox, with a Scripts/Static toggle. `.html` is not writable on the server: `WRITABLE_MD_EXTENSIONS` (`packages/server/src/lib/writable-md-target.ts:33`).

**CSP.** The dashboard CSP sets `frame-src 'self'` (`packages/server/src/auth/csp.ts:68`).

**Copy.** ChatView already intercepts every copy that touches the transcript, through a document-level listener (`packages/client/src/components/chat/ChatView.tsx:1320`). The listener calls `buildSelectionClipboardText` (`packages/client/src/lib/chat/chat-selection-copy.ts:94`).

**Egress vetting.** `resolveAndVet` (`packages/server/src/push/push-transports/webhook-url.ts:117`) resolves every DNS record for pinned outbound calls. Its block list (`:37-40`) is only link-local and metadata: webhooks deliberately allow LAN targets, so it is NOT reusable as a public-only check. The private-address classifiers `isPrivateIpv4`/`isPrivateIpv6` live in `packages/shared/src/preview-egress.ts:61-85` (module-private). The CSRF mutation-origin gate skips safe methods (`packages/server/src/auth/mutation-origin-gate.ts:46`). `RendererKind`/`NON_FALLBACK_KINDS` (`packages/shared/src/renderer-by-ext.ts:34`) size the canvas-type settings.

**Embedding.** `ChatView` also backs the plugin `ui:chat-view` primitive (`packages/client/src/lib/plugins/chat-view-primitive.tsx`).

**Archived decisions this change explicitly supersedes:**
- `server-side-file-mention-resolution` D1 (no render-time batching);
- D6's "opt-in" clause and its "skip entirely for non-repo cwds" clause, which now applies to fuzzy matching only;
- `server-side-file-mention-resolution` non-goals "multi-file disambiguation UI (a picker)" and "eager filesystem indexing" (a bounded per-repo `git ls-files` index is added);
- `improve-canvas-html-and-url-ux` non-goals "rendering non-loopback URLs inline" and "reworking `UrlViewer`'s fallback card", and its "LAN URLs are handled by guidance only" (a LAN URL now opens a card tab with "Open in browser").

The user asked for links to be checked up front and for web links to open in the pane. The decisions below answer each of the original objections.

## Goals / Non-Goals

**Goals:**
- A link shows its state with no request per link, and its element, text and box never change after first paint.
- The batch check and the click follow one resolution order, so the pre-confirmed state describes what the click opens.
- No new outbound capability can be triggered without an operator action. That capability stays public-only, origin-root-only and verdict-only.

**Non-Goals:**
- Loosening tokenizer detection.
- Bare references.
- Writable `.html`.
- Unfurling.
- Proxying external pages.
- An off switch for pre-confirmation. It could be added later without spec impact.

## Decisions

### D1 — Link state is presentation on the existing element; dashboard transcript only

`FileLink` keeps the same `<button>` and the same text from first paint. A fixed 1em icon slot holds the type glyph.

A `LinkResolutionProvider` owns a keyed store mapping `(sessionId, toolCwd, mention, reRooted?)` to a state. Each link subscribes to its key with `useSyncExternalStore` and maps the state to:
- `data-link-state`;
- colour and decoration;
- `title`;
- the slot glyph (lock = gated, question mark = ambiguous).

Nothing that changes box metrics is touched.

`ChatView` mounts the provider only when its new `transcriptLinks` prop is set, and wraps only the message list. `FilePreviewHost` (`ChatView.tsx:2931`) and every overlay stay outside it. Only the dashboard's `App` sets the prop; the `ui:chat-view` primitive and dialogs do not. Without the provider, links behave as they do today, so icons, labels, pre-confirmation and pane routing are all transcript-only. The one intentional off-transcript change is the relative-anchor fix in markdown file previews (D7), which repairs a link that today navigates the dashboard away.

The provider also exposes `paneSessionId`. Pane routing (D7) and the HTML menu (D10) apply only when the link's `ToolContext.sessionId` equals the split workspace's `sessionId`. That rules out other surfaces and other sessions.

*Alternative considered:* per-link fetch. Rejected: it brings back the archived N-requests problem.

### D2 — When to batch

- **Settled.** A link registers only when its tool call `status` is not `running` and its text belongs to a committed message, not `state.streamingText`.
- **Visible.** A link registers on its first intersection with the scroller, through one shared `IntersectionObserver`.
- **Flush.** The client flushes 250 ms after the last registration, and never later than 1 s after the first pending one. Consecutive flushes are at least 1 s apart (enforces the P3 budget of at most 1 batch per second while scrolling). Requests are grouped by session, with at most 200 items each. Overflow and cap-`unknown` items go into the next window.
- **Client-side guards.** The client never sends a mention or toolCwd over 1024 characters; those links stay `unknown`. A 429 causes a retry with exponential back-off (1 s → 30 s) while the links stay visible.
- **Cache.** Entries live 60 s. The client drops every cached entry of a session in these cases, and in-view links then re-register immediately:
  - a tool call of that session completes: a `tool_execution_end` event, or the stale-tool reconcile in `useStaleToolReconcile` when that event was dropped under load;
  - the access grants change.
  - This covers files created, deleted or renamed by any tool, without relying on `file_changed`, which only fires for files open in the editor pane.

### D3 — One resolution order, recovery opt-in

The server function is `resolveMentionTagged(mention, {cwd, canonCwd, toolCwd?, recover})`. It runs these steps in order:

```
0. if reRooted: reRooted candidate (same containment as the mention; found -> use it, else continue with the original)
1. if recover && toolCwd: toolCwd-relative candidate     (dir + joined path contained, else skip step)
2. exact: ~/ | absolute | cwd-relative                    (outside -> gated, no stat)
   - steps 1 and 2 hit the same realpath -> found
   - steps 1 and 2 hit different files   -> ambiguous [tool-dir, cwd]
   - exactly one exists                  -> found (via tool-dir when from step 1)
3. if recover && none exists: fuzzy (D5)                  -> recovered | ambiguous | missing
```

- `gated` comes only from step 2's containment failure on the user's own mention. An out-of-scope tool directory or joined candidate in step 1 is skipped silently.
- The single endpoint keeps the prerequisite's `resolved`/`kind`/`outside` semantics. Recovery runs only when the request sends `recover: true` (`kind: "relative"` for a tool-dir hit, `"fuzzy"` for a fuzzy hit, as in the archived D4 enum). Every response gains `state`; recovered or ambiguous responses also gain `via` and `candidates`.
- The batch endpoint is `POST /api/file/resolve-mentions`, taking `{cwd, items:[{mention, toolCwd?, reRooted?}]}`. It always runs with `recover: true`, after one `admitFileCwd`. It is tier `observe` like the single route.
  - Body cap 512 KB. A mention, `toolCwd` or `reRooted` over 1024 characters → 400, with no filesystem access.
  - 60 requests/min per principal. Without a principal the limit is keyed by remote address, so localhost clients share it (accepted).
  - Per-item cost: at most 4 exact stats (reRooted, tool-dir, cwd/abs/tilde) plus D5's 25, each preceded by one realpath.
- Worktree parity: the client sends `resolveLinkOrigin`'s re-rooted candidate as `reRooted`. The server resolves it first and uses it if found, otherwise it uses the original. This mirrors the prerequisite's D4 click path.
- A click always resolves anew (`recover: true`, same `toolCwd`). The batch state is only a hint.

### D4 — Tool directory: literal, client-derived, server-re-gated

`toolWorkdir(toolName, args)` is a pure shared function.

1. `base` = the string `cwd` or `workdir` argument, if present.
2. For bash `command`: match `^\s*cd\s+(<dir>)\s*&&`, where `<dir>` is a single unquoted or quoted literal.
   - Give up if `<dir>` contains `$`, a backtick, a glob or a backslash, or starts with `~` or `-`.
   - Otherwise the result is `<dir>` resolved against `base` (or relative, if there is no base).
3. Otherwise the result is `base`.

`ToolCallStep` (`packages/client/src/components/chat/ToolCallStep.tsx`) passes the result down as `ToolContext.toolCwd`. Multiple `cd`s, subshells and `git -C` are not parsed. Fuzzy matching still covers those cases.

The server then:
1. resolves `toolCwd` against `cwd`;
2. normalises it;
3. checks containment on the directory using its realpath;
4. joins the mention;
5. checks containment on the joined realpath;
6. runs `stat`.

### D5 — Fuzzy index with explicit budgets

The index is built per git root (`git rev-parse --show-toplevel`):
- `git ls-files -z` (tracked only) through `execFile`, with `timeout: 3000` and `maxBuffer: 64 MiB`;
- single-flight per root;
- stored as `basename → paths[]`, capped at 200k entries (above the cap: skip and log);
- 60 s TTL.

Matching:
- A mention containing `/` matches by path suffix on a segment boundary. A bare name matches by basename.
- **Exactly one tracked match:** realpath containment check, then stat. On disk → `recovered`; otherwise `missing`.
- **More than one tracked match:** realpath containment plus stat on at most the first 25. One or more on disk → `ambiguous` with up to 10 of them; none on disk → `missing`. The server never auto-selects, even when only one is on disk.

The per-mention budget (25) is the only stat budget. A request is bounded by 200 × 25 stats.

### D6 — Gated equals the prerequisite's `outside`

`gated` comes from the prerequisite's containment decision: cwd in both spellings, git root, `~/.pi`, plus grants, evaluated before any stat. There is no second gate and no interim mode, because the prerequisite is a hard dependency. A click on a gated link goes through the normal open path, which handles the grant prompt or denial.

### D7 — Web-link routing

`useLoopbackLinkOpen` becomes `useWebLinkOpen(context)`:
- loopback → `openLiveTarget`, unchanged, keeping today's existence-only condition;
- other http(s) → `openUrlTarget(url, {opener: "operator-click"})`, only when D1's session match holds;
- everything else → no-op, so native `target="_blank"` applies.

The usual plain-primary-click guard applies throughout.

`MarkdownAnchor` handles hrefs as follows:

| `href` | Behaviour |
|---|---|
| `#…`, `/…`, `//…`, `mailto:` and other non-http schemes | unchanged |
| http(s) | provider icon; short label only for an autolink in the transcript (D1 provider present); the web hook |
| relative | percent-decoded, query dropped, `#L<n>` read as the line and other fragments ignored. Joined with the base (`ImageBase.dir` in a file preview, else the transcript `ToolContext` cwd), then expressed as a cwd-relative or absolute mention and passed to `context.fileLink`. Containment and the grant flow treat it like any typed mention. With no base it stays unchanged (today's same-origin navigation, accepted). |

`//…` (protocol-relative) stays the existing external anchor.

### D8 — Provider classification

`packages/client/src/lib/chat/classify-link.ts` exports `classifyLink(url)`:
- `new URL()` inside try/catch;
- a fixed host table, matched exactly or on a dot-boundary suffix;
- per-provider path regexes that implement the spec's label rules;
- `mdi*` icons.

Credentials in the URL (`user@host`) are ignored for host matching, because `URL.hostname` already excludes them. Anything unrecognised, and every loopback URL, keeps its URL text.

### D9 — Copy and accessibility via the existing interceptor

Icons and the HTML chevron are `aria-hidden` SVGs or icon-only buttons with `aria-label`, and use `user-select:none`. They contain no text nodes.

A short label renders with `data-copy-text="<url>"`. `buildSelectionClipboardText` (`chat-selection-copy.ts:94`) learns one rule: each `[data-copy-text]` element the range intersects is serialised as its attribute value. That keeps the existing force-mount, size-cap and multi-transcript arbitration, and adds no new listener. Labels appear only where this interceptor runs (D1).

The accessible name is the visible text. The full URL goes in `title` and `aria-description`.

### D10 — HTML modes

The chevron is shown only when D1's session match holds. It is a sibling icon-only button (not nested), with `draggable=false` and `user-select:none`. Its menu has three entries:
- **Rendered**: `openInSplit`, the same as a plain click.
- **Static (no scripts)**: `openInSplit(path, line, …, {htmlMode: "static"})`. The mode is kept in tab state and seeds `HtmlPreview`'s existing toggle, so the existing policy is untouched.
- **Source**: a new `openSourceTab(path)` that opens `source:<abs>` (the `diff:` pattern) in the `monaco` viewer with `readOnly: true`. The tab is dispatched through the kind registry (`viewer: "monaco"`) and is registered in `pseudo-tab-registry` and `tab-labels` like `diff:`. File-handler claims are keyed on real paths, so they never match `source:`. Writes remain refused on the server by `WRITABLE_MD_EXTENSIONS`. Editor tab paths are not `ViewTarget`s.

### D11 — Web page renderer: operator-gated probe, opaque frame

`dispatchPreview` maps http(s) URL targets that are not YouTube to `webpage`, unless the path has a media or document extension whose renderer accepts URL targets (video, audio, image, pdf). `.html`, `.htm`, `.md` and other file-only kinds are `webpage` for URLs. `webpage` joins the `RendererKind` union but is excluded from `NON_FALLBACK_KINDS`, so it is not a canvas type and canvas settings are unchanged.

The tab state carries `opener`. `openUrlTarget(url, {opener})` records it, and an operator click on an existing tab upgrades it to `operator-click` and bumps the tab, which runs the check. `opener` is in-memory only and is excluded from the persisted editor-pane state, so a restored tab always starts as the card. It is separate from the existing preview `Opener` (`"operator" | "agent"`) and does not change that type's meaning.

`WebPagePreview` receives the opener:

- **`operator-click`** (set only by D7): the renderer runs the client eligibility pre-check (`https:`, port 443, not a literal IP or internal-looking host). If the pre-check fails, the card is shown with no request and no "Try". Otherwise it calls `POST /api/web/frame-policy` with body `{origin: "https://<host>"}` (the target origin only; never the path or query).
- **Any other opener** (agent canvas, `?url=` route, `/pi-view`, a restored tab): the card with **"Check and embed"** and no request. Choosing it is the operator action that runs the probe.

Verdicts:
- **allowed** → `<iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer">`. The page gets an **opaque origin**: no `allow-same-origin`, no popups, no top navigation.
  - This holds even if the page later navigates itself, in-frame and untracked, onto the dashboard origin. The document stays opaque and cannot read the parent or call dashboard APIs with credentials, which matches the live-server isolation rule.
  - `allow-popups` is omitted, because the Electron shell turns every `window.open` into `shell.openExternal` (`packages/electron/src/main.ts:625-628`).
  - Trade-off: sites that need storage or cookies degrade inside the frame. "Open in browser" covers them.
- **refused** / **ineligible** → card.
- **undetermined** → card with "Try to embed", which frames under the same opaque sandbox.
- **any probe error** (404, 400, 401, 403, 429, 5xx, network) → card only.

The renderer has no chrome. The pane's `DocumentBar` (`viewer === "url"` branch) and the overlay route header both add "Open in browser" and the label "embedded from <host>". In-frame navigation is not tracked, consistent with the archived improve-canvas non-goal.

### D12 — The probe's boundary

1. **Request checks.**
   - The method is `POST`, so `mutation-origin-gate` applies.
   - The request MUST carry a browser `Origin`, and it must be one of the dashboard's own origins: loopback on the server's own port, the configured public base URLs, or the active tunnel URL (the `ownOrigins` set `isUngrantableEgressOrigin` already consumes). Anything else gets 400 with no outbound request. That `Origin` is the dashboard origin used for verdict matching.
   - Tier is `control`. Scripted `control`-tier clients that forge a browser `Origin` are operators by definition (accepted).
   - The body carries only the target origin, normalized with the WHATWG `URL` parser, so alternate IP notations (`0x7f.0.0.1`, `2130706433`) canonicalize before any check.
2. **Target.** `https://<host>/` only. The user's path, query and fragment are never sent.
3. **Per hop (first and every redirect).** Any failure in (a)–(c) gives `ineligible`.
   - (a) Scheme `https:`, port 443, no userinfo.
   - (b) **Dashboard-trusted origins are refused.** "Dashboard-trusted" is everything `isUngrantableEgressOrigin(origin, ownOrigins)` refuses (`packages/shared/src/preview-egress.ts:105`): non-https, `localhost`/`*.localhost`, IP literals in private ranges, single-label hosts, `.local`/`.internal`/`.lan`/`.home.arpa`, IPv4-embedding labels and own origins. It also includes every origin `classifyCorsOrigin` allows (loopback, tunnel, configured CORS origins, `pi-dashboard.dev`, enabled zrok wildcards). Comparison is on canonical origins: lower-case, trailing dot stripped, default port dropped, punycode.
   - (c) `dns.lookup(all)`. A lookup failure gives `ineligible`. Every address must satisfy a new shared `isPublicUnicastAddress(ip)`, which:
     - is built on `preview-egress`'s `isPrivateIpv4/6` (exported for this);
     - additionally refuses `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `100::/64`, `2001::/32` (Teredo), `2001:10::/28`, `2001:db8::/32`, `2002::/16`, `64:ff9b::/96`, `64:ff9b:1::/48`, `::ffff:0:0/96` (translated), `fec0::/10` and `ff00::/8`;
     - strips zone IDs;
     - **fails closed** on any address it cannot parse.

     Webhook vetting (`resolveAndVet`) is untouched.
   - (d) Connect pinned to a vetted address through a dedicated `https.Agent` with a custom `lookup`. It never reads proxy environment variables (`HTTPS_PROXY`, `NODE_USE_ENV_PROXY`), so a proxy cannot re-resolve.
   - (e) Send `HEAD` to the hop's URL (first hop `/`; later hops use the path from the server-given `Location`) with no cookies, no `Authorization` and a fixed User-Agent. Read status and headers only (64 KB cap), then destroy the socket.
   - (f) Only 301/302/303/307/308 with a `Location` are redirects. `Location` is resolved against the hop URL and re-enters step (a). More than 3 hops gives `ineligible`. A 3xx without `Location`, or any other 3xx such as 304, is a final response.
4. **Deadline and errors.** A 5 s overall deadline. A timeout or reset **after** a vetted connect gives `undetermined`. A 405 or 501 gives `undetermined` and never a `GET`.
5. **Verdict rule.**
   - Only a final 2xx response can be `allowed` or `refused`. Any other final status gives `undetermined`.
   - If any CSP policy carries `frame-ancestors`, those directives alone decide. Every one must match the dashboard origin under CSP source matching (`'none'`, `'self'` relative to the target, scheme sources, host wildcards, ports).
   - Otherwise `X-Frame-Options` gives refused for `DENY`, `SAMEORIGIN`, `ALLOW-FROM` (conservative; browsers ignore it) or conflicting multiple values. A single unparseable value is ignored.
   - Anything else is `allowed`.
6. **Cache and limits.**
   - An LRU of 500 entries, 10 min, keyed by `(principal, target origin, dashboard origin)`. The dashboard origin comes from the bounded own-origin set, so a caller cannot mint key variants.
   - 30/min per principal. Without a principal the remote address is used, so localhost clients share a bucket (accepted).
   - A global cap of 8 concurrent probes.

### D13 — CSP widening

`frame-src 'self'` becomes `frame-src 'self' https:` in both the baseline and strict policies (`csp.ts:68`). Remaining guards:
- External `https:` frames are created only by `WebPagePreview` (operator-gated, opaque sandbox) and `YouTubePreview`.
  - `YouTubePreview` (`packages/client/src/components/preview/YouTubePreview.tsx:51-58`) frames a fixed YouTube embed host without a sandbox. `enforce` mode blocks it today and the widening unblocks it. This is accepted as a fixed, well-known host and noted for `Audit`.
- `HtmlPreview`, `EmlPreview`, `CraftFrame` and live-server frames are same-origin or opaque and are unaffected. `<video>`, `<img>` and pdf fetches are governed by `media-src`, `img-src` and `connect-src`, which stay unchanged.
- Untrusted HTML cannot create frames:
  - the markdown schema strips `<iframe>`;
  - the server-sanitized HTML sinks (`DocxPreview`, `AsciiDocPreview`, `DiagramPreview`, `MermaidBlock`) use DOMPurify, whose default allow-list excludes `iframe`. A test pins that for each sink.
- `http:`, `data:`, `blob:` and `*` frame sources stay blocked, and `frame-ancestors 'self'` is unchanged.
- The PWA shell origin's CSP is not emitted by `csp.ts`. External frames there follow that shell's own policy, which is out of scope.

`Audit` signs off.

### D14 — Observability

- **Batch:** one log line per request with cwd hash, item count, per-state counts, fuzzy-index hit/miss and build ms, stat count, and total ms.
- **Probe:** verdict, hop count and ms. The host is logged for `allowed`/`refused`/`undetermined`. `ineligible` logs a salted hash of the host, so internal names stay out of logs while repeated scans stay visible. Never path or query.
- **Client:** a debug counter of flushes and items per flush.

## Threat model

Produced by running the `security-hardening` discipline (trust boundaries → assets → STRIDE → abuse cases) over four surfaces: the batch route `POST /api/file/resolve-mentions`, the tool-directory hint, the frame-policy probe `POST /api/web/frame-policy`, and the CSP `frame-src` widening. The probe and CSP code are specified here (D11–D13) and built in group 3, so their rows are modelled from the design.

**Trust boundaries.** (1) Browser → server HTTP: `cwd`, mentions, `toolCwd`, `reRooted` and the probe `origin` are untrusted request input. (2) Agent/tool output → client → server: mentions and the `toolCwd` hint come from model-controlled text, so they are attacker-influenced (prompt injection). (3) Server → the public internet: the probe is the first dashboard code that makes an outbound request on a user's click, to an attacker-chosen host. (4) Third-party page → dashboard: an embedded page runs in the operator's browser.

**Assets.** Files outside the admitted scope and their existence; dashboard state and credentials; the internal network behind the server (SSRF); dashboard-origin authority (cookies, API credentials); server availability.

| # | Surface | Threat (STRIDE) | Mitigation | Test-plan ids |
|---|---|---|---|---|
| T1 | batch | **I** — existence oracle: injected text asks the server to check whether `~/.ssh/…` or `/etc/…` exists | Containment runs before any stat (D6). Out-of-scope → `gated`, and the batch wire carries only `{state:"gated"}`, byte-identical whether or not the file exists | E19, E14 |
| T2 | batch | **E** — probing an arbitrary tree through an unadmitted `cwd` | Same network guard, tier `observe` and `admitFileCwd` as the single route, before any resolution; 403 with zero stats | E21 |
| T3 | batch, tool dir | **E** — escape through `..`, an in-repo symlink to `/etc`, a symlink tool dir, or a re-rooted candidate | Tool dir and joined path each pass realpath containment before any stat; an out-of-scope dir or joined path is skipped silently and never produces `gated`; `reRooted` passes the same gate as the mention and falls through when it fails | E14, E22, E13 |
| T4 | fuzzy | **E/I** — a tracked symlink to `/etc/passwd` (or an ignored/secret file) becomes a "recovered" link | Index is tracked-only; every candidate passes realpath containment before its stat; a symlink escape is never recovered | E17, E16 |
| T5 | fuzzy | **I** — colliding names leak many paths, or auto-select the wrong file | Several tracked matches never auto-resolve: at most 10 on-disk candidates, ≤25 stats per mention, containment on each; candidates are in-scope tracked files only | E16 |
| T6 | tool dir | **S/T** — a forged `cd` in model output steers resolution to attacker-chosen paths | `toolWorkdir` is literal-only (no `$`, backtick, glob, backslash, `~`, `-`, chained or repeated `cd`); the result is an untrusted hint that is re-gated server-side and never grants access or yields `gated` | E15, E14, E13 |
| T7 | batch | **D** — amplification: 200 items × (4 + 25) stats, giant bodies or fields, request floods | ≤200 items (rest `unknown`), 512 KB body (413), 1024-char field cap (400, validated before any fs access), 60/min per principal (429), bounded concurrency (16), per-request containment memo | E20, P1, P2 |
| T8 | fuzzy | **D** — `git ls-files` hangs, floods memory, or is respawned per mention | `execFile` timeout 3 s + own timer, 64 MiB buffer, 200k-entry cap, single-flight, 60 s TTL (skips cached too); every failure degrades to exact-only with one log line | E18, X4 |
| T9 | batch | **T** — a client without the recovery opt-in is silently changed (downgrade/compat) | Recovery and `toolCwd` need a literal `recover: true`; an old client gets the exact-only result plus `state` | X3, E12 |
| T10 | batch | **I/R** — logs leak mentions, paths or directories | One structured line per request: cwd hash, counts, timings only | E19 (+ the log-hygiene test in `resolve-mention-endpoint.test.ts`) |
| T11 | probe | **I/E** — SSRF to internal hosts (loopback, RFC 1918, link-local, metadata, `.internal`, IPv4-embedding labels, alternate IP notations) | `https:` port 443 only; WHATWG-normalised host; refusal of everything `isUngrantableEgressOrigin` and `classifyCorsOrigin` trust; `isPublicUnicastAddress` that fails closed on unparseable input | E33, E34 |
| T12 | probe | **E** — DNS rebinding / TOCTOU between check and connect, or a name with one public and one private record | `dns.lookup(all)` with every address vetted; connect pinned to a vetted address through a dedicated `https.Agent` with a custom `lookup`; lookup failure → `ineligible` | X6, E33 |
| T13 | probe | **E** — redirect into an internal target | Only 301/302/303/307/308 with `Location`; every hop re-enters the full check; ≤3 hops | X5 |
| T14 | probe | **E** — proxy environment variables re-resolve the target | The probe agent never reads `HTTPS_PROXY` / `NODE_USE_ENV_PROXY` | X11 |
| T15 | probe | **S/E** — cross-site request or scripted client triggers outbound requests | `POST`, so `mutation-origin-gate` applies; browser `Origin` must be one of the dashboard's own origins (else 400, no outbound request); tier `control`; target origin only in the body | X8 |
| T16 | probe | **D** — the probe used as a port/host scanner or amplifier | 30/min per principal, 8 concurrent probes, 500-entry/10-min LRU keyed by a bounded origin set, 5 s deadline, 64 KB header cap, `HEAD` only (never `GET`) | X7, X9 |
| T17 | probe | **I** — response or logs leak page content, credentials, or internal names | No cookies/`Authorization`, fixed User-Agent; headers only, then the socket is destroyed; the response carries a verdict only; `ineligible` logs a salted hash of the host; never path or query | X10 |
| T18 | probe | **T** — a wrong "allowed" verdict frames a page that forbids it | Verdict follows browser precedence (`frame-ancestors` first, else `X-Frame-Options`; only a final 2xx counts); the verdict is a UX gate, not a security boundary: the frame is opaque anyway | E35 |
| T19 | CSP | **E** — widening `frame-src` to `https:` lets injected markup frame an attacker page | External `https:` frames are created only by `WebPagePreview` and `YouTubePreview`; the markdown schema strips `<iframe>` and every DOMPurify sink drops it (pinned per sink); `http:`, `data:`, `blob:`, `*` frame sources stay blocked and `frame-ancestors 'self'` is unchanged | E36, E37 |
| T20 | frame | **E** — an embedded page reads the dashboard or calls its API with credentials | `sandbox="allow-scripts allow-forms"` without `allow-same-origin` (opaque origin, no popups, no top navigation), `referrerpolicy="no-referrer"`; holds even if the page navigates itself onto the dashboard origin (client tests in group 8) | E36, E37 |

**Accepted / residual.** A scripted `control`-tier client that forges a browser `Origin` is an operator by definition (T15). Localhost clients without a principal share one rate-limit bucket (T7, T16). `YouTubePreview` frames a fixed host without a sandbox and the widening unblocks it in `enforce` mode (D13); `Audit` signs off. In-frame navigation of an embedded page is not tracked. Fuzzy candidates reveal tracked-file names that are already inside the admitted scope. Not covered by any gate: the page's own content once framed, which only the opaque sandbox contains.

**Audit follow-up hardening.** T16: DNS lookups are counted outstanding until they settle (not until the 5 s deadline) and capped at 3 — below libuv's 4-thread pool — with ≤2 probes in flight per principal (429). T7: items past the 200 cap are validated but never materialised. T8: `git` runs with `-c core.fsmonitor=false -c core.untrackedCache=false` and `GIT_OPTIONAL_LOCKS=0` (untrusted repo config can name a program to run), and the root/index caches are LRU-capped at 16.

Sign-off: task 3.17 (`Audit`) reviews T11–T20 against the implemented probe and CSP diff and amends this table if the code departs from the design.

## Risks / Trade-offs

- **[Supersedes archived decisions (D1/D6, improve-canvas non-goals)]** → each objection is answered above. Selection-survival and no-layout-shift tests guard the "no swap" claim. There is no off switch (accepted).
- **[Icon prefixes shift monospace column alignment in tool output]** → accepted; the slot is a fixed 1em.
- **[Long histories]** → registration is visible-only; 200 cap, 1 s max-wait, back-off and cache. Measured under `performance-optimization`.
- **[Large monorepos]** → single-flight, 3 s timeout, 64 MiB buffer, 200k cap, 25 stats per mention.
- **[Wrong file opens]** → when both candidates exist the link is ambiguous, never a silent pick. Fuzzy resolves only a unique tracked match. The tooltip names the real path.
- **[Origin-root verdict differs from a specific page]** → a page that still refuses shows a blank frame, mitigated by the header "Open in browser". Embed-only paths on otherwise refusing sites stay carded (accepted).
- **[HEAD on `/` still contacts the origin from the server]** → tier `control`, operator action, rate limit, host-only logs: a bounded, accepted capability.
- **[CSP widening raises the impact of a future HTML-injection bug]** → sanitizer, sandbox without top navigation, unchanged `frame-ancestors`, `Audit` sign-off.
- **[Phishing inside the dashboard frame]** → the shell says "embedded from <host>". A page may navigate itself elsewhere inside the frame, and that is not tracked (accepted). The frame is opaque, with no popups and no top navigation.
- **[Opaque sandbox breaks sites that need storage or cookies]** → accepted for safety, so a self-navigation onto the dashboard origin can never gain same-origin access. "Open in browser" is always one click away.
- **[`ineligible` (fast) vs `undetermined` (slow) timing reveals reachability of public hosts]** → accepted. Private ranges are refused before any connect, and the rate limit and global cap bound probing.
- **[Server and browser see different DNS (remote or tunnelled dashboard, split horizon)]** → the verdict reflects the server's view. The frame is fetched by the user's own browser, which is not a server-side request (accepted).
- **[Partial selection of a short label copies the whole URL]** → intentional, so a copy never yields a broken fragment of a label.
- **[Short labels hide part of the destination]** → the owner and the Atlassian site stay in the label, and the full URL is in the tooltip.

## Migration Plan

- New routes: `/api/file/resolve-mentions` and `/api/web/frame-policy`. `/api/file/resolve-mention` gains opt-in recovery and additive fields. The CSP gains `https:` in `frame-src`. Nothing is persisted.
- Newer client with an older server: the batch call returns 404, so links stay `unknown`; the probe returns 404, so the card shows only.
- Older client with a newer server: it never sends `recover`, so its results are identical.
- Rollback: revert. DocScribe updates the route inventory and adds a CSP note.
- Archive after `fix-file-link-editor-routing` (`dependencies.yaml`).

## Scenario-design decisions (owner, 2026-11-21)

- **Performance budget.** A batch of 200 mentions on this repo: server p95 < 150 ms with a warm index, and < 3.5 s cold (including `git ls-files`). At most 1 batch flush per second while scrolling. Enforced by test-plan P1–P3.
- **Harness verdict seam.** The docker harness gets an env-gated, test-only verdict seam for the frame-policy route, so rendered isolation tests (test-plan F10) never contact the internet. Production builds refuse the seam.

## Open Questions

- Starting values to tune from D14 without spec impact: the timings (250 ms / 1 s flush, 60 s cache, 10 min verdict cache, 60 s index TTL) and the rate limits.
- Provider icon tint: a visual detail for the mockup loop.
