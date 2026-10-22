# Test Plan — core-file-cwd-admission

Stage: design   Generated: 2026-10-22

Hard gate: no unfillable slot remained after the operator decisions folded into design (D1–D8); no clarification asked.

Fixture notation:
- **K-session**: temp git repo that is a session cwd. **P**: temp non-git dir that is pinned (no session). **K-pinned**: temp git repo that is pinned. **WS**: temp dir that is only a workspace folder.
- **W**: sessionless linked worktree of K-pinned. **U**: existing temp dir that is not known. **L → R**: pinned symlink `L` to real non-git dir `R`.
- Route tests: Fastify `inject`, `routeAdmission.knownCwds` seeded with the fixture set; `admitOptions.runner` injected where a git spawn must be counted or failed.
- "fs spy 0" = no `fs` call on a path under the request cwd outside `admitCwd`; "op spy 0" = the route's lib/operation function is not called.
- Indeterminate is forced with an injected runner that fails every probe, or an injected realpath returning EACCES for one known entry.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | core: File-family routes admit the caller cwd | decision table (route × direct-match pinned) | L1 | automated | P with `a.txt`, `img.png`, `doc.docx`, `mail.eml`, `notes.md`; no session | `GET /api/file`, `/api/file/digest`, `/tree`, `/exists`, `/raw`, `/render`, office/sheet, `/api/file/eml`, `/md-candidates`, `/md-read`, `POST /api/file/write`, `/resolve-mention`, `/api/grep` with `cwd=P` | each answers its success status (200; write 200 with new mtime); admission runner spy: 0 git spawns |
| E2 | core: sessionless worktree of a pinned repository is previewable | EP (derived-admit partition) | L1 | automated | W containing `shot.png` and `src/x.ts` | `GET /api/file/raw?cwd=W&path=shot.png`; `GET /api/file/tree?cwd=W&path=src` | 200 image bytes with image `Content-Type`; tree lists `x.ts` |
| E3 | core MODIFIED: workspace folders join the known set (D8) | EP (workspace partition) × decision table (route family) | L1 | automated | WS (not pinned, no session) | `GET /api/file?cwd=WS`, `GET /api/packages/installed?cwd=WS`, `GET /api/canvas-types?cwd=WS`, `POST /api/resources/toggle {scope:"local",cwd:WS}`, addons folder catalog for WS, `GET /api/git/status?cwd=WS` (git repo variant) | none answers 403 `cwd_unknown`; admission runner spy: 0 git spawns |
| E4 | core: Unknown cwd keeps the existing refusal + code | decision table (route × U) | L1 | automated | U with `secret.txt` | every route of E1 plus `/api/open-in-system`, `/api/reveal-in-file-manager`, editor-pane save, `start-static` with `cwd=U` | each keeps its pre-change status and `error` (`"unknown session path"`; exists `"unknown cwd"` + reason/hint) and adds `code:"cwd_unknown"`; fs spy 0; no file under U written; opener spawn spy 0 |
| E5 | core: tightening on file routes | EP (refuse partitions) | L1 | automated | (a) only W1 is a session, ask W2; (b) only W1 is a session, ask main checkout M; (c) pinned non-repo P, ask git repo `P/r` | `GET /api/file?cwd=<case>&path=a.txt` | each 403 `{error:"unknown session path", code:"cwd_unknown"}` |
| E6 | core: non-absolute / non-string cwd refused before admission | EP (invalid shapes) | L1 | automated | cwd ∈ {`.`, `src`, `["/tmp"]`, `{}`, `42`} | `GET /api/file/tree`; `POST /api/file/write` (body cwd); `POST /api/packages/install {scope:"local"}`; `PATCH /api/canvas-types {scope:"project"}` | each answers its refusal with `code:"cwd_unknown"`; admission spy 0 calls; md write writes nothing under `~/.pi/agent` (never falls to global scope); package wrapper `run` spy 0 |
| E7 | core: absent cwd keeps its fallback; no-cwd branch passes a constant | EP (absent partition) | L1 | automated | no `cwd` / `cwd=""` | `GET /api/file/md-candidates`; `GET /api/canvas-types?cwd=`; `GET /api/packages/installed` | global candidates returned and `enumerateMdCandidates` called with `{}`; canvas returns global + empty project and `readCanvasTypesScopes` called with `""`; wrapper `listInstalled` called with `cwd === undefined`; admission spy 0 calls |
| E8 | core: containment still applies after admission | EP | L1 | automated | P | `GET /api/file?cwd=P&path=../../etc/passwd` | 403 `"path outside working directory"`; no read of `/etc/passwd` |
| E9 | file-read-containment MODIFIED: symlinked cwd accepts both spellings | decision table (spelling × site) | L1 | automated | L → R (non-git) with `R/a.txt`; outside file `R/../outside.txt` | `GET /api/file`, `/raw`, `/tree`, `/exists`, `/api/grep`, `/resolve-mention`, `POST /api/file/write` with `cwd=L` and path ∈ {`a.txt`, `L/a.txt` abs, `R/a.txt` abs, `../outside.txt`} | the first three spellings allowed at every site (write succeeds, mention resolves); `../outside.txt` refused 403 `"path outside working directory"` (mention: null, grep: excluded) |
| E10 | tool-output-linkification MODIFIED: resolve ⊆ open with canonical anchor | EP | L1 | automated | L → R with `R/b.ts` | `POST /api/file/resolve-mention {cwd:L, mention:"R/b.ts" (abs)}` then `GET /api/file?cwd=L&path=<resolved>` | mention resolves to `R/b.ts`; the follow-up read is 200 |
| E11 | core: file-exists prompt follows admission | state-transition (refuse → verdict) | L1 | automated | (a) `cwd=.`; (b) W; (c) U + allow-once; (d) worktree W2 of unknown repo + allow-always (pins W2); (e) U + deny | `GET /api/file/exists?cwd=<case>&path=<abs inside>` with injected hold verdict | (a) 403 `"unknown cwd"` + `code`, hold spy 0; (b) 200, hold spy 0; (c) 200 then a second request raises the hold again; (d) 200 via `rerunAlways`; (e) 403 `"unknown cwd"` + `code` |
| E12 | core: package routes admit a supplied cwd | decision table (route × cwd state) | L1 | automated | (a) install local `cwd=U`; (b) move `fromCwd=K-pinned`, `toCwd=U`; (c) move local with `toCwd` missing; (d) move local `toCwd=["x"]`; (e) reset-to-npm local `cwd=U`; (f) check-updates `cwd=U`; (g) move `fromCwd=U` (refused) + `toCwd` indeterminate | the route | (a,b,e,f) 403 `{code:"cwd_unknown", error:"cwd not allowed", reason, hint}`, wrapper spies 0; (c,d) 400 `invalid_request`, admission spy 0; (g) 403 (refusal wins over 503) |
| E13 | core: canvas-types routes admit a supplied cwd | decision table | L1 | automated | (a) PATCH project `cwd=U`; (b) PATCH invalid body + `cwd=U`; (c) GET `cwd=U`; (d) PATCH project `cwd=P` | the route | (a,c) 403 `cwd_unknown`, no read/write of `U/.pi/settings.json`; (b) 400 from `validatePatch`, admission spy 0; (d) 200 and `P/.pi/settings.json` written |
| E14 | core: resource-toggle admits a supplied cwd | decision table | L1 | automated | (a) toggle local `cwd=U`; (b) toggle global with `cwd=U`; (c) toggle local `cwd=P` needing trust | `POST /api/resources/toggle` | (a,b) 403 `cwd_unknown`, no settings write, `hasTrustChallenge(U)` false; (c) 403 `trustRequired:true` and the challenge registered for P |
| E15 | openspec-change-grouping MODIFIED | decision table | L1 | automated | (a) W; (b) U; (c) pinned `HOME/.config` (its `openspec/` = global dir); (d) pinned symlink → `HOME/.config`; (e) no cwd | `GET /api/openspec/groups?cwd=<case>`; `POST /api/openspec/groups` for (c) | (a) 200 groups of W; (b,c,d) 403 `{error:"cwd not allowed", code:"cwd_unknown"}`, no file under the global openspec dir; (e) 400 `"Missing cwd"` |
| E16 | core: file watching admits the caller cwd | EP | L1 | automated | (a) P with open file `a.txt`; (b) U | `watch_files {sessionId, cwd, paths:["a.txt"]}` through the browser-gateway handler | (a) `activeWatchCount()` = 1; (b) 0 watchers and no message sent on the socket |
| E17 | core MODIFIED: known set includes workspace folders; gated writes unchanged | EP | L1 | automated | sessions {A}, pins {B}, workspaces {[B, C]} | `listKnownFolderCwds(...)`; `POST /api/openspec/init {cwd:C}` | returns `[A, B, C]` exactly once each; init answers the existing 400 refusal for C |
| E18 | addons-folder-view MODIFIED: workspace-only folder catalog | EP | L1 | automated | WS with `.pi/` | addons folder catalog request for WS | 200 with per-feature folder state (not 403) |
| E19 | editor-pane-file-handlers MODIFIED | decision table | L1 | automated | (a) P with `deck.pptx`, enabled edit claim; (b) U | handler save (overwrite) | (a) 200, file bytes replaced; (b) 403 `{error:"unknown session path", code:"cwd_unknown"}`, file unchanged |
| E20 | core MODIFIED: admission released after the request | invariant | L1 | automated | token-capture seam; P and U | each file gate helper (admitted + refused), an inline route, a package route, `watch_files` | every captured token `isAdmissionLive` = false after the call returns |
| E21 | core: open-in-system in a pinned folder | EP | L1 | automated | P with `a.pdf`; `systemOpenCapable` true; loopback origin | `POST /api/open-in-system {cwd:P, path:"a.pdf"}` | 200 `{spawned:true}`; opener spawn spy called once with `P/a.pdf` |
| E22 | proposal Goal / D7: CodeQL closure evidence | before/after diff | ci | automated | `codeql-baseline.json` + local real analysis before and after; PR CodeQL analysis | `npm run codeql`; PR analysis | no new results; `evidence/codeql.md` per-file table; residue list (incl. `lib/eml.ts`) handed to `codeql-file-containment-barrier`; dismissal #463 text refreshed |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D6 gate: direct-match hot path | tail-latency | L1 | automated | `GET /api/file` on a direct-match cwd, known = max(100, live `listKnownFolderCwds()`) vs 1, warm-up 20, `PI_BENCH=1` | Δp50 ≤ +2 ms and Δp99 ≤ +15 ms | 200 sequential requests |
| P2 | design D6 gate: derivation path health | threshold | L1 | automated | `GET /api/file` on W | 0 `indeterminate` (503) | 200 sequential requests |
| P3 | live-server-preview MODIFIED: direct-match re-check bound | tail-latency | L1 | automated | static target on P serving a 20 KB stylesheet | per-request re-check p95 ≤ 10 ms | 200 requests |
| P4 | design D6 gate: no starvation of other admissions | contention + threshold | L1 | automated | 50-asset static preview on W fetched sequentially per asset while 20 concurrent `GET /api/git/status`, each on a distinct sessionless worktree of a different pinned repo | 0 `indeterminate`; p99 ≤ 3000 ms | one preview load |
| P5 | design D6 recorded | measurement | L1 | automated | (a) per-asset re-check on W; (b) 16 concurrent `GET /api/file/raw` on a direct-match cwd | (a) p50/p95 recorded in `evidence/latency.md`; (b) p99 recorded; first serve on W ≤ 3000 ms | 200 requests each |
| P6 | design D6 always-on | invariant | L1 | automated | `GET /api/file` on K-session with an injected counting runner (CI, no `PI_BENCH`) | 0 git spawns | 1 request |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | design D3: preview error text | EP | L1 | automated | `rawError="cwd-admission-unavailable"` | `friendlyReadError(rawError, path, cwd)` | returns the `err.cwd_admission_unavailable` text, not the identifier; `"unknown session path"` mapping unchanged |
| F2 | core: pinned folder without a session is readable (rendered) | state convergence | L3 | automated | docker harness; a pinned temp dir with `readme.md` and `pic.png`, no session in it | open the folder pane and open both files | markdown preview renders the heading text; image element loads (`naturalWidth > 0`); no "unknown session path" / "no longer available" text in the pane |
| F3 | design D1: `watch_files` late admission | state-transition (race) | L1 | automated | P; admission runner delayed 200 ms | (a) send `watch_files` then disconnect before admission resolves; (b) send paths `[a]` (slow admission) then `[b]` (fast) for the same `(ws, sessionId)` | (a) `activeWatchCount()` = 0 after resolution; (b) final watched set = `{b}` |
| F4 | internal-monaco: digest refused/fails → banner | EP | L1 | automated | open tab with baseline digest; digest endpoint answers 503 `cwd-admission-unavailable` | a `file_changed` candidate | the changed-on-disk banner is shown for that tab (fail-safe, spec `:327`) |
| F5 | core: System open in a pinned folder (real desktop) | manual | — | manual-only | macOS desktop dashboard; pinned folder with a PDF, no session | click *Open in system app* in the folder pane | [judgment: the PDF opens in the default macOS app — needs a real display session] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | core MODIFIED: indeterminate → shared 503 | fault-injection (abort) × decision table | L1 | automated | injected runner fails every git probe; cwd = U (existing, non-matching) | `GET /api/file`, `/api/file/tree`, `GET /api/grep`, `POST /api/file/write`, `POST /api/open-in-system`, `start-static`, editor-pane save, `POST /api/packages/install`, `PATCH /api/canvas-types`, `POST /api/resources/toggle`, `GET /api/openspec/groups` | each 503, header `Retry-After: 1`, body `{success:false, code:"cwd-admission-unavailable", error:"cwd-admission-unavailable", message, retryAfterMs:1000}`; op/fs spies 0 |
| X2 | core MODIFIED: unreadable known entry | fault-injection (EACCES) | L1 | automated | injected realpath EACCES for one pinned entry | `GET /api/file?cwd=U` and `GET /api/file?cwd=P` | U → 503 `cwd-admission-unavailable`; P → 200 |
| X3 | core MODIFIED: per-asset re-check indeterminate | fault-injection (abort) | L1 | automated | static target on W; runner fails after start | next asset request through the proxy | asset refused via the proxy's existing refusal; denial-record spy 0; hold spy 0 |
| X4 | core: live-preview re-check after unpin | state-transition | L1 | automated | static target started on P | unpin P (no session), request the next asset | asset refused; a previously served asset fetched again is refused too |
| X5 | core: watch for undecidable cwd ignored | fault-injection (abort) | L1 | automated | runner fails; cwd = U | `watch_files` | 0 watchers; no message sent |
| X6 | core: exists undecidable never prompts | fault-injection (abort) | L1 | automated | (a) runner fails, cwd = U; (b) allow-always verdict whose `rerunAlways` is indeterminate | `GET /api/file/exists` | (a) 503 shared body, hold spy 0; (b) 503 shared body |
| X7 | core: regular file cwd refused, not 503 | EP | L1 | automated | cwd = `K-pinned/file.txt` (regular file) | `GET /api/file?cwd=<file>&path=x` | 403 `code:"cwd_unknown"`, status ≠ 503 |

---

## Coverage summary

- Requirements covered: 23/23 delta requirements (core-cwd-admission ADDED ×6 + MODIFIED ×4; agent-artifact-serving, file-and-url-preview ×2, open-in-editor, editor-pane-file-handlers, editor-file-search, internal-monaco-editor-pane ×3, tool-output-linkification, file-read-containment ×2, live-server-preview, openspec-change-grouping, kb-plugin-cwd-guard, kb-folder-slot ×2, folder-project-identity, plugin-cwd-admission, addons-folder-view) — kb/folder-project/plugin known-set wording is covered through E3/E17 (shared provider).
- Scenarios by class: edge 22 · perf 6 · frontend 5 · error 7
- Scenarios by level: L1 37 · L3 1 · ci 1 · — 1
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- A token-capture seam for E20 (route-admission `admitOptions` already exposes test seams; extend if token capture is missing).
- No new harness; L3 uses the existing docker e2e harness.
