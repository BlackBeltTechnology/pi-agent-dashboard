## Context

Editor pane already supports absolute out-of-cwd tab paths (`normalize-path.ts:27-38` keeps them verbatim; `isUnderSessionCwd`, `DocumentBar` `outsideCwd`). Reads go through `/api/file` with `path.resolve(cwd, abs)` + containment/grants. Writes (`isWritableMdTarget`, `writable-md-target.ts` `allowedRoot` = realpath of cwd) and file watching (`file-watch-manager.ts:246`, `if (!withinCwd(abs, cwd)) continue`) are cwd-only today. So #1137/#1157 are a routing + resolve-result problem plus one write-gate extension (D2), not a pane rewrite.

## D1 — Resolve result for paths failing containment (confirmed (owner, 2026-11-20))

| Option | Effect |
|---|---|
| A. Keep `null` | `~/Downloads/x.md` stays "not found"; grant prompt unreachable from links. Rejects #1157. |
| B. Stat outside paths and return resolved | Existence oracle for any path; contradicts D2/D12 of the original resolver. Rejected. |
| **C. Return `{resolved, kind, outside:true}` without stat** | No existence leak; link opens the pane; the read gate decides (grant prompt on operator click, 403, or 404 notice). |

Chosen: **C** (confirmed (owner, 2026-11-20)). Disclosure delta: the response echoes the normalized candidate (incl. expanded home dir) to an already network-guarded, cwd-admitted caller. The `outside` flag is true iff containment failed; never depends on existence.

## D2 — Out-of-cwd tabs are editable; writes ride the path grant gate (confirmed (owner, 2026-11-20); CHANGED from read-only)

Today `POST /api/file/write` → `prepareMdWrite` (`file-routes.ts:236-248`) → `isWritableMdTarget(resolved, {cwd})` (`writable-md-target.ts:96-115`): realpath-normalized, extension allowlist, dashboardState refusal, then `within(real, root)` with `root` = realpath of cwd → an outside path is a flat `403`. The only grant/prompt machinery is on reads (`gateReadPath`, `file-routes.ts:423-461` → `evaluateContainment` with `hold`; `containment-gate.ts` doc: a grant is a READ remedy).

| Option | Effect |
|---|---|
| A. Read-only outside tabs, hide Edit | Previous draft. Rejected by owner. |
| B. New preference gate | More UI; rejected by owner ("no new preference"). |
| **C. Extend the write route with the same `evaluateContainment` grant gate** | Edit stays available; an un-granted write raises the grant prompt; denied → save error. |

Chosen: **C**. In `prepareMdWrite`/`/api/file/write` (directory scope only; global scope, i.e. no `cwd`, stays `~/.pi/agent`-only, no grant — a grant binds to a session):

1. `resolveScopedMdPath` + `isWritableMdTarget` as today. Pass → write (unchanged path, no prompt).
2. On a fail where the target's realpath passes the extension allowlist and `dashboardStateRefuses` is false (split the extension/state half out of `isWritableMdTarget` into an exported helper; `.mmd/.mermaid` remain directory-only so they never reach the gate) but is outside the cwd: call `evaluateContainment(realpath, [admitted.cwd], {site:"file-routes:write", subjectKind:"file", session: admitted.cwd, hold:{request, reply}, disclosure})`. Anchors = the cwd alone, i.e. exactly the scope that just refused, so the git-root/`~/.pi` widening of `cwdAnchors`/`homePiAnchor` does NOT admit writes; only an explicit grant does. `prepareMdWrite` therefore takes the live `request`/`reply`.
3. `containmentAllows(decision, realpath)` → proceed to `serializeWrite`/`performAtomicMdWrite`. Denied / expired / prompt-ineligible (bare loopback without proof) → `403 {error:"path outside working directory — write not granted", ...remedy}` via `sendGateFailure`; nothing is written.
4. Re-bind: `performAtomicMdWrite` already re-`realpath`s the target; assert it equals the gated realpath, else refuse (`409`/`403`, no write) so a symlink swapped during the hold cannot redirect the write. (Reads close the same window with a handle-verified open — `access/verified-read.ts`; the write keeps its existing realpath+`wx` tmp+rename shape.)

Client: no Edit-hiding. `MarkdownViewer.tsx:100-109` / `EditablePreviewTab.tsx:90-101` already `setError(body.error)` on a non-200/409 and leave `buffer` untouched, so a denied save keeps the dirty buffer; the guard dialog's Save treats a `403` like a failed save (stays open, buffer kept). The request pends while the operator is prompted (same as a held read), so the Save button shows its saving state.

No live watch: `file-watch-manager.ts:246` never watches outside the cwd, so an out-of-cwd tab gets no push `file_changed`; the save-time `mtime` 409 (`performAtomicMdWrite`) still detects a concurrent change. Accepted and documented; extending the watcher is a non-goal.

**Risk (flag for `doubt-driven-review`)**: a grant is a subtree grant created from a prompt/Access page that today describes read access; with C any existing or future grant also admits allowlisted text-doc writes (`.md/.mdx/.adoc/.asciidoc/.csv`) under that subtree, and the prompt is the existing read prompt. Mitigations kept: grants stay subtree-bounded, extension allowlist, dashboard-state + forbidden-subject refusals, `mtime` optimistic check, atomic write, per-session binding. Owner decision: no separate write grant mode.

## D3 — Unsaved guard shape (confirmed (owner, 2026-11-20))

| Option | Effect |
|---|---|
| **A. Dirty registry + confirm at owned leave points** | Small; mirrors handler `guardDiscard`/`close-risk`. |
| B. Keep-alive buffers (lift state to a store, like handler instances) | No loss and no prompts on tab switch / pane close; larger, memory + eviction rules. |

Chosen: **A** (confirmed (owner, 2026-11-20)). Registry lives in `SplitWorkspaceContext` (app-level, survives pane unmount): `registerUnsaved(key, {dirty, save})`; `confirmLeave(keys?) → Promise<boolean>` shows Save/Discard/Cancel. Viewers publish on `dirty` change. Call sites: `closeTabAt`, `runBulkClose` (extend `CloseRiskLookups` with built-in dirty → listed once), pane close button, `LayoutModeSwitch` chat segment, `handleSelect`. `beforeunload` armed while any entry is dirty. Tab *switch* also unmounts the buffer today; left out (non-goal), flagged in DECISIONS.
