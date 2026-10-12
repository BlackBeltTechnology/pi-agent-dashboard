## Context

See proposal.md — Why. Constraints that shape the design:

- Precedent package shape: `packages/nano-banana` — standalone pi package, `pi.skills` + `bin` pointing at a `.ts` file (does not run from a shell — see spike S2/S3, fixed by D9/D10), `exports: {"./*.js": "./src/*.ts"}`, no build step (`packages/nano-banana/package.json`). Library reuse precedent: `packages/video-production/package.json:75` depends on `@blackbelt-technology/pi-dashboard-nano-banana` and calls `generateImage` (`packages/video-production/src/storyboard.ts`).
- `generateImage(opts) → {ok, output, error, backend, model?, usage?}`; never throws; `backend` default `gemini`, opt-in `pi` (`packages/nano-banana/src/nano-banana.ts:27,52,103`).
- Spawning must go through `buildSafeArgv` / `execFileAsync` in `packages/shared/src/platform/exec.ts:71,248` (no-direct-child-process invariant enforced by `packages/shared/src/__tests__/no-direct-child-process.test.ts`).
- Recommended manifest: `packages/shared/src/recommended-extensions.ts:605` (nano-banana entry, `status: "optional"`).
- Repo registrations a publishable package needs: `.github/workflows/publish.yml:341` (allowlist), root `vitest.config.ts:67` (projects), `knip.json:549` (workspace).
- pi agent dir: `PI_CODING_AGENT_DIR`, default `~/.pi/agent` (pi docs `environment-variables.md:81`). Project MCP config: `.pi/mcp.json`, read only after project trust (pi docs `mcp.md`).
- PhotoCraft facts, verified by spike on v0.7.0 (`/tmp/pcraft`):
  - Release assets + `SHA256SUMS.txt`; the CLI is in `photocraft-cli-<v>-macos-universal.zip`, Linux tarballs (`<root>/bin/photocraft-cli`), Windows portable zips (`<root>/photocraft-cli.exe`).
  - `run` accepts ONE `--out` (last wins); prints one JSON line per command; exit 1 + `error: …` on failure.
  - `serve`/`mcp` reject absolute paths unless `--automation-read-root/--automation-write-root` cover them.
  - MCP handles requests concurrently — a pipelined `command_run` raced ahead of `doc_open`.
  - Bounds shapes differ: `select.*` returns `[x,y,w,h]`; `file.placeEmbedded` returns `[x0,y0,x1,y1]`.
  - Composite recipe that works: `file.placeEmbedded{path,fit:false,scale,center}` → `select.rect{…,feather}` or `select.loadSelection{channel}` → `layer.layerMask.revealSelection` → `layer.flattenImage`.
  - Second spike (review reconciliation): every command id used below was executed (`image.crop`, `image.imageSize`, `file.placeEmbedded`, `select.rect`, `select.object`, `select.subject`, `select.sky`, `select.modify.feather`, `select.saveSelection`, `select.loadSelection`, `select.deselect`, `layer.layerMask.revealSelection`, `layer.flattenImage`). `select.object{rect}` is deterministic (same bounds on repeated runs). An empty `select.sky` reports `{"selected":false,"coverage":0}`. Feather reaches ≈2.5× its radius (radius 4/8/16 → 10/20/39 px with diff > 1). With PNG in/out, pixels outside the placed patch box were identical (0 px differ); inside the pad band they change through the feather. A composite saved as `.psd` keeps the patch layer with `hasMask: true`, and `convert comp.psd out.png` equals the in-run `layer.flattenImage` result exactly.
  - `tar -tvf` (bsdtar, macOS) lists zip entries with a type column; `spctl --assess --type install` accepts the CLI ("Notarized Developer ID"), `--type execute` rejects it ("does not seem to be an app").
