# Test Plan — detect-tool-created-files

Adversarial scenario catalog. Manifest columns: `id`, `class`, `technique`,
`level`, `disposition`, Triple (input · trigger · observable). Levels:
L1 = vitest unit (`packages/*/src/**/__tests__/*.test.ts`), L3 = Playwright e2e
(`tests/e2e/*.spec.ts`, docker harness port from `.pi-test-harness.json`).

No open clarifications — the two numeric gaps (256 KB synthetic-diff cap,
200-entry file cap) were resolved at the design gate.

## Detection (git repo)

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D1 | edge-case | EP | L1 | automated |

**D1 — tool-created file detected.** *input:* session events with no Write/Edit for `out.docx`, git worktree where `out.docx` is untracked · *trigger:* `extractFileChanges` + git-status detector run · *observable:* `data.files` has one entry `path: "out.docx"`, `origin: "tool"`.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D2 | edge-case | state/dedup | L1 | automated |

**D2 — mixed dedup, no ghost event.** *input:* one Write event to `a.ts` + `a.ts` also untracked/modified in porcelain · *trigger:* extraction · *observable:* exactly one entry for `a.ts`; `origin: "mixed"`; `changes.length === 1` (the Write only); no injected `type:"tool"` event.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D3 | edge-case | BVA / parsing | L1 | automated |

**D3 — quoted + rename porcelain keys equal normalizePath keys.** *input:* porcelain emits a C-quoted `"dir with space/f.txt"` and a rename line `R  old.ts -> new.ts` · *trigger:* detector parse · *observable:* keys equal `normalizePath("dir with space/f.txt", cwd)` and `normalizePath("new.ts", cwd)` respectively; a Write event to the same paths dedups to a single entry each.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D3a | edge-case | EP | L1 | automated |

**D3a — absolute-under-cwd yields relative key + dedups.** *input:* an absolute path `${cwd}/src/foo.ts` from one source and a relative `src/foo.ts` from another (e.g. porcelain vs a Write event) · *trigger:* `normalizePath` + dedup · *observable:* key is `src/foo.ts` (never absolute); exactly one entry (the two sources merge).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D3b | error-handling | BVA | L1 | automated |

**D3b — sibling-prefix directory not admitted.** *input:* cwd `/home/user/project`, candidate `/home/user/project-backup/x.ts` · *trigger:* containment check · *observable:* `path.relative` gives `../project-backup/x.ts`; file excluded (guards against a `startsWith(cwd)` false positive).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D4 | edge-case | EP | L1 | automated |

**D4 — out-of-cwd porcelain entry excluded.** *input:* porcelain entry resolving to `../sibling/x` (outside cwd) · *trigger:* detector · *observable:* `x` absent from `data.files` (v1 out-of-cwd out of scope).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| D5 | edge-case | EP | L1 | automated |

**D5 — gitignored excluded.** *input:* `build/artifact.js` matched by `.gitignore` · *trigger:* detector (porcelain default) · *observable:* entry absent.

## Attribution

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| A1 | edge-case | EP | L1 | automated |

**A1 — attribution labels a detected file.** *input:* Bash event `npx nano-banana "logo" --output logo.png`, `logo.png` detected by git-status · *trigger:* attributor · *observable:* `logo.png` entry `producedBy` contains the (redacted) command, `detectedVia` set.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| A2 | error-handling | decision-table | L1 | automated |

**A2 — false-positive token adds/re-tags nothing.** *input:* Bash `grep -o pattern src/index.ts` + a real Write to `src/index.ts` · *trigger:* attributor · *observable:* no entry for `pattern`; `src/index.ts` change events unchanged (still the real Write), at most a file-level label.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| A3 | error-handling | EP | L1 | automated |

**A3 — secret redaction on producedBy.** *input:* Bash `curl -u user:s3cr3tTOKEN https://x > dump.json`, `dump.json` detected · *trigger:* attributor · *observable:* `producedBy` present, does NOT contain `s3cr3tTOKEN` (redacted), length ≤ 120.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| A4 | edge-case | state | L1 | automated |

**A4 — collision resolves by timestamp, no throw.** *input:* two Bash events (t=1, t=2) both `--output same.png`, file detected · *trigger:* attributor · *observable:* `producedBy` derives from the t=2 command; extraction returns (no exception).

