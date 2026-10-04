# Test Plan — harden-untrusted-content-ingestion

Stage: design   Generated: 2026-05-17

HARD gate resolved:
- **C1 → B.** `renderPdf` inputs mount `:ro`. Real-engine proof is a
  manual-only pre-merge run of the opt-in integration test, using committed
  prerendered fixture inputs (M2). The mount *plan* is still L1-tested (E9).
- **C2 → A.** Oversize UX: L1 component tests + one manual-only overlay check (M1).

Exemplars (harness glue to copy):
- document-converter → `packages/document-converter/src/__tests__/engine.test.ts`, `facade.test.ts`
- kb → `packages/kb/src/__tests__/kb.test.ts` (`describe("source resolvers + trust")`, `:318`)
- server → `packages/server/src/__tests__/file-raw-render-endpoints.test.ts` (`:977` sheet-cap 413),
  `office-preview.test.ts`
- shared → `packages/shared/src/__tests__/file-kind.test.ts`
- client → `packages/client/src/components/preview/__tests__/{SpreadsheetPreview,DocxPreview,PptxPreview}.test.tsx`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D1 sensitive output | EP (invalid) | L1 | automated | roots=`[tmp/ws]`, req `{command:"renderPdf", input:"tmp/ws/a.md", output:"/root/.ssh/authorized_keys"}` | `runEngine` | rejects `DocConverterError` code `PATH_NOT_ALLOWED`; fake runner call count 0 |
| E2 | D1 outside roots | EP (invalid) | L1 | automated | roots=`[tmp/ws]`, input `tmp/other/x.pdf` | `runEngine` | `PATH_NOT_ALLOWED`; runner not called |
| E3 | D1 symlink escape | EP (invalid) | L1 | automated | `tmp/ws/link → /etc`; input `tmp/ws/link/hosts` | `runEngine` | `PATH_NOT_ALLOWED`; runner not called |
| E4 | D1 in-root symlink input | EP (valid) | L1 | automated | `tmp/ws/link → tmp/ws/real`; `convertToMarkdown` input `tmp/ws/link/a.md` | `runEngine` | argv contains `-v <realpath tmp/ws/real>:tmp/ws/link:ro`; request JSON input unchanged |
| E5 | D1 parent of root never mounted | BVA (path == root) | L1 | automated | workspaceRoot `tmp/ws`; `fillFrontmatter` `paths:["tmp/ws"]`, `apply:false` | `runEngine` | exactly one mount, target `tmp/ws` (dir itself); no mount of `tmp` |
| E6 | D1 `/` as root | EP (invalid) | L1 | automated | (a) workspaceRoot `/`; (b) `mounts:["/"]` | any `runEngine` | both reject `PATH_NOT_ALLOWED` |
| E7 | D1 denylist exception | decision table | L1 | automated | `HOME=tmp/home`; roots `{tmp/home, tmp/home/.pi/x}` | paths (a) `tmp/home/.pi/agent/auth.json`, (b) `tmp/home/.pi/x/a.docx`, (c) workspaceRoot `tmp/home/.pi/agent` + path under it, (d) `tmp/home/.ssh/id` | (a) reject, (b) accept, (c) accept, (d) reject |
| E8 | D1 denylist realpath | EP | L1 | automated | `HOME=tmp/home`, `tmp/home/.pi → tmp/home/realpi` (symlink), workspaceRoot `tmp/home` | path `tmp/home/realpi/agent/x.md` | `PATH_NOT_ALLOWED` |
| E9 | D1 per-command mode | decision table | L1 | automated | in/out in same and different dirs under `tmp/ws` | each command: `convertToMarkdown`, `renderPdf`, `renderDocx`, `extractForEdit`, `mergeBack`, `fillFrontmatter{apply:true,false}`, `profileTables{apply:true,false}` | input dir `:ro` for convertToMarkdown, renderPdf, fill/profile apply:false; rw otherwise; output dir rw; shared in/out dir → one rw mount |
| E10 | D1 glob path | EP | L1 | automated | `fillFrontmatter` `paths:["tmp/ws/spec/**/*.md"]` | `runEngine` | mount target `tmp/ws/spec` |
| E11 | D1 relative path unchanged | EP | L1 | automated | `paths:["spec/a.md"]` | `runEngine` | no mount derived from it; no rejection |
| E12 | D1 not-yet-existing output | BVA | L1 | automated | output `tmp/ws/new/sub/x.pdf` (only `tmp/ws` exists) | `runEngine` | accepted; mount target `tmp/ws/new/sub`, mode rw |
| E13 | D1 staging created first | state | L1 | automated | facade `stagingDir` = non-existent `tmp/ws/staging`, workspaceRoot `tmp/ws` | `convertToMarkdown` (fake runner) | resolves; `tmp/ws/staging` exists; staging mount rw |
| E14 | D1 legit conversion | EP (valid) | L1 | automated | facade fixtures relocated into an `mkdtemp` root | each facade method with fake runner | all resolve as before (`facade.test.ts`, `engine.test.ts` green) |
| E20 | D2 IPv4 classifier boundaries | BVA | L1 | automated | `9.255.255.255`, `10.0.0.0`, `10.255.255.255`, `11.0.0.0`, `100.63.255.255`, `100.64.0.0`, `172.15.255.255`, `172.16.0.0`, `172.31.255.255`, `172.32.0.0`, `198.17.255.255`, `198.18.0.0`, `192.0.2.1`, `203.0.113.9`, `8.8.8.8` | `isNonPublicAddress` | blocked exactly for in-range values; `8.8.8.8`, `9.255…`, `11.0.0.0`, `100.63…`, `172.15…`, `172.32.0.0`, `198.17…` public |
| E21 | D2 IPv6 embedded forms | decision table | L1 | automated | `::1`, `[::ffff:7f00:1]`, `::ffff:127.0.0.1`, `::ffff:0:a00:5`, `::a00:5`, `64:ff9b::a00:5`, `64:ff9b:1::808:808`, `2002:a00:5::1`, Teredo client `10.0.0.5`, `fe80::1`, `fd00::1`, `2001:db8::1`, `2606:4700:4700::1111`, `64:ff9b::808:808` | `isNonPublicAddress` | all blocked except `2606:4700:4700::1111` and `64:ff9b::808:808` |
| E22 | D2 literal metadata URL | EP | L1 | automated | ref `https://169.254.169.254/latest/meta-data/` | `httpsResolver.resolve` | rejects; `net`/`https` connect spy count 0; lookup not called |
| E23 | D2 non-https refused | EP | L1 | automated | refs `http://example.com/a.md`, `ssh://h/r` (kind https) | resolve | rejects with message containing `only https`; nothing fetched |
| E24 | D2 lookup shapes | decision table | L1 | automated | stub `dns.lookup` → `[{8.8.8.8,4},{10.0.0.5,4}]`; and single `8.8.8.8` | `guardedLookup(h,{all:true})` / `(h,{all:false})` | all:true mixed → error; all:true public → array callback; all:false → `(null,"8.8.8.8",4)` |
| E25 | D2 redirect cap | BVA | L1 | automated | test server: chain of 3 redirects then 200; chain of 4 | `guardedFetch` (maxRedirects 3) | 3 → body returned; 4 → rejects `too many redirects` |
| E26 | D2 redirect to loopback | EP | L1 | automated | test server first hop (admitted via test seam) → `302 Location: https://127.0.0.1:<p>/x` | `guardedFetch` | rejects; second server receives 0 connections |
| E27 | D2 byte cap | BVA | L1 | automated | maxBytes 1024; bodies of 1024 and 1025 bytes | `guardedFetch` | 1024 ok; 1025 rejects; resolver writes no file |
| E28 | D2 gzip bomb | EP | L1 | automated | `Content-Encoding: gzip`, 2 KB compressed → 10 MB, maxBytes 1 MB | `guardedFetch` | rejects with cap error before 10 MB is buffered |
| E29 | D2 deflate sniff | decision table | L1 | automated | `Content-Encoding: deflate` with zlib-wrapped body; with raw-deflate body | `guardedFetch` | both decode to the original text |
| E30 | D2 bad encoding / status | EP | L1 | automated | `Content-Encoding: zstd`; status 404 | `guardedFetch` | both reject; no cache write |
| E31 | D2 plain-file name | EP | L1 | automated | paths `/docs/x.md`, `/`, `/docs/` | https resolve (plain) | files `x.md`, `index.md`, `index.md` |
| E40 | D3 file transport | EP | L1 | automated | ref `git:file:///etc` | `gitResolver.resolve` (fake `git` on PATH records argv) | rejects; fake git invocation count 0 |
| E41 | D3 other schemes | EP | L1 | automated | `git:http://h/r`, `git:git://h/r`, `git:ext::sh -c x` | resolve | each rejects; git not invoked for network commands |
| E42 | D3 private host | EP | L1 | automated | `git:https://127.0.0.1/r`, `git:https://10.0.0.5/r` | resolve | rejects; git not invoked |
| E43 | D3 option-like ref/pin | EP | L1 | automated | pin `--upload-pack=touch /tmp/x`; ref `git:github.com/o/r@-x` | resolve | rejects; git not invoked; `/tmp/x` absent |
| E44 | D3 argv hardening | EP | L1 | automated | `git:https://example.com:8443/r` (lookup seam → `93.184.216.34`); IPv6 variant → `2606:2800::1` | resolve (fake git) | clone argv: `-c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always -c http.followRedirects=false -c submodule.recurse=false -c fetch.recurseSubmodules=false -c http.curloptResolve=example.com:8443:93.184.216.34` all before `clone`; IPv6 pin bracketed `[2606:2800::1]` |
| E45 | D3 bare ref effective URL | EP | L1 | automated | ref `git:github.com/org/repo` (lookup seam → public) | resolve (fake git) | clone receives `https://github.com/org/repo`; accepted |
| E46 | D3 origin mismatch on refresh | state | L1 | automated | existing clone whose fake `remote get-url origin` = `https://evil.internal/r`; spec URL `https://github.com/o/r` | resolve with `refresh:true` | cache dir removed; fresh guarded `clone` of spec URL; no `fetch`/`pull` against origin |
| E47 | D3 old git | EP | L1 | automated | fake `git version` → `2.30.0` | resolve | no `http.curloptResolve` flag; warning logged once |
| E48 | D3 fetch/pull flags | EP | L1 | automated | existing clone, matching origin, `refresh:true`, pinned and unpinned | resolve | `fetch`/`pull` argv carry `--no-recurse-submodules` + all `-c` flags before subcommand |
| E50 | D4 tar `..` entry | EP | L1 | automated | tar built by fixture writer with `../../evil` | resolve | rejects; no file outside stage; `dest` unchanged |
| E51 | D4 tar absolute entry | EP | L1 | automated | tar with `/tmp/<rand>/evil` | resolve | rejects; `/tmp/<rand>/evil` absent |
| E52 | D4 tar symlink | EP | L1 | automated | tar with symlink `l → /etc` | resolve | rejects |
| E53 | D4 tar hardlink | EP | L1 | automated | tar with hardlink entry | resolve on host `tar` (GNU in CI, bsdtar on macOS) | rejects |
| E54 | D4 zip `..` entry | EP | L1 | automated | zip built by fixture writer with `../evil.md` | resolve | rejects |
| E55 | D4 zip symlink | EP | L1 | automated | zip with symlink entry (unix mode `0120777`) | resolve | rejects |
| E56 | D4 tricky but legal names | EP (valid) | L1 | automated | tar + zip with `a -> b.md`, `with space.md` | resolve | both extracted as regular files |
| E57 | D4 non-ASCII names | EP (valid) | L1 | automated | tar + zip with `café.md`, `文.md` | resolve (listing under `LC_ALL=C`) | both extracted |
| E58 | D4 control char names | EP (invalid) | L1 | automated | tar + zip with `tab\tname.md`; tar with `nl\nname.md` | resolve | rejects |
| E59 | D4 empty zip | BVA (N=0) | L1 | automated | zip with 0 entries | resolve | succeeds; dest is an empty source dir with `.fetched` |
| E60 | D4 bzip2 | EP | L1 | automated | valid `.tar.bz2` | resolve | extracts (previously broken by `xzf`) |
| E61 | D4 corrupt archive | EP | L1 | automated | truncated `.tar.gz` | resolve | rejects; prior `dest` unchanged |
| E62 | D4 marker moves | state | L1 | automated | fresh resolve | resolve | `dest/.fetched` exists after swap; no `stage-*`, no `dest.old-*` backup left |
| E70 | D5 sheet cap | BVA | L1 | automated | `officeCaps.sheetSizeCap=1000`; files of 1000 and 1001 bytes | `GET /api/file/sheet` | 1000 → 200; 1001 → 413 and `parseSheet` spy not called |
| E71 | D5 patched parser | EP | L1 | automated | resolved `xlsx/package.json` from server package | read version | semver ≥ `0.20.2` |
| E72 | D6 caps single source | EP | L1 | automated | `OFFICE_CAPS`, `OFFICE_SIZE_CAPS` | compare | `docxSizeCap/pptxSizeCap/sheetSizeCap` equal `docx/pptx/sheet` |
| E73 | D5 lockfile install | EP | ci | automated | `pnpm install --frozen-lockfile` with URL-tarball `xlsx` | CI install job on the PR | job green; `node_modules/xlsx/package.json` version `0.20.3` |
| E74 | D5 electron packaging | EP | electron | automated | branch with URL-tarball `xlsx` | `workflow_dispatch` of `ci-electron.yml` (`legs: linux-x64`; workflow is dispatch-only) | run green; runnable-bundle assertion passes; bundled `resources/server/node_modules/xlsx/package.json` version `0.20.3` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none | — | — | — | Spec sets caps (50 MB / 60 s / 3 redirects), not perf targets; caps are covered as BVA rows (E25, E27, X1). | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | D6 spreadsheet 413 | state-transition | L1 | automated | mocked `previewFetch` → status 413 `{success:false,error}` | mount `SpreadsheetPreview` | `[data-testid=too-large-preview]` present, text contains `limit 50 MB`; `too-large-open-raw` href contains `/api/file/raw`; FallbackPreview absent |
| F2 | D6 docx 413 | state-transition | L1 | automated | mocked 413 from `/api/file/render` | mount `DocxPreview` | too-large notice with `limit 40 MB`; FallbackPreview absent |
| F3 | D6 pptx 413 | state-transition | L1 | automated | mocked 413 on render request | click "Render slides" | state idle → loading → too-large notice `limit 100 MB`; FallbackPreview absent |
| F4 | D6 other failures unchanged | decision table | L1 | automated | (a) sheet 200 `{success:false}`; (b) pptx engine-unavailable `{success:false}`; (c) docx 200 `{success:false}` | mount / render | FallbackPreview shown; too-large notice absent |
| F5 | D6 default cap unchanged | EP | L1 | automated | `<TooLargePreview cwd path size={11 MB}/>` without `cap` | render | text contains `limit 10 MB` (CappedViewer path unchanged) |
| M1 | D6 overlay UX | visual/subjective | — | manual-only | 60 MB `.xlsx` linked in a chat tool output | click the file link (overlay) | [judgment: notice readable, limit 50 MB, Open raw works — overlay path not harness-reachable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D2 timeout | fault-injection (delay) | L1 | automated | test server never sends headers | `guardedFetch` (timeoutMs 200) | rejects within 200–1000 ms; socket closed |
| X2 | D2 3xx unbounded body | fault-injection (abort) | L1 | automated | 302 with endless body + `Location` to public test target | `guardedFetch` | follows redirect without reading 302 body; no unhandled `error` event; completes |
| X3 | D2/D4 failed refresh | fault-injection (abort) | L1 | automated | existing good `dest` + marker; refresh returns 500 / blocked redirect / zip-slip archive | resolve `refresh:true` | rejects; `dest` content + `.fetched` byte-identical to before |
| X4 | D4 crash recovery | state-transition | L1 | automated | (a) `dest` absent, an abandoned (past-grace) backup present; (b) `dest` + an aged (>1h) backup and a young one | resolve | (a) the backup is renamed back, then normal resolve; (b) aged backup pruned, young one kept, swap succeeds |
| X5 | D4 swap rollback | fault-injection (abort) | L1 | automated | inject failure on `rename(stage/out, dest)` | resolve | rejects; `dest` restored from its backup with original content |
| X6 | D1 engine unavailable unchanged | fault-injection (abort) | L1 | automated | fake runner throws `DOCKER_UNAVAILABLE` for an allowed request | `runEngine` | same `DocConverterError` code as before (no confinement regression in error path) |
| M2 | D1 real-engine `:ro` (C1 B) | fault-injection | — | manual-only | committed prerendered fixtures `sample.md`, `sample.docx` in a dir mounted `:ro` | run opt-in `integration.test.ts` with `DOC_ENGINE_IMAGE` set: `renderPdf` + `convertToMarkdown` | [manual pre-merge: PDF produced; input dir listing byte-identical before/after; needs local engine image] |
| M3 | D7 audit triage | judgment | — | manual-only | `pnpm audit --prod` output after D5 | human triage | [judgment: every advisory has fix / accept-with-reason / not-reachable in design.md `## Audit triage`] |
| M4 | V3 real-world smoke | judgment | — | manual-only | KB source `https://169.254.169.254/` and a public `https://` md; a normal docx conversion | real `kb index` + real conversion | [manual: link-local refused with clear message; public source + conversion succeed] |

---

## Coverage summary

- Requirements covered: 9/9 (ADDED ×6, MODIFIED kb https ×1, MODIFIED file-and-url-preview ×2).
- Scenarios by class: edge 53 · perf 0 · frontend 6 (5 automated + M1) · error 9 (6 automated + M2–M4).
- Scenarios by level: L1 62 · ci 1 · electron 1 · L2 0 · L3 0 · — 4.
- Scenarios by disposition: automated 64 · manual-only 4 (M1–M4).

## New infra needed

- **kb archive fixture writer** (test helper): a minimal JS tar/zip writer that
  crafts `..`, absolute, symlink, hardlink and control-char entries portably.
  System `tar`/`zip` can't emit them reliably.
- **kb https test server + seam:** a local `https` server with a committed
  test-only self-signed cert fixture, plus a `guardedFetch` test seam (injectable
  address-policy/lookup) that admits the loopback first hop for E25/E26/E28–E30,
  X1, X2.
- **kb fake `git`:** a PATH-shim script that records argv and fakes
  `version`/`remote get-url`. Alternatively an injectable exec seam in
  `sources.ts`. Used by E40–E48.
- **document-converter fixtures:** committed `sample.md` + `sample.docx` under
  `packages/document-converter/src/__tests__/fixtures/` for M2.
