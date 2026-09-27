# Design: route previews to the grant dialog, explain the rest, fix the dialog defects

## Evidence

Spike on 2026-09-24 against the compiled build (server PID 9936 from repo source;
client dist built 23:04:27, after merge `f827e381e` at 23:02:49). Run on an
isolated instance: port 8123, `accessGrants.promptEnabled:true`,
`hostGate.mode:"enforce"`, a `HOME` outside `/tmp`.

| Probe | Result |
|---|---|
| no header (`<img src>` equivalent) | 403 in 101 ms, `degraded:ineligible`, no prompt |
| bogus header | 403, treated as absent |
| real capability | held 2130 ms → `grant_request` → allow-once → 200 image/png 251,511 B |
| no header after allow-once | 403 (allow-once persists nothing) |
| real capability < 120 s after settle | 403 in 76 ms, no prompt (backoff) |
| real browser, `new Image()` | `img ERROR` |
| real browser, `fetch` | dialog rendered; Allow once → 200, 251,511 B after 67 s |
| `HOME=/tmp/…`, allow-once | prompted, settled allow-once, still 403: `/private/tmp` is an ancestor of `$HOME` |

Source facts established by two review cycles:

- pdf.js loads `{url}` through the **global** `fetch` (`PDFFetchStreamReader`,
  `pdfjs-dist/build/pdf.mjs:10132`), so it already carries the capability and
  accepts extra headers through `httpHeaders` (`pdf.mjs:9982`).
- A non-promptable request returns from `PendingGrantRegistry.record` *before*
  `floodReason` runs (`pending-grant-registry.ts`), so an ineligible request is
  never reported as `backoff`.
- A site without `hold` passes `requestHoldsCapability:false`
  (`denial-hold.ts:58-70`), so it resolves `ineligible`. On the held filesystem
  plane, `not-held` is reached when an unholdable request *joins* an existing
  entry (`grant-coordinator.ts:214-215`).
- `denialBody` (`file-routes.ts:58-66`) copies a fixed field whitelist; the seven
  holdless/office/EML body sites use it. The holding sites spread `...remedy`.
- An eligible request that joins an unprompted entry *promotes* it
  (`pending-grant-registry.ts:235-240`), but the entry keeps the channel of its
  first requester (`:265`). The spike's probe A followed by probe C (an
  ineligible request, then an eligible one) already hits this; the opt-out makes
  it routine.
- `gateFilePath` and `gateOfficeFile` pass no `hold` (`file-routes.ts:230, 293`).
  `/api/file`, `tree`, `exists`, `raw` and `render` do.
- Editor-pane tabs persist to `localStorage` (`editor-pane-state.ts:259, 277`);
  `reduceOpenFile` returns early for an open path without touching its flags
  (`editor-pane-state.ts:128-136`).

## Surfaces

| Surface | Route | Transport | Notice | Can prompt |
|---|---|---|---|---|
| editor tab: image (`ImagePreview` full) | `raw` (holds) | `<img>` → **`fetch` → `blob:`** | yes | operator-opened |
| editor tab: PDF (`PdfPreview`) | `raw` (holds) | pdf.js `{url}` (already `fetch`), always opted out | yes | only via the notice's click (D2) |
| editor tab: video, audio | `raw` (holds) | direct ranged `src` | yes | only via the notice's click (D2) |
| editor tab: markdown (`MarkdownViewer`), HTML (`HtmlPreview`) | `/api/file`, `raw` (hold) | `fetch` | yes | operator-opened |
| `FilePreviewOverlay`, text + image branch | `/api/file`, `raw` | `fetch`; image `<img>` → **`fetch` → `blob:`** | yes | always (click-opened) |
| `ImageLightbox`, same-origin `/api/file/raw` src only (incl. a local markdown image the operator clicked open) | `raw` | `<img>` → **`fetch` → `blob:`** | yes | always (click-opened) |
| monaco, asciidoc, diagram, mermaid | holding routes | `fetch` | no (unchanged) | operator-opened; opted out when auto-opened |
| docx, pptx, spreadsheet, email, `rendered-pdf` | holdless (`gateOfficeFile`, `gateFilePath`) | `fetch` | no (unchanged) | never |
| inline chat-card image; markdown-embedded images rendered inline; the `/view` overlay route (`PreviewOverlayView` "expand", inline `ImagePreview`) | `raw` | `<img>` | no | never (unchanged; follow-up) |