- Spike round 3 (`/tmp/pcraft/spikes/s1..s5`, 2026-10-12):
  - **S1** Linux CLI (`linux-aarch64` tarball) in bare `debian:bookworm-slim`: links only `libc`/`libm`/`libgcc_s`; `run` incl. `select.subject` works headless. Needs `GLIBC_2.35` (fails on Ubuntu 20.04 / Debian 11); on Alpine/musl the loader reports a misleading `not found`. Bundle = `bin/photocraft-cli`, `bin/photocraft` (desktop), `share/` (icons, docs) — no `lib/`. Docker harness base `node:24-bookworm-slim` (glibc 2.36) qualifies.
  - **S2** Real Gemini (flash) apple→orange on a 1024² scene: `select.object` hint → bounds `[554,574,182,182]` → crop `517,537,256,256` → Gemini returned **1024²** (not 256²) → resized → composite. All changes stayed inside the crop. Masking with the *old* object's selection clipped the new, larger orange and left the apple's green rim and stem; masking with the crop rect inset 24 px + feather 8 was clean. Gemini's drift in the outer 24 px band: mean 2.2/255, p95 5; gradient across the inset edge unchanged (15.12 → 15.42) → no visible seam.
  - **S3** pi 1.1.0 project MCP: `.pi/mcp.json` loads only when the session cwd is the project root (a session in a subdirectory ignores it, even with `"cwd":"."`) and only for trusted projects (`~/.pi/agent/trust.json`; untrusted = silently ignored); stdio server cwd = session dir; bare `command` resolved via PATH.
  - **S2/S3 side finding** Raw-TS bins (`"bin": "src/bin/x.ts"`, `#!/usr/bin/env node`) do not run from a shell: workspace → `ERR_MODULE_NOT_FOUND` (`.js` specifiers name `.ts` files); npm install → `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Affects `pi-nano-banana` (`packages/nano-banana/package.json` bin) even inside a pi session's bash (`NODE_OPTIONS` empty). `@blackbelt-technology/pi-dashboard-shared` is also raw TS (`packages/shared/package.json` exports `./*.js → ./src/*.ts`). Working precedent: `packages/deck3d/bin/deck3d` (plain-JS launcher: tsx for `src/cli.ts` in a checkout, else `node dist/cli.js`) + `packages/deck3d/scripts/build-cli.mjs` (esbuild bundle).
  - **S4** Pipelined `doc_open`+`command_run` against the real MCP server: direct fails 1/10 (320×200) and 3/10 (1024²); through a 40-line serializing proxy 0/20. pi docs: "Tool calls from one assistant message can run in parallel" (pi `docs/extensions.md:123`).
  - **S5** `tar -tvf` type column flags `l`/`h` in both tgz and zip; bsdtar by default refuses `..` and strips leading `/` but extracts symlinks.

## Goals / Non-Goals

**Goals:** zero-setup headless PhotoCraft on every platform the upstream release covers; one deterministic `replace-region` that hides coordinate maths from the agent; both bash and MCP routes; failure modes that are loud and leave no partial state.

**Non-Goals:** desktop app install/launch or `--bridge` to a running app; a dashboard UI or server route; wrapping PhotoCraft's 858 commands in typed tools (the registry is self-describing); switching versions inside a running invocation (each invocation resolves once; a long-lived MCP server keeps its version); Windows Authenticode verification; release authenticity beyond same-origin checksums.

## Decisions

### D1 — "Latest" with a 24 h lookup cache, pin as escape hatch
User decision: follow latest. Resolve `GET /repos/storytold/photocraft/releases/latest` (excludes prereleases/drafts), cache `{tag, checkedAt}` in `<cache root>/latest.json` for 24 h. Unauthenticated GitHub API = 60 req/h/IP; the cache keeps us far below it, and `GITHUB_TOKEN` is used when present. `PHOTOCRAFT_VERSION` pins (rollback lever), `PHOTOCRAFT_BIN` skips provisioning entirely (air-gapped/self-built).
*Alternative:* pin a version + digest in the package — rejected by the user; kept reachable via the env pin.

### D2 — Keep the extracted bundle, minus the desktop executable; gate on glibc
S1 showed the Linux CLI is self-contained (system libc only); Windows is still unverified (DLLs beside the exe are possible), so the extracted tree stays in `<cache root>/<version>/` and the binary path inside it is returned. The desktop executable (`bin/photocraft`, `photocraft.exe`) is deleted after extraction — never needed, and it makes "headless only" literally true on disk. Archives are deleted after extraction.
On linux, before any download, the C library is checked (`process.report.getReport().header.glibcVersionRuntime`; absent ⇒ musl): musl or glibc < 2.35 fails fast with a named error instead of the loader's misleading `not found`.

### D3 — Extraction with system tools, guarded
No new npm dependency; all calls through `execFileAsync` (`packages/shared/src/platform/exec.ts:248`). Listing runs `tar -tf <archive>` (names, one per line) and `tar -tvf <archive>` (first character = type) on every platform (bsdtar reads zip and tar.gz; Windows 10+ ships bsdtar as `tar.exe`) and pairs them by line index — parsing names out of the verbose listing is brittle (`->`, `link to`, spaces). On Linux `tar` is GNU tar 1.34, not bsdtar (tar.gz only there); both escape a newline in a member name as a literal `\n`, so each entry stays one line in both listings (verified, spike S5 follow-up). Line counts differ, or a `-tvf` line does not start with a 10-character mode string ⇒ reject. Reject before extraction any entry that is absolute, has a `..` segment, or whose type is not `-`/`d` (S5: `l`/`h` appear for both tar and zip; bsdtar alone would still extract symlinks). Extraction: `ditto -x -k` on macOS (preserves the notarization-relevant attributes), `tar -xf` elsewhere. Staging dir is `<cache root>/.staging-<pid>-<rand>` (same volume as the target, so `rename` is atomic); the download is written inside it, so one removal cleans both. Staging dirs older than 1 h (killed runs) are swept at the start of a provisioning run. A cache hit is validated (regular, non-empty, executable binary) — a damaged entry is removed and re-provisioned. Final step `rename(staging, <cache root>/<version>)`; on `EEXIST`/`ENOTEMPTY`/`EPERM` (a concurrent winner, or Windows handle contention) re-validate the existing `<version>/` binary — valid → remove our staging and use it; invalid → fail with the original error. No lock files.
*Alternative:* `adm-zip`/`tar` npm packages — rejected (dependency weight, and own traversal pitfalls).

### D4 — Checksum fails closed; Gatekeeper is advisory
SHA256SUMS is same-origin, so it proves integrity (no truncated/corrupted download, no CDN tampering after publish) — not authenticity. That is the strongest check the release offers for Linux/Windows. On macOS we run `spctl --assess --type install` and record the result; rejection → warning only, because first-run notarization checks need network and would make offline cache hits flaky. Download is streamed to a temp file while hashing (no 77 MB in memory).

### D5 — `exec` is a transparent pass-through; MCP is a thin serializing supervisor
Both use the shared streaming `spawn` (`packages/shared/src/platform/exec.ts:207`; `windowsHide` default per command-executor) — never `execFileAsync`, which buffers. `exec` uses `stdio: "inherit"` and propagates the exit code: nothing to parse, nothing to drift when upstream adds commands.
`mcp` resolves the binary first (all diagnostics to stderr, stdout untouched), then spawns `photocraft-cli mcp --automation-read-root R --automation-write-root R` with piped stdin and inherited stdout/stderr. The wrapper reads client stdin line by line (MCP stdio = newline-delimited JSON-RPC): non-`tools/call` messages are written through immediately; `tools/call` requests go through a FIFO queue — one in flight at a time, released when a response with that `id` is seen on the server's stdout (so stdout is piped too and copied through after inspection; lines that do not parse as JSON go to stderr so they cannot corrupt the channel). This removes the spike-observed race regardless of whether the client (or a model issuing parallel tool calls) pipelines requests. Signals: SIGINT/SIGTERM → `child.kill()` (repo convention: signal own children via `ChildProcess#kill`; photocraft-cli spawns no grandchildren) → exit `130`/`143` (a signal-killed child has no exit code).
*Alternative:* document "call sequentially" in the skill only — rejected: pi may execute a model's parallel tool calls concurrently, and the failure ("no document open") is confusing.

### D6 — `--register` writes an absolute launcher, no `--root`
S3 settled the cwd question: pi starts project stdio servers with the session directory as cwd, and only loads `.pi/mcp.json` when that directory is the project root — so `pi-photocraft mcp`'s default root (cwd) is the project root, and `--root` is unnecessary in the registered entry. PATH lookup of a bare command works, but a bare `pi-photocraft` is not guaranteed on PATH (pi's `~/.pi/agent/npm/node_modules/.bin` is not on it by default), so the entry is `{"command": process.execPath, "args": ["<abs path of bin/pi-photocraft launcher>", "mcp"]}`. Cost: machine-specific if `.pi/mcp.json` is committed, inert until trusted, inert when pi starts in a subdirectory — the CLI prints all three notes and the skill repeats them. When the cwd contains neither `.git` nor `.pi/`, `--register` still writes but prints an explicit "this does not look like a project root" warning (heuristic; registering from a subdirectory is the likely mistake). Read-modify-write with a JSON parse; a malformed file aborts untouched.

### D7 — `replace-region` pipeline (nano-banana as a subprocess)

```mermaid
sequenceDiagram
  participant R as replace-region
  participant P as photocraft-cli run
  participant N as pi-nano-banana (subprocess)
  R->>P: info <input> → width,height
  alt --select
    R->>P: run input: select.<x> → out tmp/probe.png (JSON bounds, selected, coverage)
  end
  R->>R: validate · region box → crop (pad → grow to min-crop → clip)
  R->>P: run input: image.crop{crop} → tmp/crop.png
  R->>N: spawn pi-nano-banana launcher: prompt --file tmp/crop.png --output tmp/gen.png (any size; Gemini returns 1024²)
  R->>P: run tmp/gen.png: image.imageSize{cropW,cropH} → tmp/patch.png
  R->>P: run input: [--mask selection & --select: select.<x> + select.saveSelection{"pc_region"} + select.deselect]<br/>+ file.placeEmbedded{tmp/patch.png, fit:false, scale:100, center:crop centre}<br/>+ (crop: select.rect{crop inset by pad−feather, feather} | selection: select.rect{region,feather} or select.loadSelection{"pc_region"} + select.modify.feather)<br/>+ layer.layerMask.revealSelection → tmp/comp.psd
  R->>P: convert tmp/comp.psd tmp/out.<ext>
  R->>R: rename tmp/out → --out ; copy tmp/comp.psd → --layered (both only after all steps succeed)
```

- **Default mask = inset crop rect; the selection only locates (S2).** A replacement is rarely the same shape as the original; masking with the original's outline clips the new object and leaves remnants of the old one. The crop inset by `pad − feather` (24 px at defaults) shows the whole patch while the feather blends into the outer band, which Gemini leaves nearly untouched (S2: mean drift 2.2/255). `--mask selection` remains for in-place edits that keep the outline (recolour, texture). Sides clipped by the image edge get inset 0, so a region touching the border is still covered.
- **Selection never crosses a process boundary.** The probe run only reads bounds; the composite run re-issues the same deterministic selector (verified identical bounds) and saves/loads the channel inside that single run — the one persistence the spike proved.
- **Always resize to the crop size, place at 100 %.** Handles non-uniform aspect from the generator with one resample (placing at a computed `scale` would resample too).
- **One composite, two outputs.** The unflattened composite is saved once as `.psd`; `convert` produces the flat output (verified byte-equal to in-run flatten). Outputs are staged next to their destination and atomically renamed only at the end, so a late failure creates nothing and never touches a pre-existing `--out` — no double composite, no partial state.
- **Feather vs pad.** Measured feather reach ≈ 2.5× radius, and the patch layer ends at the crop edge, so a feather wider than the pad would be cut to a hard edge. Usage rule `pad ≥ 3 × feather` (defaults 32 / 8 pass).
- **Locality guarantee = outside the crop box.** That is what the spike proved byte-exact; the pad band legitimately blends.
- **Bounds normalisation.** One helper converts `[x0,y0,x1,y1]` (placeEmbedded) ↔ `{x,y,w,h}` (`select.*`).
- **Temp dir in `os.tmpdir()`.** `run` has no path roots, so absolute temp paths work; keeps intermediates out of git, kb indexing and file watchers.
- **Generator call = subprocess, not a library import.** A published photocraft cannot import nano-banana's raw-TS sources from `node_modules` (S2/S3 side finding). It resolves `createRequire(import.meta.url).resolve("@blackbelt-technology/pi-dashboard-nano-banana/package.json")` — valid from `src/` in a checkout and from the bundled `dist/` in an install — and joins the package dir with the `bin.pi-nano-banana` entry read from that `package.json` (the D10 launcher) and runs `process.execPath <launcher> <prompt> --file crop --output gen [--model] [--flash] [--backend]` via shared `execFileAsync` (output is short). Success = exit 0 and the output file exists; failure = exit ≠ 0 with nano-banana's stderr forwarded under the `generate` step. Key resolution stays inside nano-banana (env / `.env`, never logged here). `model` in the report = the `--model` passed or the one nano-banana prints on the pi path, else `null`.

### D9 — `pi-photocraft` launcher + bundled `dist` (deck3d pattern)
`bin/pi-photocraft` is an extensionless plain-JS launcher copied from `packages/deck3d/bin/deck3d`: in a checkout (tsx resolvable and `src/bin/photocraft.ts` present) it runs `node --import tsx src/bin/photocraft.ts`; in a published install it runs `node dist/photocraft.js`; else it exits 1 naming the build step. Signals and the exit code pass through. `scripts/build.mjs` (esbuild, modelled on `packages/deck3d/scripts/build-cli.mjs` but NOT a verbatim copy: deck3d's `packages: "external"` would externalize `@blackbelt-technology/pi-dashboard-shared`, which is raw TS and breaks once installed) bundles `src/bin/photocraft.ts` **including** `@blackbelt-technology/*` workspace code via an explicit `external` list of real npm deps only; it runs in `prepack` (not `prepublishOnly` — `scripts/verify-published-imports.mjs` uses `npm pack --dry-run`, which runs prepack only). `dist/` is gitignored and listed in `files`. The launcher is outside the `.ts`/`.tsx` walk of `no-direct-child-process.test.ts`, like deck3d's.

### D10 — Same launcher fix for `pi-nano-banana` (folded in)
photocraft depends on a runnable `pi-nano-banana`, which is broken today in every shell. Apply D9 unchanged to `packages/nano-banana`: `bin/pi-nano-banana` launcher, esbuild `dist/nano-banana.js` (bundle its own sources; `@the-focus-ai/nano-banana` stays an `npx` subprocess; `@earendil-works/pi-coding-agent` stays an external dynamic import), `prepack` build, `package.json` `bin` repointed, and the HOME tripwire (`setup-home.ts` + `setup-home-perfile.ts`) added to `packages/nano-banana/vitest.config.ts`, which lacks it today and now gains packaging tests. Library consumers (`packages/video-production` importing `generateImage`) are unaffected — they import `src/*.ts` through the existing `exports` map under jiti. Other raw-TS bins (`pi-transcribe`, `pi-veo`, …) are out of scope; noted for a follow-up change.



### D8 — Package registrations mirror nano-banana, not the dashboard-plugin checklist
No client/server code → no `BUNDLED_PLUGINS`, plugin registry, Tailwind `@source`, route tiers. Only publish allowlist (after nano-banana, its dep), vitest project, knip workspace, recommended manifest entry, README + `publishConfig.access: public`.

## Risks / Trade-offs

- [Upstream renames a command id used by `replace-region` on a new "latest"] → the ids are core Photoshop-parity commands; the failing step is reported with the binary's error; `PHOTOCRAFT_VERSION` rolls back; a contract test (scenario-design fold) runs the pipeline against the real binary.
- [Windows CLI turns out to need files beside the exe] → D2 keeps the extracted tree (DLLs, data) but always deletes the desktop executable itself; the L2 `.ps1` run is the check.
- [Gemini draws the replacement larger than the inset box] → the inset box covers the crop minus `pad − feather`; the region is padded by `--pad`, so an object up to `pad − feather` larger per side still shows whole. Larger growth is clipped at the feathered edge — `--pad` raises the margin; layered output allows a manual fix.
- [Downgrade/replay of an old release] → same-origin sums can't detect it; "latest" resolution always picks the newest tag, and `PHOTOCRAFT_VERSION` + `PHOTOCRAFT_BIN` are the documented high-assurance path.
- [Malicious/compromised upstream release] → same-origin checksum cannot detect it. Accepted with "latest" (user decision); pin + `PHOTOCRAFT_BIN` documented for high-assurance setups.
- [Linux CLI needs display libraries on a headless box] → unverified; first L2 run in the docker harness answers it; failure surfaces as the binary's own loader error via `exec`.
- [Large downloads on metered links] → only on first use/version change; `ensure` prints the size before downloading.
- [Gemini alters lighting at the patch edge] → feather + pad context mitigate; layered output lets the user fix by hand.
- [MCP server process left running] → child is killed on parent signal; stdio EOF ends the server.

## Migration Plan

New package; nothing to migrate. Deploy = publish + manifest entry. Rollback = deprecate the npm version and drop the manifest entry; users delete `<pi agent dir>/tools/photocraft`.

## Open Questions

- Whether the Windows CLI needs DLLs beside the exe (D2 keeps the tree; the L2 `.ps1` run answers it).
- Whether other raw-TS bins (`pi-transcribe`, `pi-veo`, …) should get the D9 launcher — separate follow-up change.
