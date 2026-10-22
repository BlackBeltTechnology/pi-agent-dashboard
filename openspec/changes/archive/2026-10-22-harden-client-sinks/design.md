# Design

## Context

See proposal.md (Why) for motivation. The measured evidence comes from `docs/research/trusted-types-spike.md`. The constraints that shape this design:

- **Sink inventory.**
  - Hand counts drift between runs (the spike and two reviewers each counted different `window.open`, `location.*` and `href={var}` totals, depending on method). The authoritative inventory is therefore the output of the D4 guard, and the migration tasks run until it is empty.
  - React 19.2.8 already blocks `javascript:` in JSX `href` and iframe `src`, but not `data:` and not imperative `window.open`/`location.*`.
  - Runtime Trusted Types sinks seen in the spike:
    - 8 app-owned sites;
    - library-internal ones: mermaid d3 labels, mermaid `<style>`, and the pdf.js and Vite worker wrappers.
  - Statically present but not exercised by the spike: `DiagramPreview.tsx:147` (server-rendered diagram SVG) and `DocxPreview.tsx:109`.
- **Existing URL gates, all disjoint:**
  - `UrlLink` (http/https regex)
  - `safeUrlTransform` (`markdown-sanitize.ts`)
  - `isExternalHref`
  - Electron `link-handling.ts` (`EXTERNAL_SCHEME_ALLOWLIST` = http, https, mailto)
  - CraftFrame's `navigateUnsafe`
- **CSP.** `packages/server/src/auth/csp.ts` runs in `report` mode by default. Its `script-src` keeps `'unsafe-inline' 'unsafe-eval'`. The hook only adds an *absent* header, so a `serveApp` mount's own policy survives. `/live/` is skipped.
- **Provenance.** Route-backed overlays (`/pi-view?url=`, `/folder/:cwd/view?path=`) render `PreviewOverlayView`, which has no `PreviewProvenance` provider, so they already fail closed to `agent` provenance (`lib/access-grants/preview-provenance.tsx`).
- **Return-to.** `returnTo` and `returnUrl` are already protected:
  - on the server, the OAuth `state` is base64url JSON whose `returnUrl` is passed through `sanitizeReturnUrl` (same-origin path only) on both encode and decode (`auth/auth-plugin.ts:96-117`), and the state's CSRF nonce is bound to an HMAC cookie;
  - on the client, the same-origin guard `safeReturnTo` (`lib/identity/gate.ts`; `LoginPage.tsx:42`).
- **Default policy in report-only mode.** In the spike's Mode B, a `default` policy registered under a *report-only* `require-trusted-types-for` was invoked, and its returned value satisfied the sink: Mode A violation counts equal Mode B invocation counts, and Mode B reported no violations. A sanitizing default would therefore alter library output even in `report` mode. It also means that while a `default` policy is registered, report mode emits no violation *events* for HTML and script-URL sinks; the default-hit count is the signal.
- **`index.html` injection.** The server already injects into `index.html` (`packages/server/src/lib/index-html.ts:22`, `injectImportMap`).
- **Imports.** `packages/shared` is importable from client, client-utils, dashboard-plugin-runtime and the Electron main process (`packages/electron/package.json:24`, `main.ts:78`).
- **Cross-site reach.**
  - CORS is allowlisted: `isCorsOriginAllowed` (`packages/server/src/auth/cors-origin.ts:186`, wired at `server.ts:2225`) gives unknown origins no ACAO.
  - A mutation-origin gate (`createMutationOriginGate`, `server.ts:~2243`) refuses cross-site non-GET requests, even blind `no-cors` ones.
  - A hostile page in the operator's browser can therefore neither call a minting endpoint nor read its response.
- **Unchecked logout sink.** `login-flow.ts:151-155` builds `new URL(disc.end_session_endpoint)` and calls `location.assign`, with the same unchecked-scheme problem as the authorize path.
- **Superseded draft.** The draft `add-trusted-types-report-only` is replaced by this change.