`MarkdownPreview` (used by `PreviewCard` and the `/view` overlay route) is not a
notice surface. "Preview overlay" in this change always means
`FilePreviewOverlay`, never `PreviewOverlayView`.

**Provenance fails closed** (D4). A component outside any provider opts out.
The editor pane, `FilePreviewOverlay` and `ImageLightbox` are the only places
that declare operator provenance. The lightbox can render inside an auto-opened
markdown tab (React context crosses its portal), which is why it declares its
own provenance instead of inheriting.

The notice covers the six rows marked "yes". The opt-out (D4) covers every component in `preview/` and `editor-pane/` that
requests a file route, because several of them — pdf.js, `CappedViewer`, the
agent's `/view` chat card — can raise the dialog today.

## Decisions

### D1: Only images change transport

| Kind | Transport |
|---|---|
| image (tab, overlay, lightbox-on-`/api/file/raw`), same-origin API base | `fetch` → `blob:` URL; the component revokes the URL it created on unmount and on replacement |
| image with a cross-origin API base (`pi-dashboard.dev` shell) | unchanged `<img>`: such a request can never be eligible, and `fetch` would add a CORS requirement an `<img>` does not have |
| image with a caller-supplied `srcUrl` (EML attachment `blob:`) | unchanged; the component never fetches or revokes a URL it did not create |
| lightbox with any other `src` (data:, blob:, cross-origin markdown image) | unchanged `<img>`, `fallbackSrc` path intact |
| PDF | unchanged pdf.js `{url}`, **always** opted out via `httpHeaders` (D2): pdf.js loads one document with several ranged requests, and Allow once admits only one. The notice replaces the error state only when `PdfPreview` loads its own `/api/file/raw` source; with a caller `srcUrl` (`DocxPreview`'s `rendered-pdf`, `EmlPreview`'s `blob:`) its current error state is kept |
| video, audio | unchanged ranged `src` (D2) |

An eligible request is *held* while the dialog is open (67 s observed), bounded
by the server's 120 s entry TTL. Viewers that already have a loading state keep
it for the whole hold; `ImagePreview`'s `full` variant has none today and gains
one, so a held image is not an empty pane. Browser HTTP caching still applies to
`fetch` (the route sends `Cache-Control: private, max-age=60`).

When an image keeps `<img>` (cross-origin API base), `onError` carries no status
and no body. The notice then shows a transport-level variant, `unknown`: the
image could not be loaded, with no reason and no re-ask.

A request carries the capability only when the wrapper's same-origin rule
(`shouldAttach`) admits it. With a cross-origin API base (the `pi-dashboard.dev`
shell) no preview request is ever eligible. This is inherited from the wrapper;
D4's can-carry check keeps the notice honest about it.

### D2: Multi-request media (video, audio, PDF) never prompts without a click

