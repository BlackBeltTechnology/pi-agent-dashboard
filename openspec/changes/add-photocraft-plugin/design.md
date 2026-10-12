## Context

See proposal.md — Why. Constraints that shape the design:

- Precedent package shape: `packages/nano-banana` — standalone pi package, `pi.skills` + `bin` pointing at a `.ts` file, `exports: {"./*.js": "./src/*.ts"}`, no build step (`packages/nano-banana/package.json`). Library reuse precedent: `packages/video-production/package.json:75` depends on `@blackbelt-technology/pi-dashboard-nano-banana` and calls `generateImage` (`packages/video-production/src/storyboard.ts`).
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

## Goals / Non-Goals

**Goals:** zero-setup headless PhotoCraft on every platform the upstream release covers; one deterministic `replace-region` that hides coordinate maths from the agent; both bash and MCP routes; failure modes that are loud and leave no partial state.

**Non-Goals:** desktop app install/launch or `--bridge` to a running app; a dashboard UI or server route; wrapping PhotoCraft's 858 commands in typed tools (the registry is self-describing); switching versions inside a running invocation (each invocation resolves once; a long-lived MCP server keeps its version); Windows Authenticode verification; release authenticity beyond same-origin checksums.

## Decisions

### D1 — "Latest" with a 24 h lookup cache, pin as escape hatch
User decision: follow latest. Resolve `GET /repos/storytold/photocraft/releases/latest` (excludes prereleases/drafts), cache `{tag, checkedAt}` in `<cache root>/latest.json` for 24 h. Unauthenticated GitHub API = 60 req/h/IP; the cache keeps us far below it, and `GITHUB_TOKEN` is used when present. `PHOTOCRAFT_VERSION` pins (rollback lever), `PHOTOCRAFT_BIN` skips provisioning entirely (air-gapped/self-built).
*Alternative:* pin a version + digest in the package — rejected by the user; kept reachable via the env pin.

### D2 — Keep the whole extracted bundle, not just the binary
Copying only the binary out of the Linux/Windows bundles assumes the CLI is self-contained. The macOS CLI zip suggests it is (binary + licences only), but this is unverified for Linux/Windows (shared libs, data dirs next to the exe). Keeping the extracted tree in `<cache root>/<version>/` and returning the path to the binary inside it costs ~150 MB of disk and removes the question. Archives are deleted after extraction.

### D3 — Extraction with system tools, guarded
No new npm dependency; all calls through `execFileAsync` (`packages/shared/src/platform/exec.ts:248`). Listing uses `tar -tvf <archive>` on every platform (bsdtar reads zip and tar.gz; Windows 10+ ships bsdtar as `tar.exe`): reject before extraction any entry that is absolute, has a `..` segment, or whose type column is not `-`/`d` (symlink, hardlink, device, fifo). Extraction: `ditto -x -k` on macOS (preserves the notarization-relevant attributes), `tar -xf` elsewhere. Staging dir is `<cache root>/.staging-<pid>-<rand>` (same volume as the target, so `rename` is atomic); the download is written inside it, so one removal cleans both. Staging dirs older than 1 h (killed runs) are swept at the start of a provisioning run. A cache hit is validated (regular, non-empty, executable binary) — a damaged entry is removed and re-provisioned. Final step `rename(staging, <cache root>/<version>)`; on `EEXIST`/`ENOTEMPTY`/`EPERM` (a concurrent winner, or Windows handle contention) re-validate the existing `<version>/` binary — valid → remove our staging and use it; invalid → fail with the original error. No lock files.
*Alternative:* `adm-zip`/`tar` npm packages — rejected (dependency weight, and own traversal pitfalls).

### D4 — Checksum fails closed; Gatekeeper is advisory
SHA256SUMS is same-origin, so it proves integrity (no truncated/corrupted download, no CDN tampering after publish) — not authenticity. That is the strongest check the release offers for Linux/Windows. On macOS we run `spctl --assess --type install` and record the result; rejection → warning only, because first-run notarization checks need network and would make offline cache hits flaky. Download is streamed to a temp file while hashing (no 77 MB in memory).

### D5 — `exec` is a transparent pass-through; MCP is a thin serializing supervisor
Both use the shared streaming `spawn` (`packages/shared/src/platform/exec.ts:207`; `windowsHide` default per command-executor) — never `execFileAsync`, which buffers. `exec` uses `stdio: "inherit"` and propagates the exit code: nothing to parse, nothing to drift when upstream adds commands.
`mcp` resolves the binary first (all diagnostics to stderr, stdout untouched), then spawns `photocraft-cli mcp --automation-read-root R --automation-write-root R` with piped stdin and inherited stdout/stderr. The wrapper reads client stdin line by line (MCP stdio = newline-delimited JSON-RPC): non-`tools/call` messages are written through immediately; `tools/call` requests go through a FIFO queue — one in flight at a time, released when a response with that `id` is seen on the server's stdout (so stdout is piped too and copied through after inspection; lines that do not parse as JSON go to stderr so they cannot corrupt the channel). This removes the spike-observed race regardless of whether the client (or a model issuing parallel tool calls) pipelines requests. Signals: SIGINT/SIGTERM → `child.kill()` (repo convention: signal own children via `ChildProcess#kill`; photocraft-cli spawns no grandchildren) → exit `130`/`143` (a signal-killed child has no exit code).
*Alternative:* document "call sequentially" in the skill only — rejected: pi may execute a model's parallel tool calls concurrently, and the failure ("no document open") is confusing.

