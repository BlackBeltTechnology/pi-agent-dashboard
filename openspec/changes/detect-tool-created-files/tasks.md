# Tasks — detect-tool-created-files

## Server — schema

- [x] Add `"tool"` to `FileChangeEvent.type` and `origin`/`producedBy`/`detectedVia`/`previewable` (reserved) to `FileDiffEntry` in `packages/shared/src/diff-types.ts`

## Server — detection + attribution

- [x] Dedicated porcelain parser: C-unquote, resolve rename/copy `R/C old -> new` → new path; resolve each to abs then `normalizePath(abs, cwd)` (shared key space, out-of-cwd filtered). Do NOT reuse `getDirtyFiles` `slice(3)`
- [x] git-status detector: bulk `git status --porcelain` (cwd = session.cwd) → union new/modified/untracked into the list, dedup by normalized path, set `origin`
- [x] Bash-token attributor: scan `toolName==="bash"` events for `>`/`>>`/`-o`/`--output`/`tee`; inside cwd LABEL-ONLY (never adds a file); last-writer-wins; redact secret shapes + length-cap `producedBy`
- [x] Non-git detector: Bash-token scan + `normalizePath`-then-`existsSync` (in-cwd only; never probe out-of-cwd paths)
- [x] Compose precedence in `extractFileChanges`: write/edit → keep real events, mark `mixed` if also detected, NO synthetic event; detector-only → one representative `type:"tool"` event with non-zero timestamp
- [x] Binary/size safety before synthetic diff: NUL-sniff + known-binary ext + size cap → list without text `gitDiff`
- [x] Thread bulk-porcelain untracked set into `enrichWithGitDiff` so per-file `statusPorcelainOr` is not re-spawned; file-count cap on produced list
- [x] Session-ownership gate: classify each git-detected file by evidence (Write/Edit ∨ Bash-token ∨ mtime ∈ Bash exec-window `[start,end]`, fallback `[start,now]`, ±1s slack); owned → `data.files` (`sessionOwned:true`), else → `data.otherChanges[]`
- [x] Add `sessionOwned?` to `FileDiffEntry` and `otherChanges?: FileDiffEntry[]` to the session-diff response type in `packages/shared/src/diff-types.ts`

## Client — Files panel origin badge

- [x] Render `origin` badge in `DiffFileTree.tsx`; `tool`/`mixed` rows show `created by <producedBy>` (tooltip full) or generic `on disk`
- [x] Render `otherChanges` under a muted, collapsed `▸ N other working-tree changes` group; add a "this session only" header toggle that hides the group (default: collapsed-but-present)

## Docs

- [x] Update `packages/server/src/session-diff.ts.AGENTS.md` + `packages/shared/src/*` AGENTS rows
- [x] Note git-status-detector + bash-attributor behavior in `docs/architecture.md` (Session File Diff View) [delegate per caveman rule]

## Tests

L1 exemplar to copy harness glue from: `packages/server/src/__tests__/session-diff.test.ts`.
L3 exemplar: `tests/e2e/change-summary-table.spec.ts` (docker harness port from `.pi-test-harness.json`).