## Goals / Non-Goals

**Goals:**
- One URL classifier for navigation targets, so an absolute URL gets the same verdict in the browser, in a plugin and in Electron.
- Every app-owned Trusted Types sink gets a context-specific named policy; the `default` policy exists only for library internals.
- Mermaid, AsciiDoc and EML render identically under Trusted Types enforcement, proven by an automated visual check.
- Raw sinks are blocked per PR by the CI guard. The runtime violation surface becomes a tracked number in the e2e lane and in production telemetry.
- Phases revert in reverse order (C, then B, then A, then 0). Each revert is a commit revert, and the Trusted Types knob is the runtime off-switch for B.
- `report` mode changes no rendered output.

**Non-Goals:**
- Flipping the Trusted Types default from `report` to `enforce`. This change makes `enforce` available and verified. The default flip is a follow-up after one release in `report` with zero app-owned violations in telemetry.
- Adding the CSP `trusted-types <names>` allowlist directive. Monaco creates 9 policies of its own, and plugins may add more. Pinning names is a later tightening.
- Removing `'unsafe-inline'`/`'unsafe-eval'` from `script-src`.
- Enforcing Trusted Types on plugin `ctx.serveApp` mounts or `/api/file/raw` responses that set their own enforcing CSP.
  - The directive only ever rides in headers the baseline hook itself adds, and that hook never alters a route-level policy (`auth/csp.ts:63-68`; mounts set an enforcing policy only, `auth/serve-app-host.ts`).
  - In `report` mode, such responses therefore get the directive inside the baseline report-only header, which is how the spike measured `/apps/team/`.
  - In `enforce` mode they get no enforced directive.
- CodeQL alert dismissals. They stay with `triage-codeql-alert-debt`, which re-scans after this lands.
- Spike side findings: the `/api/restart` caller log, AsciiDoc re-render churn, and the `hide` endpoint doc drift.

## Decisions

### D1. Four phases, ordered, each with its own gate
Phase 0 (OIDC) → A (URL policy) → B (Trusted Types) → C (navigation intents). Phase 0 is independent and tiny, so it lands first. A precedes B because B's CI guard reuses A's sink scanner. C is last and the most cuttable: it only upgrades provenance and never weakens anything.
- *Alternative:* four separate changes. Rejected by the user (umbrella chosen), and the four would share the inventory, the guard and the e2e harness anyway.