Video and audio keep a direct ranged `src`, and PDF keeps pdf.js `{url}` with its
ranged loading; every PDF request is opted out whatever the provenance. Each
loads one resource with several requests, and Allow once admits exactly one, so
no request of theirs may raise the dialog by itself. On a load failure they issue exactly one
opted-out probe, `Range: bytes=0-0`, read only for status and denial fields. A
`416` (the route's answer for a zero-byte file) is not a refusal and shows the
ordinary load error.

The notice states, before the click, that a one-time answer admits only a check,
not the stream or document, and offers **Ask for access** (subject to D4's can-carry rule). The click issues one
eligible probe, which raises the dialog. On a 2xx the viewer remounts its media
element (or reloads the pdf.js document) to retry.

If that retry is refused again, the server cannot say why reliably (the
opted-out diagnosis may report `ineligible`, `throttled` or `ungrantable`, never
`backoff`). The *client* knows the sequence (asked → probe admitted → stream
refused) and renders a fixed message from that local state: a one-time answer
admitted only the check, not the stream; a lasting answer can be given in
Settings → Access. The notice then offers no further ask (D4's no-loop rule
wins). The copy states the fact; it does not recommend a verdict.

Probe guard: at most one diagnostic probe per load attempt, and none after the
post-ask retry. A remount does not re-arm it; only a new explicit ask does.

This applies to operator-opened and auto-opened media alike. Decided by the
operator on 2026-09-24 (scenario-design gate G1).

### D3: Opting out is an empty header value the wrapper already respects

`installGrantChannelFetch` never overrides a header the caller set. A caller opts
out by setting `X-Pi-Grant-Channel` to the empty string; `resolvePromptChannel("")`
yields `null`, so the request takes the ineligible path with no server change.

Exposed as `fetchWithoutGrantPrompt(input, init)`, `GRANT_OPT_OUT_HEADERS` (for
pdf.js `httpHeaders`), and `canCarryGrantChannel(url)` (the wrapper's
`shouldAttach` plus a live capability). Every opt-out site is found by one
search.

The opt-out only removes eligibility; it confers nothing.

### D4: Provenance is declared, fails closed, and follows the action that mounted the viewer

**Fail closed.** `usePreviewFetch()` returns `fetchWithoutGrantPrompt` unless a
`PreviewProvenance` provider above it declares `autoOpened:false`. Operator
provenance is therefore *declared*, never assumed. Every file-route request made
by a component in `components/preview/` and `components/editor-pane/` goes
through the hook, including `CappedViewer`'s `/api/file` size probe (it runs
before any registered viewer mounts, on a holding route) and pdf.js, which gets
`GRANT_OPT_OUT_HEADERS` via `httpHeaders` whenever the hook says opt out. A mount
point nobody listed (the agent's `/view` chat card `PreviewCard`, the `/view`
route `PreviewOverlayView`, `DiffFilePreview`, a future plugin surface) is opted
out by default; today several of them can raise the dialog.

**Who declares operator provenance:**

- the editor pane, per tab, from the tab's `autoOpened` field (below);
- `FilePreviewOverlay` and `ImageLightbox`, which only open on an operator
  click. Each renders its loading code in an inner child beneath its own
  `PreviewProvenance` (a provider in a component's JSX does not affect that
  component's own hooks). Each takes a `provenance` prop defaulting to
  operator, so a future non-click opener passes `auto` instead of silently
  inheriting eligibility.

`restrictCsp` and `background` are not provenance: `CanvasDriver.openTarget`
passes `restrictCsp:true` for both the auto-open effect and the mobile chip tap,
and `openInSplit` collapses `background` to `false` when the split is closed
(`SplitWorkspaceContext.tsx:210`). This change adds an explicit `autoOpened`
option to `openInSplit`: `true` from the auto-open effect (`CanvasDriver.tsx:86`),
`false` from the chip tap. `openLiveTarget`/`openUrlTarget` open loopback and URL
targets that never touch the file routes, so they carry no provenance.

**Tab rules.** The editor pane mounts only the active tab, keyed
(`EditorPane.tsx:125, 171-187`). The key gains `autoOpened`, so a provenance
change on the active tab remounts it and its next request uses the new value.
The value is decided by the action that makes the tab active:

| Action | Effect on `autoOpened` |
|---|---|
| new tab from an auto-open | `true` |
| new tab from an operator open | `false` |
| auto-open of an existing, **inactive** tab that activates it | `true` (otherwise an agent could re-focus a file the operator opened and raise a dialog through the remount) |
| auto-open of the **active** tab | unchanged (no mount, no request) |
| operator open that activates an existing tab, incl. the active one | `false` |
| operator tab click (`setActive`) | `false` |
| operator tab close that re-points activation (`reduceCloseTab`) | the newly active tab becomes `false` |
| background open (operator or auto) that does not activate | unchanged; decided when the tab is next activated |
| terminal reconcile (`closeByPath`) re-pointing activation | unchanged (not an operator action) |

**Persisted, validated, migrated.** The field is stored with the tab, like
`restrictCsp`. `isValidState` accepts it only as a boolean. `loadEditorPaneState`
seeds a missing value from `restrictCsp`, erring closed: a pre-change mobile
chip-tap tab loads opted out once. A reload restores the stored value; a
deep-linked editor route re-dispatches its explicit open, which sets `false`.
Editor-pane state is per session and last-writer-wins across browser windows
(no `storage` listener), so two windows on one session can overwrite each
other's provenance; accepted.

**The one action rule.** The notice knows whether the refused request was opted
out:

- opted-out request: **Ask for access** when `canCarryGrantChannel(url)` holds,
  unless the disclosed outcome is one no eligible request can change (`off`,
  `not-enforced`, `cannot-ask`, `ungrantable`, `recently-answered`, `declined`,
  `allowed-elsewhere`, `grant-failed`, `allowed-but-refused`, `throttled`). A
  withheld outcome, `ineligible`, `busy`, `unanswered` or `unavailable` allow it.
- eligible request: **Ask again** only for `busy`, `unanswered`, `unavailable`;
  never when the outcome is withheld.

The click re-runs the load eligibly, once. If that eligible re-request is
refused without raising a dialog, the control is replaced by the Settings →
Access pointer; the notice never loops.

Rejected: a server-side auto-open marker. The server cannot tell an auto-open
from a click, so any marker would be client-asserted exactly like this one.

### D5: `promptOutcome`, decided in the gate, disclosed only to the local or authenticated caller

The outcome is computed in `evaluateContainment` in three steps, first match
wins:

1. **Ungrantable.** A `not-promptable` resolution on the filesystem gate is
   `ungrantable`, at any site where a coordinator is installed: it is the most
   stable and most useful fact. (Without a coordinator the reason is
   `no-coordinator` → `off`.)
2. **Site.** A site called without `hold` can never suspend a request, so its
   outcome is `cannot-ask`.
3. **Reason.** `Resolution.reason` is a `string` (`grant-coordinator.ts:57`),
   so the mapping has two layers. The typed unions (`PreconditionReason`,
   `RefusalReason`, `FloodReason`) go through a `never`-checked switch;
   `PreconditionReason` is exported from `pending-grant-registry.ts` for this
   (today it is module-private). The
   coordinator's string literals and the `persist-failed:` prefix go through an
   explicit table. A unit test lists every literal emitted today and asserts
   each has an **explicit** row in the table or switch (including the ones whose
   row is `unavailable`); the default arm exists only for literals not emitted
   today.

**Reason refinement in the coordinator.** A request that *joins* an existing
entry resolves `not-held` today, whatever its eligibility
(`grant-coordinator.ts:215`), and every file in one directory shares one entry.
The deny reason becomes, first match: the precondition's reason when the request
is not promptable; the reason the join outcome carries when promotion was
blocked (below); else `not-held`. The entry's `suppressedBy` is never reported
to a joiner: it was written for the entry's first requester and is stale for
anyone else. The resolution is still a deny; only its reason string is sharper.

**The dialog has its own owner.** Today an entry has one `channel`, used both
for its capacity share (12 entries per channel) and for its dialog bounds (one
open dialog per channel, the deferred per-channel prompt rate). When an
eligible request joins an unprompted entry created by an opted-out request, the
join branch decides promotion with `floodReason(existing…)`
(`pending-grant-registry.ts:245`) against the *creator's* IP-keyed channel, so
the operator's own one-dialog bound is never consulted. The bug exists today
(the spike's probe A then probe C); the opt-out makes it routine.

The fix separates the two roles:

- `entry.channel` stays the creator's. A join consumes no capacity, so the entry
  share is not re-checked, never refunded, and never moved.
- A new field `entry.dialogChannel` names who the dialog is charged to. It is
  the creator's channel when the creator's request prompts it. On a join by an
  eligible request, the dialog-scoped checks in `floodReason` (open-dialog
  bound, deferred per-channel prompt rate) are evaluated against the
  **joiner's** channel. If they pass, `dialogChannel` becomes the joiner's
  channel and the entry is promoted; the grant's audit origin is re-pointed to
  the joiner's session too, because the joiner's request is the one the
  operator is answering. If they fail, the entry stays unprompted and the join
  outcome carries the flood reason, which is logged as a `flooded` transition
  and counted in `stats.flooded`, like any other per-channel suppression.
- `countChannelDialogs` and the per-channel prompt window read `dialogChannel`.

Type changes, stated: `PendingGrant` gains `dialogChannel`; the `joined` variant
of `RecordOutcome` gains an optional `reason`; `PreconditionReason` is exported.
No bound value changes, and a deny stays a deny.

| `promptOutcome` | From | Notice copy | Re-ask |
|---|---|---|---|
| `cannot-ask` | site without `hold` | this kind of preview can't ask; grant in Settings → Access | no |
| `off` | `disabled`, `no-coordinator` | access prompts are off (or disabled for this server); grant in Settings → Access | no |
| `not-enforced` | `report-mode` | prompts need the host gate in enforce mode; grant in Settings → Access | no |
| `ineligible` | `ineligible` | this view can't ask by itself | Ask for access (D4) |
| `busy` | `channel-concurrent`, `concurrent-cap` | another access question is open; answer it, then ask again | Ask again |
| `throttled` | `plane-rate`, `channel-rate`, `capacity`, `channel-share`, `deferred-share`, `waiters-full`, `broadcast-failed` | too many access questions are pending; they expire within about two minutes | no |
| `recently-answered` | `backoff` | this folder was answered in the last 2 minutes | no |
| `allowed-elsewhere` | `allow-once-not-shared` | Allow once admitted another file in this folder; use Allow always for several files | no |
| `declined` | `denied`, `refused-by-prior-refusal` | access was not allowed | no |
| `unanswered` | `expired`, `aborted` | the question expired without an answer | Ask again |
| `ungrantable` | `not-promptable`, `persist-failed:forbidden` | this folder can't be granted | no |
| `grant-failed` | other `persist-failed:*`, `settle-failed` | the answer was given but couldn't be saved; grant in Settings → Access | no (a settle arms the 120 s backoff) |
| `allowed-but-refused` | allow verdict whose `reEvaluate` failed | access was allowed, but the file still couldn't be read | no (a settle arms the 120 s backoff) |
| `unavailable` | anything else, incl. `no-audience`, `unknown-plane`, `not-held` | couldn't ask right now | Ask again |

**Disclosure.** `/api/health` withholds its `accessGrants` block unless
`isAuthenticated || isGenuinelyLocal` (`system-routes.ts:933-935`), which is
stricter than `networkGuard`. `promptOutcome` reveals the same posture, so it is
emitted only under that predicate. The predicate moves into one shared helper
used by both sites. Because holdless sites have no `hold`, the gate gains a
separate `disclosure` option (a boolean computed by the route from the shared
predicate). Every site that returns a denial body passes it: the five holding
sites in `file-routes.ts`, `gateFilePath` and `gateOfficeFile`, and
`session-routes.ts:404` (the session-file read). `gateFilePath` and
`gateOfficeFile` take no request today, so both gain a `disclosure` parameter
and all seven of their call sites compute it. `denialBody` (`file-routes.ts:58-66`)
copies a fixed whitelist and gains `promptOutcome`; without that, the field is
dropped at every holdless site. A `gateFilePath` call with `allowGrant:false`
mints no remedy (`containment-gate.ts:134`) and so carries no outcome. The
same holds for the two pre-gate refusals in `gateFilePath` (missing parameters
400, unknown session 403). The rule is therefore stated over bodies that carry
remedy fields: every such body carries `promptOutcome` under the predicate.

For callers outside the predicate (a trusted-CIDR or local-token caller with no
credential) the notice has no reason text. It still offers Ask for access when
the client opted out (D4), and the Settings pointer. This is a documented
trade-off: the predicate is not widened for this change.

### D6: The body names exactly what a grant would store

Every branch of `remedySubject` resolves symlinks in the subject it chose
(`realpathNearestAncestor`), so `/tmp` becomes `/private/tmp` at the `file`,
`directory` and `auto` sites alike. No branch widens beyond what
`remedySubject` already chose: the `auto` branch's "never wider than the refused
resource" still holds, because resolving a symlink does not change which
resource is named. For an existing directory this equals `normalizeGrantSubject`,
which is what the dialog and the store use. The canonical subject is computed
**first**: the ladder (`offeredAncestorLadder`) is built from it, then
`recordPathDenial` stores it, so the recorded denial, its rungs, the body and the
dialog all derive from one string.

In the degenerate case where the chosen subject is an existing regular file
(the refused path's parent is a file), the body names that file's real path
while a grant would store its directory. That case reads nothing anyway (a file
has no children); the body stays honest about the resource, and the grant
endpoint's own normalisation and forbidden filter still apply. The spec states
this as the one exception to "body names what a grant would store".

Cost: one synchronous real-path walk per denial, next to the ladder's cached
walk. Accepted.

### D7: The filesystem plane never prompts for an ungrantable subject

Mirror the cwd plane (`planes.ts:99`): `subjectOf` returns `null` when
`isUngrantableSubject(normalized)` holds. `onDenial` returns
`immediate("not-promptable")` → `promptOutcome:"ungrantable"`. The resume-path
check in `reEvaluate` stays as defence in depth.

`onDenial` returns before `registry.record`, so this is not a registry
transition. The coordinator logs one line, `[access-grant] not-promptable
plane=… subject=…`. The label is deliberately neutral and outside the registry's
`refused:<reason>` namespace: the coordinator cannot see why a plane returned
`null` (a malformed CORS origin also does), and log consumers parsing
`refused:*` must not meet an unknown reason. Only the filesystem gate maps it to
`ungrantable`. The health counters do not count it. The subject is written
JSON-quoted, as the registry's own log lines do: it derives from caller-supplied
query strings and may be attacker-shaped.

Cost: `isUngrantableSubject` now runs on every filesystem denial. Today it
builds the forbidden list twice per call (once in `isForbiddenGrantSubject`, once
in `subsumesForbiddenGrantSubject`), about 35 synchronous `realpath` calls. This
change builds it once per call and passes it to both, as the ladder already does
(`subsumesForbiddenGrantSubject` takes a prebuilt list). It is not memoised
across calls: the list depends on live filesystem state (a `~/.ssh` created after
boot, a home that becomes a symlink), so a process-lifetime cache would go stale.
About 18 synchronous `realpath` calls per denial remain; accepted. The path denial itself
is still recorded in `access-denials`, before the coordinator runs.

### D8: The forbidden list is platform-scoped, and that widens it on purpose

`forbiddenGrantSubjects(env?: { homedir?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv })`
is a signature extension defaulting to `process.platform` / `process.env`. `whole`
holds only the running platform's system directories:

- POSIX: `/`, `$HOME`, `/etc`, `/usr`, `/var`, `/Library`, `/System`, `/bin`,
  `/sbin`, `/opt` (unchanged).
- Windows: the drive root, `$HOME`, and `%SystemRoot%`, `%ProgramFiles%`,
  `%ProgramFiles(x86)%`, `%ProgramData%` from the environment, with the `C:\…`
  literals as fallback when a variable is unset. A system drive other than C: is
  covered.

**The containment rule is kept unchanged.** The shipped rule
(`path-anchor-grants` "a real-path subtree relation in both directions",
`access-grant-yolo` "an ancestor containing a forbidden directory is refused")
refuses a candidate that *contains* a forbidden directory. It is load-bearing:
it is why `/private` (contains `/private/etc`) and `/Users` (contains `$HOME`)
are refused. `subsumesForbiddenGrantSubject` stays exactly as it is.

**What goes are the junk entries, and that widens the grantable set,
deliberately.** Because `<cwd>/C:\Windows` … are forbidden *entries*, the
containment rule makes the server's cwd and every ancestor that contains them
ungrantable. For this checkout that refuses
`/Users/robson/Project/pi-agent-dashboard` and `/Users/robson/Project`. No spec
names these entries. After this change they are gone, so those directories are
grantable unless they contain a specified forbidden subject. Decided by the
operator on 2026-09-24; covered by a spec scenario and a regression test.

Two consequences follow from the same rule and are part of that decision:

- **The ladder offers them.** `offeredAncestorLadder` stops at the first rung
  that subsumes a forbidden entry (`ancestor-ladder.ts:138`). Today the junk
  stops it at `/Users/robson/Project`; afterwards, a denial under a non-git
  directory below it offers `/Users/robson/Project` as a selectable rung, as the
  ladder already does for any other non-git directory under the home directory.
  The denied subject stays preselected and no wider rung is ever selected for
  the operator.
- **YOLO reaches them.** `YoloController.decide` refuses an ungrantable subject
  (`yolo-session.ts:225`), and its roots come from the same ladder, so YOLO's
  scope widens identically. The `access-grant-yolo` requirements are unchanged;
  only the entries they compare against change.

The junk entries' protection was also install-dependent: it existed only while
the server's cwd happened to sit inside the operator's project tree.

`isForbiddenGrantSubject`, `subsumesForbiddenGrantSubject` and
`isUngrantableSubject` widen their `env` parameter the same way and forward it,
so the Windows scenarios are testable on a POSIX host.

### D9: One `DenialNotice`, no grant control

`DenialNotice` renders a discriminated result: `ok | not-found | refused |
denied(promptOutcome?, subject) | error`, plus the client-side stream state of
D2. A 403 without `denialId` (unknown session, sites without remedy fields) is
`refused` and shows the server's `error` string; no string matching. Its actions
are the re-ask of D4/D5 and a pointer to Settings → Access. It never posts a
grant. Subjects render verbatim from the body.

## Risks and trade-offs

- **The forbidden list gets narrower** (D8). Decided; documented; tested.
- **The backoff still bites.** After any answer, eligible requests for that
  folder fail for 120 s; the notice names it (`recently-answered`).
- **Allow once covers one request.** A stream or several files in one folder
  need Allow always; the notice says so before and after.
- **The path-denial store is FIFO at 200 entries with no coalescing**
  (`access-denials.ts:41`). More refused requests per operator action (image
  fetch, pdf.js range requests, one media probe, auto-opened viewers) evict older
  `denialId`s sooner; a grant from Settings → Access against an evicted denial
  gets `409`, and re-triggering the read mints a new one. Accepted; the store is
  unchanged.
- **Opted-out denials are keyed by source address.** Declared-ineligible
  requests carry no socket, so they are keyed by the source channel (a /24) and
  count toward the registry's global bounds; a remote peer on the same /24
  shares that budget. Auto-opened previews and media probes add entries (at most
  one probe per load attempt; entries coalesce per directory and expire in
  120 s). A dialog is charged to the channel of the request that prompted it
  (`dialogChannel`, D5); entry capacity stays with the creator. The bounds themselves are unchanged.
- **The ladder and YOLO reach the server's cwd ancestors** (D8). Part of the
  operator's decision.
- **Cross-origin shell never prompts.** Inherited from the wrapper.
- **Markdown-embedded images and the inline chat card stay silent.** Named
  follow-up.
- **Declaration drift.** Provenance fails closed, so a forgotten provider costs an
  extra click (Ask for access), never a dialog. A test renders every component in
  `preview/` and `editor-pane/` that requests a file route with no provider and
  asserts every request opts out.