- [x] L1 D1 — tool-created file detected (test-plan #D1). input: no Write/Edit for `out.docx`, untracked in git · trigger: `extractFileChanges`+detector · observable: one entry `out.docx`, `origin:"tool"`. see `session-diff.test.ts`
- [x] L1 D2 — mixed dedup, no ghost event (test-plan #D2). input: Write to `a.ts` + `a.ts` also in porcelain · trigger: extraction · observable: single entry, `origin:"mixed"`, `changes.length===1`, no synthetic `type:"tool"`. see `session-diff.test.ts`
- [x] L1 D3 — quoted+rename keys equal normalizePath keys (test-plan #D3). input: C-quoted `"dir with space/f.txt"` + rename `R old.ts -> new.ts` · trigger: detector parse · observable: keys equal `normalizePath(...)`; dedups with matching Write. see `session-diff.test.ts`
- [x] L1 D3a — absolute-under-cwd yields relative key + dedups (test-plan #D3a). input: absolute `${cwd}/src/foo.ts` + relative `src/foo.ts` from two sources · trigger: normalizePath+dedup · observable: key `src/foo.ts`, one entry. see `session-diff.test.ts`
- [x] L1 D3b — sibling-prefix dir not admitted (test-plan #D3b). input: cwd `/home/user/project`, candidate `/home/user/project-backup/x.ts` · trigger: containment check · observable: excluded (relative gives `../project-backup/x.ts`). see `session-diff.test.ts`
- [x] L1 D4 — out-of-cwd porcelain entry excluded (test-plan #D4). input: porcelain `../sibling/x` · trigger: detector · observable: `x` absent. see `session-diff.test.ts`
- [x] L1 D5 — gitignored excluded (test-plan #D5). input: `build/artifact.js` in `.gitignore` · trigger: detector · observable: entry absent. see `session-diff.test.ts`
- [x] L1 A1 — attribution labels detected file (test-plan #A1). input: Bash `--output logo.png`, detected · trigger: attributor · observable: `producedBy` set (redacted), `detectedVia` set. see `session-diff.test.ts`
- [x] L1 A2 — false-positive token adds/re-tags nothing (test-plan #A2). input: `grep -o pattern src/index.ts` + real Write to it · trigger: attributor · observable: no `pattern` entry; `src/index.ts` events unchanged. see `session-diff.test.ts`
- [x] L1 A3 — secret redaction on producedBy (test-plan #A3). input: `curl -u user:s3cr3tTOKEN … > dump.json` · trigger: attributor · observable: `producedBy` excludes `s3cr3tTOKEN`, length ≤120. see `session-diff.test.ts`
- [x] L1 A4 — collision by timestamp, no throw (test-plan #A4). input: two Bash events (t=1,t=2) same `--output` · trigger: attributor · observable: `producedBy` from t=2; no exception. see `session-diff.test.ts`
- [x] L1 N1 — non-git in-cwd tool file listed (test-plan #N1). input: non-git cwd, `python b.py > notes.md`, exists · trigger: non-git detector · observable: entry `notes.md`, `origin:"tool"`, `detectedVia:"bash-artifact"`. see `session-diff.test.ts`
- [x] L1 N2 — non-git out-of-cwd path not probed (test-plan #N2). input: non-git, `--output /etc/shadow` · trigger: non-git detector · observable: zero `existsSync` calls on out-of-cwd path (spy), entry absent. see `session-diff.test.ts`
- [x] L1 B1 — generated PNG not a text diff (test-plan #B1). input: tool-detected `logo.png` with NUL bytes · trigger: synthetic-diff step · observable: `origin:"tool"`, `gitDiff` absent, no utf-8 read. see `session-diff.test.ts`
- [x] L1 B2 — synthetic-diff size cap 256 KB (test-plan #B2). input: text file 256KB−1 vs 256KB+1 · trigger: synthetic-diff · observable: under→`gitDiff` present, over→absent. see `session-diff.test.ts`
- [x] L1 B3 — file-count cap 200 (test-plan #B3). input: 1 Write/Edit + 200 detector-only · trigger: compose · observable: `data.files.length===200`, Write/Edit entry retained. see `session-diff.test.ts`
- [x] L1 G1 — git absent, endpoint returns (test-plan #G1). input: git unavailable (porcelain→"") · trigger: `/api/session-diff` · observable: `success:true`, Write/Edit entries, `isGitRepo:false`, no throw. see `session-diff.test.ts`
- [x] L1 O1 — mtime-in-window file owned (test-plan #O1). input: Bash window [t1,t2], file mtime∈[t1,t2], path not in command · trigger: ownership gate · observable: entry in `data.files`, `sessionOwned:true`. see `session-diff.test.ts`
- [x] L1 O2 — other-session file diverted (test-plan #O2). input: dirty file, no Write/Edit, no token, mtime in no window · trigger: gate · observable: absent from `data.files`, present in `data.otherChanges`. see `session-diff.test.ts`
- [x] L1 O3 — formatter-bump not claimed (test-plan #O3). input: dirty file mtime after session start but inside NO Bash window · trigger: gate · observable: not `sessionOwned`, in `otherChanges`. see `session-diff.test.ts`
- [x] L3 U3 — other-changes group collapsed + toggle (test-plan #U3). input: diff response with non-empty `otherChanges` · trigger: open Files panel, click "this session only" · observable: group renders collapsed by default; toggle hides it. see `tests/e2e/change-summary-table.spec.ts`
- [x] L3 U1 — Files panel badges a tool row (test-plan #U1). input: diff response with `tool`-origin entry + `producedBy` · trigger: open Files panel (docker harness) · observable: origin badge + `created by <command>` label (converged state). see `tests/e2e/change-summary-table.spec.ts`

## Validate (manual, post-merge)

- [x] U2 — badge legibility / visual weight across studio/earth/athlete/gradient themes (test-plan: manual-only)
