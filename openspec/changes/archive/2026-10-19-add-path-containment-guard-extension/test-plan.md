# Test Plan — add-path-containment-guard-extension

Stage: design   Generated: 2026-10-19

The HARD gate was resolved: the guard latency budget is p95 < 1 ms for an allowed in-root decision (operator, 2026-10-19). There are no open clarifications.

Requirement refs:
- **G1–G9** = `specs/path-containment-guard/spec.md`:
  - G1 opt-in/config;
  - G2 fail-closed config;
  - G3 denied tools;
  - G4 confinement;
  - G5 cheap decisions;
  - G6 reject/fail-closed;
  - G7 other tools;
  - G8 independence;
  - G9 helper.
- **A1** = `specs/agent-path-confinement/spec.md` (MODIFIED: dangling-link canonicalisation).
- **S1** = `specs/plugin-spawn-scope/spec.md` (MODIFIED: namespace ownership).
- **D1** = design D1, the extraction invariant.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | G1 | EP | L1 | automated | `ALLOWED_ROOTS='["/w/repo","rel/dir","",7]'`, cwd `/w` | `decideGuard("read", {path:"/w/repo/a.ts"})`; then `{path:"rel/dir/x"}` | first `{allow:true}`; second rejected `path_outside_roots` (relative root never admits) |
| E2 | G1 | EP (platform) | L1 | automated | win32 flavour, `ALLOWED_ROOTS='["\\\\w\\\\repo"]'` | `read` of `C:\w\repo\a.ts` | rejected `config_invalid` (driveless root ignored, so no valid root) |
| E3 | G1 | EP | L1 | automated | temp tree: `loop`→`loop2`→`loop` symlink loop + real dir `repo`; `ALLOWED_ROOTS=[loop, repo]` | `parseGuardConfig` then `read repo/a.ts` | parse does not throw; `roots` = [canonical repo]; read allowed |
| E4 | G2 | decision table | L1 | automated | `ALLOWED_ROOTS` ∈ {absent, `not json`, `{}`, `[]`, `["rel"]`}; denied absent | `read /w/repo/a.ts`, and `bash` | every read rejected `config_invalid`; `bash` allowed (not a path tool) |
| E5 | G2 | decision table | L1 | automated | `DENIED_TOOLS` ∈ {absent, `[]`, `bash,write`, `{"a":1}`, `["bash",7]`, `["bash",""]`}; valid roots | `read` in-root, and `bash` | absent/`[]` → both allowed; the other four → both rejected `config_invalid` |
| E6 | G3 | decision table | L1 | automated | roots `["/w/repo"]`, denied `["write"]` | `write /w/repo/a.txt` | rejected `tool_denied` (the denied check precedes the in-root path check) |
| E7 | G3 | EP | L1 | automated | denied `["Bash"]` | `bash` | not rejected (exact, case-sensitive match) |
| E8 | G4 | BVA | L1 | automated | root `/w/repo` (real temp dirs) | `read` of `/w/repo`, `/w/repo/a`, `/w/repo-old/a`, `/w`, `/w/repo2` | first two allowed; last three rejected `path_outside_roots` |
| E9 | G4 | EP (pi parity) | L1 | automated | root = temp repo, cwd = repo | `read` of `~/.ssh/id_rsa`, `@/etc/hosts`, `file:///etc/hosts`, `@<repo>/a` | first three rejected `path_outside_roots`; `@<repo>/a` allowed |
| E10 | G4 | EP | L1 | automated | root + cwd `/w/repo` | `read ../other/x.txt` | rejected `path_outside_roots`, canonical `/w/other/x.txt` |
| E11 | G4 | state (fs) | L1 | automated | `repo/link`→`other/` symlink; plus a root given as a symlink `rootlink`→`repo` | `edit repo/link/f.txt`; `read repo/a` with root `rootlink` | edit rejected; read via symlinked root allowed |
| E12 | G4 | state (fs) | L1 | automated | three dangling links in root: `link`→`../other/new.txt`, `s`→`other/deep` with `deep/link`→`../new.txt`, `abs`→`<abs>/other/new2.txt` | `write` each | all three rejected `path_outside_roots`; canonicals `other/new.txt`, `other/new.txt`, `other/new2.txt` |
| E13 | G4 | BVA | L1 | automated | root repo; `repo/new/deep` absent | `write repo/new/deep/a.txt` | allowed |
| E14 | G4 | decision table | L1 | automated | root `/w/repo/sub`, cwd `/w/repo`; tool ∈ {grep, find, ls} × path ∈ {absent, `""`, `null`, `sub/x`} | `decideGuard` | absent/`""`/`null` → rejected `path_outside_roots` (cwd); `sub/x` → allowed |
| E15 | G4 | EP (read variant) | L1 | automated | root repo; literal `it's.txt` absent; curly variant `it’s.txt` is a symlink to an outside file | `read repo/it's.txt` | rejected `path_outside_roots` (decided on the variant pi opens) |
| E16 | G4 | decision table | L1 | automated | root `/w/Repo`, target `/w/repo/a.ts`; injected probe ∈ {false, true} | `read` | probe false → rejected; probe true → allowed |
| E17 | G6 | decision table | L1 | automated | tool ∈ {read, write, edit} × path ∈ {absent, `""`, `null`, `7`}; plus `grep {path:7}`; plus `read {path:"a\0b"}` | `decideGuard` | every case rejected `invalid_path` |
| E18 | G7 | EP | L1 | automated | roots repo; denied `["bash","powershell"]` vs denied absent | `bash cat /w/other/s`, `powershell`, `mcp__srv__read_file {path:"/etc/passwd"}` | denied absent: all allowed; with the list: bash + powershell rejected `tool_denied`, the MCP tool allowed |
| E19 | G9 | decision table | L1 | automated | `withPathContainmentGuard(opts, base?)` with: no base; base `{extensions:["/p/own.ts"], extensionConfig:{team:{root:"/w"}}}`; base already holding the guard key; roots `[]`/`["rel"]`/win32 driveless; denied `["bash",""]`; denied omitted | call | fragment shape correct; merge keeps both, `extensions` = [own, guard], base deep-equal to its pre-call snapshot; the invalid cases throw; omitted denied → no `deniedTools` key |
| E20 | G1/G9 | static | L1 | automated | `packages/path-containment-guard/package.json` + package root listing; import graph of `src/scope.ts` | read manifest; import `scope.ts` | no `pi.extensions`; no root `index.ts`/`index.js`; no `@earendil-works/*` module loaded |
| E21 | S1 | decision table | L1 | automated | `buildSpawnEnv` base env + config rows: (a) inherited `PI_EXT_GUARD_ALLOWED_ROOTS`+`_TOKEN` with `{guard:{allowedRoots:["/new"]}}`; (b) `{guard:{}}`; (c) inherited `PI_EXT_OTHER_KEY`; (d) names `path-containment` and `path-containment-guard`; (e) inherited `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS`, no config; (f) contributor supplying `PI_EXT_GUARD_TOKEN` | build env | (a) only `["/new"]`, no TOKEN; (b) no `ALLOWED_ROOTS`; (c) OTHER kept; (d) both projected; (e) absent; (f) absent, and not in `contributedOut` |
| E22 | G9/S1 | integration | L1 | automated | `withPathContainmentGuard({allowedRoots:["/w/repo"],deniedTools:["bash"]})` | `pluginSpawnToSessionOptions` → `sessionFlagsToArgv` + `buildSpawnEnv` | argv has `-e <guard entry>`; env `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS=["/w/repo"]`, `..._DENIED_TOOLS=["bash"]` |
| E23 | A1 | state (fs) | L1 | automated | path-gate roots = repo; (a) `repo/link` dangling → `other/new.txt`; (b) `repo/s`→`other/deep`, `deep/link`→`../new.txt` | `decidePathAccess({access:"write"})` | both `verdict:"ask"`, canonical `<other>/new.txt` |
| E24 | D1/A1 | BVA + fs | L1 | automated | shared `isPathWithinRoots` / `canonicalizeTarget`: sibling prefix, root equality, exact match with a probe spy, ci-probe fold, `path.win32` forms; a link text `sub/../x` with `sub` a symlink; an env literal without `isSymlink`/`readlink` | call | sibling false; equality true; the probe is not called on an exact hit; folding only when the probe is true; win32 correct; `sub/../x` resolved from the real `sub` target; the legacy env behaves as before (no throw) |
| E25 | D1 | regression | L1 | automated | unmodified `packages/extension/src/path-gate/__tests__/*.test.ts` | run after the extraction (task 1.2) and after D6 (task 1.4) | all pass with zero test-file edits besides the additions in E23/X10 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | G5 | tail-latency | L1 | automated | 1000 `decideGuard("read")` of existing files in one temp root, after 1 warm-up call | p95 < 1 ms | single run, 1000 samples |
| P2 | A1 (agent-path-confinement "cheap") | tail-latency | L1 | automated | the existing `handler.test.ts` "P1 in-root p95 < 1 ms" after D6 | p95 < 1 ms (unchanged) | existing test |