## Non-git detection

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| N1 | edge-case | EP | L1 | automated |

**N1 — non-git in-cwd tool file listed.** *input:* cwd not a git repo; Bash `python b.py > notes.md`; `notes.md` exists in cwd · *trigger:* non-git detector (token scan + existsSync) · *observable:* entry `notes.md`, `origin: "tool"`, `detectedVia: "bash-artifact"`.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| N2 | error-handling | EP (security) | L1 | automated |

**N2 — non-git out-of-cwd path not probed.** *input:* cwd not a git repo; Bash `… --output /etc/shadow` · *trigger:* non-git detector · *observable:* no `existsSync` call for `/etc/shadow` (spy asserts zero calls on out-of-cwd path); entry absent. (Probe-oracle defense.)

## Binary / size / count safety

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| B1 | edge-case | EP | L1 | automated |

**B1 — generated PNG not rendered as text diff.** *input:* tool-detected `logo.png` with NUL bytes · *trigger:* synthetic-diff step · *observable:* entry has `origin:"tool"`, `gitDiff` absent; no utf-8 read of the file (readFileSync spy not called on it, or called with non-utf8 guard).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| B2 | edge-case | BVA | L1 | automated |

**B2 — synthetic-diff size cap (256 KB).** *input:* tool-detected text file of 256 KB − 1 (just under) vs 256 KB + 1 (just over) · *trigger:* synthetic-diff step · *observable:* under → `gitDiff` present; over → `gitDiff` absent.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| B3 | performance | BVA | L1 | automated |

**B3 — file-count cap (200).** *input:* detection yielding 201 candidate files (1 Write/Edit + 200 detector-only) · *trigger:* compose · *observable:* `data.files.length === 200`; the Write/Edit entry is retained (present in the 200).

## Session-ownership gating

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| O1 | edge-case | EP | L1 | automated |

**O1 — mtime-in-window file is owned.** *input:* Bash exec-window `[t1,t2]`; a dirty file whose mtime ∈ `[t1,t2]` but whose path is NOT in the command string · *trigger:* ownership gate · *observable:* entry in `data.files`, `sessionOwned: true` (unnamed converter output claimed via mtime).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| O2 | edge-case | decision-table | L1 | automated |

**O2 — other-session file diverted.** *input:* dirty file with no Write/Edit event, no Bash-token match, mtime inside no Bash window · *trigger:* gate · *observable:* absent from `data.files`; present in `data.otherChanges[]`.

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| O3 | error-handling | BVA | L1 | automated |

**O3 — formatter-bump not falsely claimed.** *input:* dirty file whose mtime is after session start but inside NO Bash execution window · *trigger:* gate · *observable:* not `sessionOwned`; routed to `data.otherChanges[]` (evidence ③ requires a real window, not "after start").

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| U3 | frontend-quirk | state | L3 | automated |

**U3 — other-changes group collapsed + toggle.** *input:* diff response with non-empty `otherChanges` · *trigger:* open Files panel (docker harness), click "this session only" · *observable:* `▸ N other working-tree changes` renders collapsed by default; toggle hides the group entirely (converged state).

## Degradation

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| G1 | error-handling | fault-injection | L1 | automated |

**G1 — git absent, endpoint still returns.** *input:* git binary unavailable / not a repo (statusPorcelainOr → "") · *trigger:* `/api/session-diff` · *observable:* `success: true`, Write/Edit entries returned, `isGitRepo: false`, no throw.

## UI

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| U1 | frontend-quirk | state | L3 | automated |

**U1 — Files panel badges a tool row.** *input:* a session whose diff response has a `tool`-origin entry with `producedBy` · *trigger:* open Files panel in the dashboard (docker harness) · *observable:* the row shows a tool/origin badge and the `created by <command>` label (converged state, not timed visibility).

| id | class | technique | level | disposition |
|----|-------|-----------|-------|-------------|
| U2 | frontend-quirk | judgment | — | manual-only |

**U2 — badge legibility / visual weight across themes.** *input:* tool badge rendered in studio/earth/athlete/gradient themes · *trigger:* human review · *observable:* badge readable, not visually dominating the row. (Subjective — no automatable signal.)