### D2. `classifyUrl` lives in `packages/shared/src/url-policy.ts`
- It is pure: uses only `URL` and no DOM, and never throws.
- Classes: `internal | loopback | external | mailto | blocked`.
- `loopback` covers `127.0.0.0/8`, `::1`, `localhost`, `localhost.` and `*.localhost` over `http(s)`. It is decided on the parser-normalized hostname, so `0x7f.0.0.1` and `2130706433` normalize to `127.0.0.1` first.
- `external` covers `http:` or `https:` to any other host, including LAN `http://192.168.x.y` dashboards (`electron-shell` routes those to the system browser). Callers that need https-only, such as Phase 0 OIDC, check the protocol on top.
- A scheme-relative input (`//host/x`) is **never** `internal`, even when the host matches the origin.
- **Precedence.** A same-origin URL is `internal` even when the origin itself is loopback (`http://localhost:8000/settings` → `internal`).
- **Scope.** `classifyUrl` decides **navigation targets**: `<a href>` destinations, `window.open`, `location.*` and `openExternal`. It does not decide media sources (`img src` with `data:image/`/`blob:`/`pi-asset:`) or the react-markdown protocol set (`irc:`, `ircs:`, `xmpp:`). Those stay with `safeUrlTransform` and `is-external-href.ts`, whose behaviour is already specified in `client-untrusted-content-sanitization` and which this change leaves unchanged.
- **Raw pre-scan.** The WHATWG parser silently strips TAB, CR and LF, so `https://exa\tmple.com` parses as `example.com`, and `java\x01script:` against an https base becomes a same-origin path. The classifier therefore inspects the **raw** string before parsing:
  - leading and trailing C0 controls and whitespace are trimmed;
  - any remaining C0 control, or a `\`, anywhere in the input → `blocked`.
- **Origin.** `classifyUrl(raw, origin: string | null)`.
  - Relative input resolves against `origin`. `internal` requires the same origin and a path starting with exactly one `/`.
  - With `origin === null` (callers that have no page, such as the Electron main process for `openExternal`), there is no `internal` class and relative or scheme-relative input → `blocked`.
  - Electron passes its server origin wherever it decides same-origin navigation.
- *Alternative:* a third-party sanitizer such as `@braintree/sanitize-url`. Rejected: it adds a dependency, has no loopback class, and returns a rewritten URL rather than a verdict.
- *Alternative:* keep per-surface gates. Rejected: that is the status quo, and those gates have already drifted apart.

### D3. Chokepoints, not wrappers around every call
- `lib/nav/safe-navigation.ts` exports:
  - `<SafeLink href>`: renders `<a>` with `rel="noopener noreferrer"` for external targets, or an inert `<span>` for blocked ones.
  - `useSafeNavigation()` is a hook returning `{ openUrl, navigateTo }`, so it can compose the existing hooks:
    - `openUrl(url, { newContext })` returns `boolean`. It uses `window.open` with `noopener,noreferrer`. Loopback targets route through `useLoopbackLinkOpen` (`lib/use-loopback-link-open.ts:22`). On `false`, the shared non-blocking "link blocked" notice shows.
    - `navigateTo(url)`: internal targets go through `useTrackedNavigate` (`lib/nav/useTrackedNavigate.ts:12`), so the nav stack stays correct; external targets use `location.assign` only after classification.
  - `openExternalUrl(url)` is a non-hook function for non-React callers (plugin glue, event handlers outside components). It classifies, and opens a new context only for `external`/`loopback` (no split viewer). Returns `boolean`.
- `dashboard-plugin-runtime` re-exports `SafeLink`, `useSafeNavigation` and `openExternalUrl`, which is an additive SDK change.
- `UrlLink` (http/https only) and Electron `isAllowedExternalUrl` keep their exports but delegate to `classifyUrl`. Their existing tests pin the parity. `safeUrlTransform` and `is-external-href.ts` stay as they are (see D2 Scope).
- **Electron mapping.** `isAllowedExternalUrl(u)` ⇔ `classifyUrl(u, null) ∈ {external, loopback, mailto}`. That is exactly today's `EXTERNAL_SCHEME_ALLOWLIST` (`link-handling.ts:118`), minus control-character and backslash inputs.
- **Parity.** Client/Electron parity is defined over absolute URLs only; relative input has no meaning without an origin.
- **Stricter validators win.** `classifyUrl` is a floor, never a replacement for a stricter existing rule.
  - The plugin host's `navigateDashboard` rules stay in force (`plugin-embedded-app` "Host navigation is validated": no `.`/`..` segment, not under `/apps/`, history push only, no `window.location` write).
  - The migration of `dashboard-plugin-runtime/src/embedded-app.tsx` touches only its raw `window.open(${base}${suffix})` site (`:193`). `navigateDashboard`, `openSession` and `openFolder` keep their validator and history-push behaviour unchanged.

### D4. CI guard as `scripts/check-client-sinks.mjs`
- Follows the `check-fixed-tick-waits.mjs` pattern: an exported analyzer, a `ci.yml` step, and the ship gate.
- Scans the client-side roots only: `packages/client/src`, `packages/client-utils/src`, `packages/*-plugin/src/client`, `packages/dashboard-plugin-runtime/src` (excluding `src/server/**`, which holds server code such as `file-validator-pool.ts:94` `new Worker(`) and `packages/team-app/src`. Tests are skipped.
- It is comment-aware: it tokenizes with the TypeScript scanner, so tokens inside comments and string literals never match.
- Two rule sets, each turned on by its phase so CI stays green between phases:
  - `nav` (Phase A):
    - `window.open(`, `location.assign(`, `location.replace(`, `location.href =`, bare `location =`;
    - `setAttribute("href"|"src"|"action", …)`;
    - a JSX `href={expr}` on an intrinsic `<a>` whose expression is not a string literal.
    
    Also flagged: property navigation assignments `.href =`, `.src =`, `.action =`, and `window.location =`/`document.location =`. Constant-identifier hrefs get an annotation.
  - `html` (Phase B): `dangerouslySetInnerHTML`, `.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML`, `srcDoc`/`srcdoc`, `setAttribute("srcdoc", …)`, `.srcdoc =`, `document.write(`, `createContextualFragment(`, `setHTMLUnsafe(`, `new Worker(`, `new SharedWorker(`, `eval(`, `new Function(`.
  - The guard cannot tell a named-policy site from a raw one by token, so every migrated sink carries the annotation `// client-sinks: allow — trusted via <policy>`. Review checks that the policy named in the annotation is what the line actually uses.
  - Policy-helper import allowlist (Phase B): `trustedStaticSvg` may be imported only by `team-app/src/ui/icons.tsx`. This catches developer reuse of a key-lookup policy. (`trustedMermaidParse` was dropped with `pi-mermaid-parse`, see D5.)
- File allowlist: the chokepoint and policy modules.
- Its report is the authoritative sink inventory that the migration tasks drain. It covers the token patterns above, not every possible indirect flow. The e2e budget (D9) is the runtime backstop for HTML and script sinks only. A missed navigation sink to an `https:` URL raises no Trusted Types signal, so for navigation the guard is the only gate (accepted; React 19 still blocks `javascript:` in JSX).
- Per-line opt-out marker `// client-sinks: allow — <reason>`, which must sit directly above the line, so every exemption is reviewable.
- *Alternative:* a Biome 2.5 GritQL plugin. Deferred: the repo has no Grit plugins yet, and the mjs pattern is already wired into CI and the ship gate.
- *Alternative:* rely on CodeQL. Rejected as the primary gate: it is slow and post-merge, and it currently carries 14 untriaged entries.

### D5. Trusted Types policy set (`lib/security/trusted-types.ts`)
The module exports typed helpers. Sanitization **always** runs, with or without Trusted Types support. Only the final wrapping differs: a trusted value when `window.trustedTypes` exists, the sanitized string when it does not. Safari and Firefox therefore get the same sanitized output.

| Policy | Input contract | Rule |
|---|---|---|
| `pi-sanitized-html` | `(html, profile)` with profile `mermaid` / `asciidoc` / `katex` / `eml` / `docx` / `diagram-svg` | DOMPurify with that profile's existing config. All configs, including `sanitizeMermaidSvg`'s (`MermaidBlock.tsx:100-110`), move into `packages/shared/src/sanitize-profiles.ts`, so the policy module never imports a component (no cycle) |
| `pi-static-svg` | `(map, key)` for the compile-time `ICON` and `GALLERY` maps (both defined in `team-app/src/i18n/catalog.ts`; sinks at `icons.tsx:12` and `:38`) | looks up the constant; an unknown key yields empty markup, as today's `ICON[name] ?? ""` does. Keys may come from data (avatar ids), but the output is always a compile-time constant |
| `pi-worker-url` | URL string | `^/sw\.js$` or `^/assets/[^/]+\.m?js$` on the same origin, otherwise throws |
| `default` | anything from library internals | see D6 |

- **Mermaid** needs no parse policy. The spike showed that routing the pre-sanitize colorize `DOMParser.parseFromString(svg, "image/svg+xml")` through a sanitizer HTML-serializes the SVG, so the XML parse fails and colorize is silently skipped. The colorize step therefore sanitizes FIRST into a DOM (DOMPurify `RETURN_DOM` with the mermaid profile), tints that DOM, XML-serializes it, and the final `sanitizeMermaidSvg` still runs before injection through `pi-sanitized-html`.
  - *Superseded during implementation:* the planned wrap-only `pi-mermaid-parse` policy for the string parse. The local CodeQL ratchet (ship-it 4.4b) flagged that parse (`js/xml-bomb`, `js/xss`) and the wrap-only policy (`js/xss`), and the operator chose to restructure. Colorize no longer touches unsanitized renderer output, so the residual risk this design had accepted is removed.
- **AsciiDoc, DOCX, EML and diagram SVG** HTML is sanitized on the server. The client *re-sanitizes* it through `pi-sanitized-html` with the server's own configuration (one shared definition) as defense in depth.
  - Parity is proven by the visual suite (D9).
  - There is **no** wrap-only fallback, because that would violate "sanitized with the existing configuration". A parity failure blocks the phase (`SHIP_IT_BLOCKED.md`) and returns to design.
- **Workers.** Vite's generated worker wrapper (Monaco, `monaco-setup.ts:24-32`) and pdf.js construct `Worker` from a string inside generated or library code that we cannot wrap without breaking Vite's static worker detection. Those therefore go through `default`'s script-URL rule, which is the same strict allowlist as `pi-worker-url`. App code (`serviceWorker.register`) uses `pi-worker-url`.
  - Allowlist, production: same-origin `^/sw\.js$` or `^/assets/[^/]+\.m?js$`.
  - Allowlist, dev build only (`import.meta.env.DEV`): same-origin paths Vite serves for workers, so `enforce` is testable under `npm run dev`. These are `/node_modules/.vite/`, `/src/`, `/@fs/<repo-root>/` (scoped to the workspace root, not any filesystem path), or a `worker_file` query.
  - Monaco's own `blob:` workers use Monaco's own policies (`defaultWorkerFactory`). Any remaining `blob:` worker need is surfaced by the D9 enforce run and needs a design update, not a silent widening.

### D6. `default` policy rules (tuned, from the spike), mode-aware
- The server injects `<meta name="pi-trusted-types" content="off|report|enforce">` next to the import map (`index-html.ts:22`). The client reads it before registering policies.
  - In dev, the server proxies `index.html` from Vite unmodified (`server.ts:~3636`). A tiny Vite `transformIndexHtml` plugin in the client's Vite config injects the same meta from `PI_DASHBOARD_TRUSTED_TYPES`.
  - A missing or unknown meta is read as `report`, which is output-neutral, so the safe outcome needs no meta.
- **`report` mode:** every `default` method returns its input **unchanged** and counts the hit. Output is byte-identical to today, which honours the Compatibility promise. `createScript` also passes through in `report`.
- **`enforce` mode** uses these rules:
- `createHTML(s)`:
  - no `<` in the string → returned unchanged (inert; covers mermaid `<style>` CSS text);
  - first element tag is `<svg`, after skipping leading whitespace, an XML declaration, comments and a doctype → `sanitizeMermaidSvg` config. This widens the spike's measured `/^<svg/` and is re-measured by the D9 visual suite;
  - anything else → DOMPurify with the html+svg+svgFilters+mathMl profiles.
- `createScript` → `null`, so eval-strings and `javascript:` navigations are blocked under enforce.
- `createScriptURL` → the `pi-worker-url` allowlist, otherwise `null`.
- Each call is counted and reported through D8 as `trusted-types-default`, with a hit signature of sink plus the first stack frame.
- *Alternative:* the naive `DOMPurify.sanitize(s)`. Rejected by measurement: 6 of 13 diagrams broke.
- *Alternative:* a pass-through `default`. Rejected: it would turn every unknown sink into an unsanitized trusted value.

### D7. Independent `PI_DASHBOARD_TRUSTED_TYPES` knob
The baseline CSP and the Trusted Types directive have different blast radii. Existing `PI_DASHBOARD_CSP=enforce` deployments must not suddenly get Trusted Types enforcement.
- `csp.ts` resolves both modes.
- When the modes match, `require-trusted-types-for 'script'` is appended to the baseline header value.
- When they differ, the other header kind (enforcing vs report-only) is set independently with only that directive. The two header names differ, so policies are never comma-joined into one value.
- The existing "add only if absent" behaviour is kept per header kind.
- `/live/` stays skipped.

### D8. Violation channel: client listener, authenticated POST
- The client listens for `securitypolicyviolation` and collects `default`-policy hits. It dedupes by `(directive, sink, source)` with counts.
  - `source` is the script URL with its query and fragment stripped, plus the line number. This keeps `?ni=`, file paths and tokens out of counters.
  - When `event.sample` has no `|`, `sink` is the fixed token `unknown`, never sample content.
  - `sink` is the prefix of `event.sample` up to the first `|` (Chrome's `"Element innerHTML|…"` form), capped at 64 characters. The rest of the sample is discarded on the client, and no content sample is ever sent.
  - This channel is unrelated to the live-preview `/__pi/csp-report` sink (`live-server/live-csp-report.ts`), which receives unauthenticated reports from sandboxed preview frames.
- It flushes every 30 s and on `pagehide`, using `fetch(…, {keepalive:true})` with the bearer. Each flush carries at most 50 distinct keys, and the rest fold into one `overflow` counter.
- *Alternative:* `report-to`/`report-uri`. Rejected: browsers send those reports without credentials, so the endpoint would have to be unauthenticated, which is a DoS and pollution surface.
- Server `POST /api/csp-violations`:
  - authenticated, 8 KiB body cap, schema-validated;
  - per-principal token bucket: 12 requests/min, burst 3; excess gets HTTP 429 and counters stay unchanged;
  - in-memory counters capped at 500 keys (LRU);
  - `GET` returns the counters to operators;
  - raw samples are never persisted, and rejected bodies are never logged.

### D9. Budget and visual suite in `tests/e2e/`
The spike harness moves into a Playwright spec against the docker harness. It runs in the opt-in e2e lane (`npm run test:e2e`) and in `ship-it`'s docker-harness stage. Per-PR CI enforcement comes from the D4 guard; the e2e budget is the runtime backstop.
- **Header.** The server emits Trusted Types in `report` mode itself, so the `route.fulfill` injection, and with it the Local Network Access trap, is gone. Service workers stay blocked for determinism.
- **Budget.** Per route, zero Trusted Types violations, and `default`-policy hits ≤ the recorded count in `tests/e2e/fixtures/trusted-types-budget.json`. The fixtures are deterministic, so counts are stable, and a new raw sink raises them.
- **Visual check.** The 13-type mermaid gallery plus AsciiDoc, EML and KaTeX fixtures are screenshotted under `PI_DASHBOARD_TRUSTED_TYPES=enforce` and compared with `off`.
  - Tolerance comes from a double-baseline run; gitGraph varies by ±8 px between runs.
- **Guards.** Both are spike lessons.
  - A control probe proves the directive is active. It runs as a separate test step that **expects** exactly one violation, and that violation is excluded from the per-route zero-violation budget.
  - Any page showing the offline banner fails the run.
- **Enforce results.** The `enforce` run over editor, PDF, chat and plugin settings is recorded in a new note, `docs/research/trusted-types-enforce-results.md`. The dated spike report stays unedited, since it is cited evidence.

### D10. Navigation intent format and lifecycle
- **Format:** `ni = base64url(e) "." base64url(HMAC-SHA256(key, p \0 k \0 canon(target) \0 e))`.
  - Only `e`, the expiry in epoch seconds (exactly 600 s after minting), and the MAC appear in the URL.
  - The principal `p`, the kind `k` (`url-view` or `file-view`) and the canonical target (`url`, or `cwd + "\0" + path`) are **not** in the URL. The verifier takes them from its own request context and the route, then recomputes the MAC.
  - `ni` adds no identity and no path beyond what the route URL already carries in clear (`cwd`, `path`, `url`).
  - `ni` is a bearer value for at most 10 minutes, but it verifies only for the same principal, so a leaked URL gives nothing to anyone else.
- **Principal.** `p` is the principal the identity plane resolves for the request. When the plane is inert, it is the operator admitted by the network guard (loopback or paired device), recorded as `local-operator`.
  - Cross-site callers cannot mint or read intents (Context: CORS allowlist plus the mutation-origin gate).
  - In inert mode, tabs of the same operator can replay each other's intents. That is accepted: the intent only restores what that operator could get with one click.
- **Key:** a per-process random 32-byte key, the `SignedChallenges` pattern. A restart invalidates every intent, by design.
- **Who mints.** Intents are needed only where an operator action produces a **route-backed** overlay URL. In-page surfaces (`FilePreviewOverlay`, editor-pane tabs, the loopback split viewer from `use-loopback-link-open.ts:30`) already declare provenance through the React provider and need no `ni`.

  | Operator action | Carrier |
  |---|---|
  | Expand on an operator-provenance preview card (`PreviewCard.tsx:115-117`, `expandUrlFor`) | route URL + `ni` |
  | Any other operator click handler that navigates to `/pi-view` or `/folder/:cwd/view` (for example the mobile/remote file-link fallback of `tool-output-linkification`) | route URL + `ni` |
  | File-tree click, in-page preview overlay, canvas file chip, canvas tool card, linkified loopback URL | in-page provider; no URL carrier |

  - It never mints for canvas auto-open, the confirm chip of an agent-declared server or URL, agent preview cards, or Expand on an agent-provenance card.
  - The task phase enumerates every caller of the route builders and assigns each a row.
  - Modifier-click, middle-click and "open in new tab" use the plain `href`, which carries no intent, so they open with `agent` provenance (fail closed, documented).
  - If minting fails, the navigation happens without `ni`.
- **Verify:** `POST /api/nav-intent/verify {ni, kind, target}` returns `{ok}`. It uses the same authentication as minting and a constant-time MAC compare (`timingSafeEqual`).
  - The overlay shows a pending state for at most 2 s, then mounts with `operator` on success, or with `agent` on failure or timeout.
  - The verdict is fixed for the mount; there is no mid-render upgrade, so the live capability is minted once with the right policy.
- *Alternative:* carry provenance in `history.state`. Rejected entirely. It is lost on new-tab and "open in window", and a same-tab reload keeps it even after `ni` is stripped, which breaks the "intent removed from the address bar" scenario.
- *Alternative:* a client-held key. Rejected: anything the client can sign, a crafted page in the same origin can sign too.

### D11. Phase 0 is a local guard, later unified
`client-utils/identity/login-flow.ts` validates all three discovery endpoints (`authorization_endpoint`, `token_endpoint`, `end_session_endpoint`) with a small `isAllowedOidcEndpoint`: `https:`, or `http:` on a loopback host. When Phase A rebases it onto `classifyUrl` (evaluated with `origin = null`, since discovery endpoints are absolute), the rule is explicitly `class !== "blocked" && (protocol === "https:" || class === "loopback")`. An https endpoint on the dashboard's own host is therefore allowed, and public `http:` stays rejected. The 1.1 tests pin both. It throws `LoginFlowError("discovery-failed")` before building the authorize URL, calling `fetch`, or assigning the logout URL (`login-flow.ts:125`, `:155`). Phase A later reimplements it on top of `classifyUrl`, with the behaviour pinned by the Phase 0 tests.

## Risks / Trade-offs

- [Monaco, pdf.js or a plugin calls `eval`/`new Function` and breaks under `enforce`] → Under `default`, `createScript` returns `null`. The spike recorded 0 `createScript` calls in the mermaid gallery, but Monaco and pdf.js were not exercised under `enforce`. The D9 suite runs the editor, PDF and plugin settings routes under `enforce`. A failure blocks only a future default flip, not this change, since the default stays `report`.
- [A sanitizing `default` silently degrades library output (the colorize lesson)] → App-owned sinks never use `default` (D5); the D4 guard and the D9 hit budget catch regressions; the D9 visual suite catches pixel drift.
- [Client re-sanitization of server HTML drifts from server output] → One shared config definition and a visual parity check. A parity failure blocks the phase (D5); there is no wrap-only fallback.
- [`default` cost on hot paths: about 155 DOMPurify calls per diagram-heavy page] → Measure before and after on the session-chat fixture (performance-optimization discipline). The cost applies only in `enforce` mode, since `report` passes through. Labels are tiny strings. The budget is ≤ 20 ms added per page (task 8.4). The metric is the sum of time spent inside `default`-policy callbacks per page load, median of 5 runs, on the mermaid-gallery and session-chat fixtures in `enforce` mode. Over budget, the phase blocks and returns to design; `htmlLabels:false` is not a silent fallback, because it changes output.
- [Guard false positives (a banned token inside a string or comment)] → The per-line opt-out marker with a mandatory reason, and the allowlist.
- [Plugin authors with raw sinks] → Nothing breaks in `report`. Under `enforce`, `default` sanitizes. The SDK chokepoints and a short plugin-guide note give a migration path.
- [Navigation-intent replay within 10 minutes by another device of the same principal] → Accepted: the intent only restores what that principal could already do with one click. The target and route binding stop reuse on other targets.
- [Electron bundled pages enforce Trusted Types from day one, outside the `PI_DASHBOARD_TRUSTED_TYPES` knob] → Accepted. They are four static, fully owned pages (`src/renderer/{doctor,remote-connect,connecting}.html`, `resources/loading.html`) with tests that render real data under enforcement (task 9.1). Rollback is reverting the commit. The knob governs dashboard documents only.
  - Under enforcement even a constant-string `innerHTML` throws, so each page registers a page-local policy at the top of its first inline script, before any sink runs, or switches the sink to DOM APIs or `textContent`. This covers `loading.html:106`, `remote-connect.html:206` and `doctor.html:111,146,152`.
  - `loading.html` probes loopback servers with a direct `fetch` (`loading.html:156-166`), so its policy includes `connect-src http: https:`.
  - The `data:` splash page (`main.ts:391`, text set via `executeJavaScript` → `textContent`) stays out of scope: it has no data-driven HTML sink.
- [Superseding an in-flight change written by another session] → The user decides to withdraw `add-trusted-types-report-only`. This change does not edit it.

## Migration Plan

1. **Phase 0:** guard plus unit tests. Ship.
2. **Phase A:**
   - land `classifyUrl` with its tests;
   - delegate the existing gates (parity tests stay green);
   - add the chokepoints and SDK re-exports;
   - migrate the sinks file by file;
   - add `check-client-sinks.mjs` to `ci.yml` and the ship gate last, once the tree is clean.
3. **Phase B:**
   - add the policy module and `default`;
   - move the sinks to named policies;
   - add the server knob (default `report`) and `/api/csp-violations`;
   - add the client reporter;
   - add the e2e budget and visual suite;
   - add Electron meta CSPs.
4. **Phase C:**
   - add the mint and verify endpoints;
   - mint at the route-URL carrier sites (D10 table);
   - make the overlay provenance conditional.
5. **Rollback:**
   - Phase 0: revert the guard.
   - Phase A: the chokepoints pass allowed URLs through unchanged, so revert per file; remove the CI step.
   - Phase B: set `PI_DASHBOARD_TRUSTED_TYPES=off`; the policies are inert without the directive.
   - Phase C: remove minting, and overlays return to today's `agent` provenance.

## Open Questions

- The exact flush interval and LRU size for violation counters. Tunable after the first release's telemetry, with no change to specs or tasks.