### Frontend-quirk

None. The change has no rendered UI.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | G6 | fault-injection (abort) | L1 | automated | injected `ResolveEnv.realpathSync` throws `EACCES` on every path | `tool_call` handler on `read` | `{block:true}`, reason starts `error`; one stderr line |
| X2 | G6/G4 | fault-injection (loop) | L1 | automated | `repo/a`→`repo/b`→`repo/a` | `write repo/a` | rejected `error` (hop limit), no hang (test timeout 5 s) |
| X3 | G1 | fault-injection (load) | L1 | automated | `parseGuardConfig` dependency injected to throw at factory time | invoke the factory with a fake `pi` | the factory returns normally; exactly one `tool_call` handler registered; `read` in-root and `bash` both rejected `config_invalid` |
| X4 | G6 | spy | L1 | automated | ctx with `ui.confirm/select/input/notify` spies that throw if called | out-of-root `write` through the handler | rejected `path_outside_roots`; zero spy calls |
| X5 | G6 | injection (log forging) | L1 | automated | out-of-root path containing `\n` and U+2028 | `read` through the handler | exactly one stderr line, containing escaped `\n`/`\u2028` |
| X6 | G6 | decision table | L1 | automated | one call producing each code (`tool_denied`, `path_outside_roots`, `invalid_path`, `config_invalid`, `error`) | handler | each reason starts with its code; `— allowed roots:` suffix present only on `path_outside_roots` |
| X7 | G3 | real-runner | L1 | automated | guard loaded through pi `discoverAndLoadExtensions([entry])` + `ExtensionRunner`; denied `["bash"]` | emit `tool_call` for `bash` carrying `parentToolCallId` | blocked, reason `tool_denied` |
| X8 | G8 | real-runner, both orders | L1 | automated | `ExtensionRunner` with the guard + a stub always-allow handler, registered guard-first and stub-first | emit out-of-root `read` | blocked `path_outside_roots` in both orders; `rg "packages/extension\|path-gate" packages/path-containment-guard/src` empty |
| X9 | G1 | real-load + transpile | L1 | automated | `src/extension.ts`, `src/scope.ts` | (a) pi `discoverAndLoadExtensions([entry])`; (b) jiti CJS transform + AST scan | (a) no load errors, one `tool_call` handler; (b) zero `MetaProperty` nodes in code position |
| X10 | A1 | fault-injection (loop) | L1 | automated | path-gate with `repo/a`↔`repo/b` symlink loop | `createPathGateHandler` on `write repo/a` | blocked as `error`; one `[path-gate] error` log line |

---

## Coverage summary

- Requirements covered: 12/12 (G1–G9, A1, S1, D1).
- Scenarios by class: edge 25 · perf 2 · frontend 0 · error 10.
- Scenarios by level: L1 37 · L2 0 · L3 0.
- Scenarios by disposition: automated 37 · manual-only 0.

## New infra needed

- None. X7/X8/X9 use pi's exported `discoverAndLoadExtensions` + `ExtensionRunner` (`@earendil-works/pi-coding-agent` `dist/index.d.ts:9`), which is already a dev dependency pattern in sibling packages. The exact signatures must be checked at authoring time.
