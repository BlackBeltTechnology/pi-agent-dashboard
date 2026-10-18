# Test Plan — fix-doc-engine-arm64-chromium

Stage: design   Generated: 2026-05-14

Clarifications C1–C4 resolved by review decisions D1–D4 (design D6/D8/D9); D5 accepts the shim marker (E5, E13).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| E1 | Docker image req — arch branch (task 1.1) | text guard (wording-only, D5) | L1 pytest | automated | `engine/Dockerfile` text | parse | no unconditional `chrome-headless-shell` install. `case "$(dpkg --print-architecture)"` has `amd64)`, `arm64)` and `*)` arms. `arm64)` installs `chromium`. `FROM python:3.12-slim-<suite>`. `@mermaid-js/mermaid-cli@<ver>` pinned. No `@stable`. A smoke `RUN` sits after `COPY . /engine/`. FAILS on today's Dockerfile | `engine/tests/test_convert_pdf_output.py` |
| E2 | "fail for any arch with no branch" | EP (invalid classes) | L1 pytest | automated | browser `RUN` body extracted from Dockerfile. Stub `dpkg` on PATH prints `ppc64le` / `armhf` / `` (empty). Stub `npx`/`apt-get`/`ln`/`mkdir` log their argv | `sh -c <body>` | exit ≠0. stderr contains `unsupported build architecture: <arch>` (empty arch included). Stub-call log is empty: no npx and no apt-get | `engine/tests/test_convert_pdf_output.py` |
| E3 | arch decision table (D1/D2) | decision table | L1 pytest | automated | same stubs. dpkg → `amd64` vs `arm64` | `sh -c <body>` | amd64: `npx @puppeteer/browsers install chrome-headless-shell@<pinned id>` (not `@stable`) and no `apt-get`. arm64: `apt-get update` then `apt-get install -y --no-install-recommends chromium`, `mkdir -p /opt/chrome-headless-shell`, `ln -s /usr/bin/chromium /opt/chrome-headless-shell/chrome-headless-shell`, and no browser npx | `engine/tests/test_convert_pdf_output.py` |
| E4 | arm64 asserts package landed (task 2.3) | fault (absent binary) | L1 pytest | automated | dpkg → `arm64`. Host has no executable `/usr/bin/chromium` (test skips when the host has one) | `sh -c <body>` | exit ≠0 with the named "chromium not executable"-style message. The `ln -s` stub is not reached, or the run still fails afterwards | `engine/tests/test_convert_pdf_output.py` |
| E5 | shim marker (D6, review D5) | EP: set / unset / empty | L1 pytest | automated | `mmdc` shim reproduced from the Dockerfile `printf`. Stub `node` on PATH records argv and exits 0 | run shim `-i x.mmd -o x.png`: (a) `PI_DOC_MMDC_MARKER=<tmp>/m`; (b) var unset; (c) var empty | (a) `<tmp>/m` exists. (b, c) no file created and the shim still execs node. Every case: node argv starts `…/cli.js -p /opt/puppeteer.json` + passthrough args, and shim exit = node exit | `engine/tests/test_convert_pdf_output.py` |
| E6 | D8 default tagging | EP | L1 vitest | automated | stub `docker` on PATH logs argv. `IMAGE_TAG` unset. `IMAGE_VERSION=0.2.0` | `bash engine/build-image.sh` | exactly one `docker build` with `-t pi-doc-engine:0.2.0` and `-t pi-doc-engine:latest`. exit 0 | `scripts/__tests__/test-up-port-derivation.test.mjs` |
| E7 | D8 override | EP | L1 vitest | automated | `IMAGE_TAG=pi-doc-engine:dev` | same | argv has `-t pi-doc-engine:dev` and no `:latest` | same |
| E8a | D8 boundary (review D2) | BVA | L1 vitest | automated | `IMAGE_TAG=pi-doc-engine:0.2.0` set explicitly | same | argv has `-t pi-doc-engine:0.2.0` and no `:latest` (any non-empty `IMAGE_TAG` builds only that tag) | same |
| E8b | D8 boundary (review D2) | BVA | L1 vitest | automated | `IMAGE_TAG=""` | same | treated as unset: argv has `-t pi-doc-engine:0.2.0` and `-t pi-doc-engine:latest` | same |
| E8c | D8 fault | fault (abort) | L1 vitest | automated | stub docker exits 1 | same | script exits ≠0. No `Built …` line on stdout | same |
| E9 | tag/contract restatements (task 4.16) | invariant | L1 pytest | automated | every file under `packages/document-converter` except node_modules and the scanning test file itself | scan | every `pi-doc-engine:\d+\.\d+\.\d+` equals `IMAGE_VERSION` (0.2.0). No `falls back to mmdc` without an MMDC_UNAVAILABLE qualifier. No `never hard-fails` | `engine/tests/test_convert_pdf_output.py` |
| E10 | semver/breaking notes (4.10/4.12) | invariant | L1 vitest | automated | `packages/document-converter/package.json`, root `CHANGELOG.md` | read | `version` semver ≥ `0.10.0`. `CHANGELOG.md` has an entry mentioning `MMDC_UNAVAILABLE` (any section, so the release roll-up of `[Unreleased]` does not break it) | `scripts/__tests__/check-conventions.test.mjs` |
| E11 | probe classification (D6, task 3.1) | decision table / EP over subprocess outcomes | L1 pytest | automated | `subprocess.run` monkeypatched to return/raise: (a) rc0 + stdout `<html><head></head><body></body></html>`; (b) rc0 + stdout ``; (c) rc1; (d) `FileNotFoundError`; (e) `OSError(ENOEXEC)`; (f) `TimeoutExpired` | `browser_launch_probe()` | (a) available. (b–f) unavailable with no exception escaping. Recorded argv == `[$PUPPETEER_EXECUTABLE_PATH, "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--dump-dom", "about:blank"]` and `timeout=10` | `engine/tests/test_styled_diagrams.py` |
| E12 | probe env precondition (review D3) | EP (invalid) | L1 pytest | automated | `PUPPETEER_EXECUTABLE_PATH` unset / `""`. `subprocess.run` monkeypatched | `browser_launch_probe()` | recorded argv[0] == `/opt/chrome-headless-shell/chrome-headless-shell`. No `TypeError` escapes. Rest of argv = D6 flags | same |
| E13 | `_run_dc` gating (D6, task 3.4) | decision table: classify × child rc × marker × probe | L1 pytest | automated | monkeypatched child + probe spy | `_run_dc(args, classify_mmdc=…)` | (a) F, rc≠0 → `PRODUCE_FAILED`, 0 probe calls, `PI_DOC_MMDC_MARKER` absent from child env. (b) T, rc0, marker present → returns proc, 0 probes, marker deleted. (c) T, rc≠0, no marker, probe would fail → `PRODUCE_FAILED`, 0 probes. (d) T, rc≠0, marker, probe fails → `MMDC_UNAVAILABLE`, child stderr kept in `e.stderr`. (e) T, rc≠0, marker, probe passes → `PRODUCE_FAILED`. Every case: marker path removed afterwards. Two sequential calls get different marker paths | `engine/tests/test_styled_diagrams.py` |
| E14 | caller routing (D6) | decision table over commands | L1 pytest | automated | `_run_dc` spied | `cmd_render_docx`, `cmd_render_pdf`, `cmd_extract_for_edit`, `cmd_merge_back` | first two call with `classify_mmdc=True`. The last two use False/default | same |
| E15 | `_mmdc` classification | decision table | L1 pytest | automated | mmdc monkeypatched: (a) rc1 + probe fails; (b) rc1 + probe passes; (c) rc0 but png missing + probe passes; (d) rc0 + png written | `_mmdc(src, png)` | (a) `MMDC_UNAVAILABLE`. (b, c) `MMDC_FAILED`. (d) returns and the probe is never called | same |
| E16 | facade mapping (task 3.13) | EP over engine codes | L1 vitest | automated | runner returns error envelope `{code: X, message: "m", stderr: "s"}` | `runEngine` | X=`MMDC_UNAVAILABLE` → `DocConverterError.code === "MMDC_UNAVAILABLE"` with message `"m"` and stderr `"s"` kept. `MMDC_FAILED`/`PRODUCE_FAILED` → `PRODUCE_FAILED`. Unknown → `INTERNAL` | `packages/document-converter/src/__tests__/engine.test.ts` (L62 "maps an error envelope") |
| E17 | union member | type-level | L1 vitest | automated | `DocConverterErrorCode` | `expectTypeOf` / exhaustive `switch` with `never` | compiles only if `"MMDC_UNAVAILABLE"` is a member | same |
| E18 | styled + unlaunchable browser (spec) | fault (abort) | L1 pytest | automated | nano_banana enabled, `GEMINI_API_KEY` unset, `_mmdc` mmdc rc1, probe fails, `_run_dc` spied | `cmd_render_docx` | raises `MMDC_UNAVAILABLE`. `_run_dc` called 0 times. No `.styled.md` gets converted | `engine/tests/test_styled_diagrams.py` |
| E19 | styled render needs no mmdc | spy | L1 pytest | automated | cache miss, `_nano_banana` → True | `_render_styled_diagrams` | `_mmdc` called 0 times. Output `.styled.md` has no ```` ```mermaid ```` fence | same (test_cache_miss_generates_via_nano_banana) |
| E20 | message names cause (review D1) | observable content | L1 pytest | automated | case E13d / E15a with `PUPPETEER_EXECUTABLE_PATH=/x/chrome`, `platform.machine` monkeypatched → `aarch64` | raise | `e.code == "MMDC_UNAVAILABLE"`; `e.message` contains `/x/chrome` and `aarch64` | same |
| E21 | engine pytests gate merges (review D4, design D9) | workflow contract | ci | automated | `.github/workflows/ci.yml` text | parse the `music-pytest` job block | pytest invocation includes `packages/document-converter/engine/tests` (alongside the two existing suites); job still never installs `requirements-mir` | `packages/shared/src/__tests__/ci-music-pytest.test.ts` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | probe only on failed calls (D6 Risks) | call-count | L1 pytest | automated | 1 successful `_run_dc(classify_mmdc=True)` with marker + 1 successful `_mmdc` | probe invocations == 0, so the success path adds no latency | single call |
| P2 | probe bounded (10 s) | threshold | L1 pytest | automated | probe against a stub executable that sleeps 30 s (real subprocess), or monkeypatched `TimeoutExpired` | probe returns "unavailable" in ≤ 11 s wall time, and `timeout == 10` is passed | single call |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| X1 | arm64 native image | real build | — | manual-only | none (arm64 host) | `npm run build:image -w @blackbelt-technology/pi-dashboard-document-converter` | build exits 0 with the smoke RUN green. `docker run --rm pi-doc-engine:0.2.0 sh -c 'readlink -f /opt/chrome-headless-shell/chrome-headless-shell; file -L …'` → `/usr/bin/chromium`, ELF `ARM aarch64`. No `qemu-x86_64` in build logs | — |
| X2 | Mermaid renders on arm64 | real produce | — | manual-only | none | `DOC_ENGINE_IMAGE=pi-doc-engine:0.2.0` opt-in integration test with a mermaid doc | `renderDocx` resolves. DOCX `word/media/` has ≥1 png | — |
| X3 | amd64 unchanged mod pin | real build + produce | — | manual-only | none (amd64 host) | rebuild, then produce a reference mermaid doc | build green. `npx` used the VENDOR.md build id. Diagram present. Output compared to a 0.1.0 render (visual: no regression) | — |
| X4 | unprovisionable browser fails build | fault (abort) | — | manual-only | local edit: symlink target → `/bin/false` | `build-image.sh` | build fails at the smoke RUN. `docker image inspect` shows the `pi-doc-engine:0.2.0` / `:latest` IDs unchanged from before | — |
| X5a | unlaunchable browser, real image | fault (non-exec binary) | L1 vitest (opt-in, `DOC_ENGINE_IMAGE`) | automated | custom `EngineRunner` adds `-v <tmp non-exec file>:/opt/chrome-headless-shell/chrome-headless-shell:ro` | `renderDocx` of a mermaid doc | rejects with `code === "MMDC_UNAVAILABLE"`; message contains `/opt/chrome-headless-shell/chrome-headless-shell` and the container's machine arch (`x86_64`/`aarch64`) | `packages/document-converter/src/__tests__/integration.test.ts` |
| X5b | non-diagram failure not misattributed | fault | L1 vitest (opt-in) | automated | same broken binary. Doc has no mermaid block, and a nonexistent template makes the produce fail | `renderDocx` | rejects `PRODUCE_FAILED`, not `MMDC_UNAVAILABLE` | same |
| X5c | invalid diagram ≠ browser | fault (bad input) | L1 vitest (opt-in) | automated | healthy image. ```` ```mermaid\ngraph TD; A--> ``` ```` (syntax error) | `renderDocx` | rejects `PRODUCE_FAILED` | same |
| X6 | probe argv accepted by both browsers (task 3.0) | real launch | — | manual-only | none / foreign-arch binary / non-exec file | run the D6 argv in a built image on amd64 and arm64 | healthy: exit 0, `<html` within 10 s. Foreign-arch or non-exec: OSError or rc≠0 | — |

---

## Coverage summary

- Requirements covered: 3/3 MODIFIED requirements, 15/15 spec scenarios, plus D2/D5/D6/D8/D9 and tasks 4.10/4.12/4.16
- Scenarios by class: edge 23 (E1–E21, E8 split a/b/c) · perf 2 · frontend 0 (no UI surface) · error 8 (X1–X6 incl. X5a/b/c)
- Scenarios by level: L1 pytest 16 · L1 vitest 11 (3 opt-in) · L2 0 · L3 0 · ci 1 · — 5
- Scenarios by disposition: automated 28 · manual-only 5

## New infra needed

- `music-pytest` job gains `packages/document-converter/engine/tests` plus the light pip set it imports (design D9; E21).
- E2–E4 need a helper that pulls the browser `RUN` body out of the Dockerfile and runs it under stub binaries. That helper is new, but it lives inside a pytest file.
