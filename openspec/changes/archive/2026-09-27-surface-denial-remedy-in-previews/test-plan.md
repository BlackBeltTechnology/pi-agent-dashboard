# Test Plan — surface-denial-remedy-in-previews

Stage: design   Generated: 2026-09-24

## ✓ Clarifications resolved (3 of 3)

- [x] **G1** — PDF + Allow once: pdf.js loads one document with several ranged
  requests and Allow once admits one. **PDF is treated like streamed media**:
  always opted out, one diagnostic probe, Ask for access on the notice with a
  warning first. Folded into design D1/D2 and the spec.
- [x] **G2** — Denial-path cost: **no performance scenario**; the cost is
  accepted as documented (design D7).
- [x] **G3** — Windows forbidden-list scenarios run **only on a real Windows
  host**, level `ci`, following the `_smoke.yml` Windows-leg smoke-script
  pattern (`scripts/windows-introspection-smoke.ts`).

> No scenario remains blocked.

Levels: `L1` vitest (`packages/*/src/**/__tests__/*.test.ts`), `L3` Playwright
against the docker harness (`tests/e2e/*.spec.ts`; port from
`.pi-test-harness.json` `dashboardPort`, never hard-coded), `ci` workflow-level on
a Windows runner. L3 rows that need a dialog flip `hostGate.mode=enforce` and
`accessGrants.promptEnabled` in-container and restore config byte-for-byte, as
`tests/e2e/access-grant-dialog.spec.ts` does; one probe directory per test
(120 s backoff).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | path-anchor-grants · body subject canonical | EP | L1 | automated | temp dir `real/` + symlink `link -> real`; session cwd elsewhere; request path `link/a.png` | `/api/file/raw` denied | 403 body `subject` === `realpath(real)`; the recorded denial's subject is the same string |
| E2 | path-anchor-grants · body and dialog name the same subject | EP | L1 | automated | prompting on, `enforce`, capability-holding request for `link/a.png` | denial raises `grant_request` | `grant_request.subject` === 403 body `subject` (compare after the verdict releases the request) |
| E3 | path-anchor-grants · canonical body still binds a grant | state-transition | L1 | automated | denial body from E1 (`denialId`, canonical `subject`) | `POST /api/access/grants {denialId, subject, scope:"session"}` from a local caller | 200; `GET /api/access/grants` lists `subject` === `realpath(real)` |
| E4 | path-anchor-grants · non-directory exception | BVA | L1 | automated | existing regular file `real/notes.txt`; request path `real/notes.txt/x` | denial | body `subject` === `realpath(real/notes.txt)`; it is NOT `realpath(real)` |
| E5 | path-anchor-grants · closed outcome set | decision-table | L1 | automated | one deny `Resolution.reason` per literal emitted today (`disabled`, `report-mode`, `no-coordinator`, `ineligible`, `no-audience`, `unknown-plane`, `not-held`, `channel-concurrent`, `concurrent-cap`, `plane-rate`, `channel-rate`, `capacity`, `channel-share`, `deferred-share`, `waiters-full`, `broadcast-failed`, `backoff`, `allow-once-not-shared`, `denied`, `refused-by-prior-refusal`, `expired`, `aborted`, `not-promptable`, `persist-failed:forbidden`, `persist-failed:write-failed`, `settle-failed`) plus one unknown string | map to `promptOutcome` | each literal hits an **explicit** row with the D5 value; the unknown string → `unavailable`; the test fails if a literal falls to the default arm |
| E6 | path-anchor-grants · ungrantable wins at a holdless site | decision-table | L1 | automated | injected home below the subject's directory; local caller | `/api/file/sheet` (`gateOfficeFile`, holdless) denied | body `promptOutcome` === `"ungrantable"` (not `cannot-ask`) |
| E7 | path-anchor-grants · holdless site reports cannot-ask | decision-table | L1 | automated | grantable subject outside cwd; local caller | `/api/file/sheet` denied | body `promptOutcome` === `"cannot-ask"` |
| E8 | path-anchor-grants · disclosure withheld from an untrusted caller | decision-table | L1 | automated | caller admitted by trusted CIDR, not authenticated, not genuinely local | denial at each body site: `/api/file`, `tree`, `exists`, `raw`, `render`, `sheet`, `eml`, `rendered-pdf`, the session-file read | every body has `denialId` and NO `promptOutcome` key |
| E9 | path-anchor-grants · off vs not-enforced | decision-table | L1 | automated | genuinely local caller; (a) `promptEnabled:false`; (b) `promptEnabled:true`, `hostGate.mode:"report"` | `/api/file/raw` denied | (a) `promptOutcome:"off"`; (b) `promptOutcome:"not-enforced"` |
| E10 | path-anchor-grants · recently answered | state-transition | L1 | automated | entry for dir D settled `allow-once` at t0 | eligible read of another file in D at t0+10 s | `promptOutcome:"recently-answered"`; no `grant_request` |
| E11 | path-anchor-grants · joiner reports its own eligibility | state-transition | L1 | automated | pending unprompted entry for D (from an eligible request suppressed by `concurrent-cap`) | declared-ineligible read of another file in D | deny reason `ineligible`; `promptOutcome:"ineligible"` (not `unavailable`/`not-held`) |
| E12 | path-anchor-grants · allowed-but-refused | state-transition | L1 | automated | eligible held read of `D/a.png`; before the verdict, `D` replaced by a symlink to a directory outside the answered subject | verdict `allow-once` | 403; `promptOutcome:"allowed-but-refused"` |
| E13 | path-anchor-grants · body keys unchanged, outcome carried at holdless sites | EP | L1 | automated | local caller; holdless `/api/file/eml` denial | response | keys exactly `success,error,reason,hint,subject,denialId,ancestors,promptOutcome`; pre-existing values byte-identical to today's fixture |
| E14 | path-anchor-grants · no remedy, no outcome | EP | L1 | automated | `gateFilePath` call with `allowGrant:false` (open-in-system site) outside cwd | request | 403 body has neither `denialId` nor `promptOutcome` |
| E15 | access-grant-dialog · ungrantable never prompted, logged | decision-table | L1 | automated | injected home `H`; subject = parent of `H`; prompting on, `enforce`, capability-holding request | filesystem denial | no `grant_request` broadcast; resolution reason `not-promptable`; one log line matching `[access-grant] not-promptable plane=filesystem subject="<parent>"` (subject JSON-quoted) |
| E16 | access-grant-dialog · grantable still prompted | decision-table | L1 | automated | same setup, subject a sibling of `H`'s parent that contains no listed subject | filesystem denial | exactly one `grant_request` broadcast |
| E17 | access-grant-eligibility · declared ineligible from a capability holder | decision-table | L1 | automated | live capability for socket S; request header `X-Pi-Grant-Channel: ""` | filesystem denial via the real gateway + coordinator | no `grant_request`; registry transition `degraded:ineligible` |
| E18 | access-grant-eligibility · declaration confers nothing | decision-table | L1 | automated | no capability issued; request header `X-Pi-Grant-Channel: ""` | filesystem denial | ineligible; identical outcome to a request without the header |
| E19 | access-grant-registry · ineligible creator does not own the dialog | state-transition | L1 | automated | entry for D recorded by an ineligible request (source channel `source:127.0.0.0/24`) | eligible request from socket S joins; entry prompted | `countChannelDialogs(S)`===1; `countChannelDialogs(source)`===0; the entry still counts in the source channel's entry share |
| E20 | access-grant-registry · one-dialog bound applies to a joined entry | state-transition | L1 | automated | S already has a dialog open for dir A; unprompted entry for dir B created by an ineligible request | eligible request from S joins B | B stays unprompted; `joined.reason`===`channel-concurrent`; transition `flooded:channel-concurrent`; `stats.flooded["channel-concurrent"]` +1; deny reason `channel-concurrent` → `busy` (never the entry's stale `ineligible`) |
| E21 | access-grant-registry · joined dialog names the joiner as origin | state-transition | L1 | automated | entry recorded by session X's ineligible request | session Y's eligible request joins, dialog raised, verdict `allow-always` | persisted grant `origin` === Y; log line `persisted … origin="Y"` |
| E22 | access-grant-registry · deferred per-channel rate is the joiner's | BVA | L1 | automated | network-plane entry created by requester R1 who has used its 1 prompt/min; joiner R2 has not | R2 joins | promotion decided against R2's window: prompted; R1's window unchanged |
| E23 | path-anchor-grants · POSIX forbidden entries | EP | L1 | automated | POSIX host; server cwd `C` below home, containing no listed subject | build entries; `isUngrantableSubject(C)`, `(parent(C))`, `(parent(home))` | no entry contains `\` or starts with a drive letter; `C` and `parent(C)` grantable; `parent(home)` ungrantable |
| E24 | path-anchor-grants · Windows forbidden entries on a real host | EP | ci | automated | Windows runner, `%SystemRoot%` as set by the host | `npx tsx scripts/windows-forbidden-subjects-smoke.ts` in the `_smoke.yml` Windows leg | exits 0; printed entries include the host's `%SystemRoot%`; no entry starts with `/` or ends in `\etc`, `\usr`, `\var` |
| E25 | preview-denial-remedy · tab provenance rules | decision-table | L1 | automated | editor-pane state per D4 table row: new tab auto / operator; auto-open of inactive existing; auto-open of active; operator open activating; `setActive`; `reduceCloseTab` re-point; background open; `closeByPath` re-point | reducer action | resulting `autoOpened` equals the D4 table value for every row |
| E26 | preview-denial-remedy · persisted provenance | EP | L1 | automated | stored state (a) `autoOpened:"yes"`; (b) tab without `autoOpened`, `restrictCsp:true`; (c) without both | `loadEditorPaneState` | (a) rejected by `isValidState`; (b) loads `autoOpened:true`; (c) loads `false` |
| E27 | preview-denial-remedy · provenance change remounts | state-transition | L1 | automated | active tab `autoOpened:true`, viewer mounted | operator re-opens the same path | viewer unmounts and remounts once (key changed); its next request is eligible |
| E28 | preview-denial-remedy · fetch fails closed | decision-table | L1 | automated | `usePreviewFetch()` with (a) no provider, (b) provider `autoOpened:true`, (c) provider `autoOpened:false`, live capability | fetch `/api/file/raw…` | (a),(b) header `X-Pi-Grant-Channel: ""`; (c) header carries the capability |
| E29 | preview-denial-remedy · every file-route requester opts out undeclared | EP | L1 | automated | every component in `components/preview/` and `components/editor-pane/` that requests a file route, incl. `CappedViewer`, rendered with no provider, fetch spy + live capability | mount | every `/api/*` request carries `X-Pi-Grant-Channel: ""`; pdf.js receives `httpHeaders` with the empty value; the test enumerates the directory, so a new requester without the hook fails it |
| E30 | preview-denial-remedy · canvas provenance source | decision-table | L1 | automated | `CanvasDriver` with a file target | (a) auto-open effect fires; (b) chip tap | `openInSplit` called with (a) `autoOpened:true`; (b) `autoOpened:false`; `restrictCsp` unchanged in both |
| E31 | preview-denial-remedy · one action rule | decision-table | L1 | automated | `DenialNotice` for {opted-out, eligible} × {capability carriable, not} × each outcome + withheld | render | Ask for access only for opted-out ∧ carriable ∧ outcome ∈ {withheld, `ineligible`, `busy`, `unanswered`, `unavailable`}; Ask again only for eligible ∧ outcome ∈ {`busy`, `unanswered`, `unavailable`}; otherwise no control and a Settings → Access pointer |
| E32 | preview-denial-remedy · asking does not loop | state-transition | L1 | automated | opted-out refusal; Ask for access clicked; the eligible re-request refused with no `grant_request` | render | no ask control; Settings → Access pointer shown; no further request on re-render |
| E33 | preview-denial-remedy · outcomes are distinct | EP | L1 | automated | one refusal per `promptOutcome` value | render | 14 distinct `preview.denial.*` message keys; `off` ≠ `not-enforced`; `busy` ≠ `throttled`; `allowed-elsewhere` never uses the `declined` key |
| E34 | preview-denial-remedy · non-denials stay themselves | EP | L1 | automated | (a) 403 `{error:"unknown session path"}` without `denialId`; (b) 404 | preview load | (a) shows the text `unknown session path`, no prompting/grant wording; (b) not-found message, no access wording |
| E35 | preview-denial-remedy · the notice never grants | EP | L1 | automated | every `DenialNotice` variant, fetch spy | click every control | zero requests to `/api/access/grants` |
| E36 | preview-denial-remedy · media probe discipline | state-transition | L1 | automated | `VideoPreview` whose `<video>` fires `error`, fetch spy | (a) first error; (b) remount without a new ask; (c) ask → eligible probe 200 → remount → error again | (a) exactly one request, `Range: bytes=0-0`, grant header `""`; (b) no new probe; (c) exactly one eligible probe, then no probe after the retry; notice shows the one-time-answer message, no ask control |
| E37 | preview-denial-remedy · zero-byte media is not a refusal | BVA | L1 | automated | probe answered `416` | diagnosis | ordinary load-error message; no access wording, no ask control |
| E38 | preview-denial-remedy · PDF always opted out | decision-table | L1 | automated | `PdfPreview` under provider `autoOpened:false` (operator-opened) and with no provider | load | pdf.js `getDocument` receives `httpHeaders` with `X-Pi-Grant-Channel: ""` in both |
| E39 | preview-denial-remedy · image blob ownership | state-transition | L1 | automated | `ImagePreview full` (a) with caller `srcUrl` `blob:x`; (b) without, same-origin base | (a) mount/unmount; (b) mount, path change, unmount | (a) no fetch, `URL.revokeObjectURL` never called with `blob:x`; (b) each created URL revoked exactly once |
| E40 | preview-denial-remedy · cross-origin API base keeps `<img>` | EP | L1 | automated | `getApiBase()` = `http://other:8000` | image load fails | rendered `<img src>` (no fetch); notice variant `unknown`: no reason, no ask control |
| E41 | preview-denial-remedy · inline stays silent | EP | L1 | automated | `ImagePreview` inline variant, 403 on load | render | no notice element (`data-testid` absent) |
| E42 | preview-denial-remedy · foreign lightbox source unchanged | EP | L1 | automated | `ImageLightbox` with (a) `data:` src; (b) remote `https://…` src + `fallbackSrc` | open; (b) primary fails | no fetch in either; (b) `<img>` switches to `fallbackSrc` |
| E43 | preview-denial-remedy · refused preview without disclosure | EP | L1 | automated | body with `denialId` but no `promptOutcome`, request not opted out | render | refusal shown without a reason; no ask control |

### Performance

None (clarification G2: denial-path cost accepted, not gated).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | preview-denial-remedy · click-opened image raises the dialog | state-convergence | L3 | automated | harness: prompting on, `enforce`; PNG in a fresh dir outside the session cwd | operator opens it in the editor pane; answers Allow once | dialog `grant-dialog` shows the canonical dir; after Allow once the tab's `<img>` has `naturalWidth > 0` |
| F2 | preview-denial-remedy · overlay image raises the dialog | state-convergence | L3 | automated | same, fresh dir | operator opens the PNG through a file link that routes to `FilePreviewOverlay` | dialog raised; after Allow once the overlay image renders |
| F3 | preview-denial-remedy · lightbox inside an auto-opened document | state-convergence | L3 | automated | canvas auto-opens a markdown doc embedding a local PNG from a fresh outside dir | operator clicks the image to open the lightbox | dialog raised (the auto-opened tab's opt-out is not inherited) |
| F4 | preview-denial-remedy · canvas auto-open never prompts | state-convergence | L3 | automated | canvas auto-opens a PNG from a fresh outside dir | wait 5 s; then click Ask for access | no `grant-dialog` during the 5 s; notice with Ask for access; after the click, dialog raised |
| F5 | preview-denial-remedy · agent-emitted preview card never prompts | state-convergence | L3 | automated | a `/view` preview card for a PDF and a markdown file in a fresh outside dir rendered in the chat transcript | wait 5 s | no `grant-dialog`; server log shows the denials as `degraded:ineligible` |
| F6 | preview-denial-remedy · re-focus by auto-open does not prompt | state-transition | L3 | automated | operator-opened PNG tab (fresh outside dir) made inactive; prompting on | canvas auto-opens the same path | tab becomes active; no `grant-dialog` within 5 s |
| F7 | preview-denial-remedy · video click-to-ask | state-transition | L3 | automated | MP4 in a fresh outside dir, operator-opened | load; read notice; Ask for access; Allow always | no dialog on load; notice text states a one-time answer admits only a check; dialog after the click; after Allow always `video.readyState >= 1` |
| F8 | preview-denial-remedy · video Allow once is explained | state-transition | L3 | automated | same, new dir | Ask for access; Allow once | video still refused; notice shows the one-time-answer message and no ask control |
| F9 | preview-denial-remedy · PDF click-to-ask | state-transition | L3 | automated | PDF in a fresh outside dir, operator-opened | load; Ask for access; Allow always | no dialog on load; dialog after the click; after Allow always the PDF renders ≥ 1 page |
| F10 | preview-denial-remedy · default config explains itself | EP | L3 | automated | harness default config (prompting off, `report`); PNG outside cwd | operator opens it | notice shows the `off` message (not "Couldn't load image"); no ask control |
| F11 | preview-denial-remedy · busy then ask again | state-transition | L3 | automated | two PNGs in two fresh outside dirs A, B | open A (dialog shown, unanswered); open B | B shows the `busy` notice with Ask again; after answering A, Ask again on B raises B's dialog |
| F12 | preview-denial-remedy · recently answered | state-transition | L3 | automated | PNG in fresh dir D, operator-opened, Allow once | close and reopen the tab within 60 s | notice shows `recently-answered`; no ask control; no dialog |
| F13 | access-grant-registry · agent entry cannot give the operator a second dialog | state-transition | L3 | automated | canvas auto-opens a PNG in fresh dir A (ineligible entry); operator opens a PNG in fresh dir B (dialog B open) | click Ask for access on A | no second `grant-dialog`; A shows the `busy` notice |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | preview-denial-remedy · held image, unanswered | fault-injection (delay) | L3 | automated | operator never answers the dialog | open PNG from a fresh outside dir; wait for the 120 s TTL (test timeout 200 s) | loading state visible throughout the hold; then the `unanswered` notice with Ask again |
| X2 | preview-denial-remedy · socket loss removes the ask | fault-injection (abort) | L3 | automated | dashboard WebSocket dropped via `routeWebSocket` (capability cleared) | auto-opened PNG refusal notice renders | no Ask for access control; Settings → Access pointer shown |
| X3 | path-anchor-grants · grant write failure | fault-injection (abort) | L1 | automated | grant store write throws | held request answered `allow-always` | 403 with `promptOutcome:"grant-failed"`; no grant listed; notice has no ask control |
| X4 | preview-denial-remedy · network failure | fault-injection (abort) | L1 | automated | `fetch` rejects (network error) | image preview load | error variant with the load-failure message; no access wording |
| X5 | path-anchor-grants · no coordinator installed | fault-injection (abort) | L1 | automated | `installGrantCoordinator(null)`; local caller | `/api/file/raw` denied | `promptOutcome:"off"` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | preview-denial-remedy · notice copy | visual/subjective | — | manual-only | every notice variant in light and dark theme | a human reads each | [judgment: wording is clear, fits the pane, does not steer the verdict — no automatable observable] |

---

## Coverage summary

- Requirements covered: 11/11 (preview-denial-remedy 5, access-grant-dialog 1, access-grant-eligibility 1, access-grant-registry 1, path-anchor-grants 2 + the MODIFIED forbidden-list requirement)
- Scenarios by class: edge 43 · perf 0 · frontend 13 · error 5 · manual 1
- Scenarios by level: L1 45 · L3 15 · ci 1
- Scenarios by disposition: automated 61 · manual-only 1

## New infra needed

- none. L3 reuses the docker harness config flip from
  `tests/e2e/access-grant-dialog.spec.ts`; `ci` reuses the `_smoke.yml` Windows
  leg's smoke-script pattern (`scripts/windows-introspection-smoke.ts`).