### D6 — `--register` writes absolute paths
Neither "pi starts project MCP servers in the project cwd" nor "a pi package's bin is on PATH" is documented. The entry therefore is `{"command": process.execPath, "args": ["<abs path of src/bin/photocraft.ts>", "mcp", "--root", "<abs project dir>"]}` — Node ≥ 22.6 runs the `.ts` entry by type stripping, as the `#!/usr/bin/env node` shebang on `packages/nano-banana/src/bin/nano-banana.ts:1` already relies on. Cost: machine-specific if `.pi/mcp.json` is committed, and inert until the project is trusted — the CLI prints both notes. Read-modify-write with a JSON parse; a malformed file aborts untouched.
*Trade-off accepted:* default `--root` for an unregistered `pi-photocraft mcp` stays the cwd (printed to stderr) — discovering a "project root" upward would guess too.

### D7 — `replace-region` pipeline (library call to nano-banana)

```mermaid
sequenceDiagram
  participant R as replace-region
  participant P as photocraft-cli run
  participant N as generateImage (nano-banana lib)
  R->>P: info <input> → width,height
  alt --select
    R->>P: run input: select.<x> → out tmp/probe.png (JSON bounds, selected, coverage)
  end
  R->>R: validate · region box → crop (pad → grow to min-crop → clip)
  R->>P: run input: image.crop{crop} → tmp/crop.png
  R->>N: prompt + file tmp/crop.png → tmp/gen.png (any size)
  R->>P: run tmp/gen.png: image.imageSize{cropW,cropH} → tmp/patch.png
  R->>P: run input: [select.<x> + select.saveSelection{"pc_region"} + select.deselect]<br/>+ file.placeEmbedded{tmp/patch.png, fit:false, scale:100, center:crop centre}<br/>+ (select.rect{region,feather} | select.loadSelection{"pc_region"} + select.modify.feather)<br/>+ layer.layerMask.revealSelection → tmp/comp.psd
  R->>P: convert tmp/comp.psd tmp/out.<ext>
  R->>R: rename tmp/out → --out ; copy tmp/comp.psd → --layered (both only after all steps succeed)
```

- **Selection never crosses a process boundary.** The probe run only reads bounds; the composite run re-issues the same deterministic selector (verified identical bounds) and saves/loads the channel inside that single run — the one persistence the spike proved.
- **Always resize to the crop size, place at 100 %.** Handles non-uniform aspect from the generator with one resample (placing at a computed `scale` would resample too).
- **One composite, two outputs.** The unflattened composite is saved once as `.psd`; `convert` produces the flat output (verified byte-equal to in-run flatten). Outputs are staged next to their destination and atomically renamed only at the end, so a late failure creates nothing and never touches a pre-existing `--out` — no double composite, no partial state.
- **Feather vs pad.** Measured feather reach ≈ 2.5× radius, and the patch layer ends at the crop edge, so a feather wider than the pad would be cut to a hard edge. Usage rule `pad ≥ 3 × feather` (defaults 32 / 8 pass).
- **Locality guarantee = outside the crop box.** That is what the spike proved byte-exact; the pad band legitimately blends.
- **Bounds normalisation.** One helper converts `[x0,y0,x1,y1]` (placeEmbedded) ↔ `{x,y,w,h}` (`select.*`).
- **Temp dir in `os.tmpdir()`.** `run` has no path roots, so absolute temp paths work; keeps intermediates out of git, kb indexing and file watchers.
- **Generator call.** `generateImage({prompt, file, output, model, flash, backend})` — key resolution stays inside nano-banana (env / `.env`, never logged here); `backend: "pi"` builds its own `ModelRuntime` in this CLI process (not inside a pi session). Result `model` is reported, `null` when absent (gemini path).

### D8 — Package registrations mirror nano-banana, not the dashboard-plugin checklist
No client/server code → no `BUNDLED_PLUGINS`, plugin registry, Tailwind `@source`, route tiers. Only publish allowlist (after nano-banana, its dep), vitest project, knip workspace, recommended manifest entry, README + `publishConfig.access: public`.

## Risks / Trade-offs

- [Upstream renames a command id used by `replace-region` on a new "latest"] → the ids are core Photoshop-parity commands; the failing step is reported with the binary's error; `PHOTOCRAFT_VERSION` rolls back; a contract test (scenario-design fold) runs the pipeline against the real binary.
- [Bundle on disk contains the desktop `photocraft` executable (Linux/Windows)] → kept for possible shared libraries (D2) but never executed; only the CLI path is ever returned.
- [Downgrade/replay of an old release] → same-origin sums can't detect it; "latest" resolution always picks the newest tag, and `PHOTOCRAFT_VERSION` + `PHOTOCRAFT_BIN` are the documented high-assurance path.
- [Malicious/compromised upstream release] → same-origin checksum cannot detect it. Accepted with "latest" (user decision); pin + `PHOTOCRAFT_BIN` documented for high-assurance setups.
- [Linux CLI needs display libraries on a headless box] → unverified; first L2 run in the docker harness answers it; failure surfaces as the binary's own loader error via `exec`.
- [Large downloads on metered links] → only on first use/version change; `ensure` prints the size before downloading.
- [Gemini alters lighting at the patch edge] → feather + pad context mitigate; layered output lets the user fix by hand.
- [MCP server process left running] → child is killed on parent signal; stdio EOF ends the server.

## Migration Plan

New package; nothing to migrate. Deploy = publish + manifest entry. Rollback = deprecate the npm version and drop the manifest entry; users delete `<pi agent dir>/tools/photocraft`.

## Open Questions

- Whether pi starts project MCP servers in the project cwd, and whether package bins land on PATH (D6 sidesteps both; could simplify `--register` later).
- Whether the Linux/Windows CLI is fully self-contained (D2 sidesteps it; could later shrink the cache).
