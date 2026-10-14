# @blackbelt-technology/pi-dashboard-photocraft

Headless [PhotoCraft](https://github.com/storytold/photocraft) image editing for pi agents. Provisions the
`photocraft-cli` binary on first use (no desktop app), exposes it to agents over **bash** and a
**project-confined stdio MCP server**, and adds `replace-region` — pixel-exact generative
part-replacement combined with `pi-nano-banana`.

Standalone pi package (skill + CLI). No dashboard client/server code.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-photocraft
```

Ships the `photocraft` skill and the `pi-photocraft` bin (plain-JS launcher over an esbuild bundle —
it runs from a plain shell, including an agent's bash tool). Depends on
`@blackbelt-technology/pi-dashboard-nano-banana` for `replace-region`.

## CLI

| Command | What it does |
|---|---|
| `pi-photocraft ensure` | Provision the binary; print a JSON report (`version`, `source`, `asset`, `cacheHit`, `binary`, `durationMs`, macOS `gatekeeper`). |
| `pi-photocraft path` | Provision; print only the absolute binary path. |
| `pi-photocraft exec <args…>` | Run `photocraft-cli <args…>` verbatim (argument vector, streamed stdio, exit code propagated). |
| `pi-photocraft mcp [--root <dir>]` | Stdio MCP server confined to `<dir>` (default: cwd) for reads **and** writes; `tools/call` requests are forwarded one at a time. |
| `pi-photocraft mcp --register` | Opt-in: add a `photocraft` entry (absolute paths) to the project's `.pi/mcp.json`. |
| `pi-photocraft replace-region <input> …` | Crop → `pi-nano-banana` → composite back. See `--help` and the skill. |

Exit codes: `0` success · `1` usage error or failed edit · `69` provisioning failure. `exec` returns the binary's
own exit code (which may overlap `1`/`69`).

### MCP notes

- pi loads project MCP servers only for a **trusted** project and only when pi starts in the **project root**.
- The `--register` entry is machine-specific (absolute paths) — don't commit it for a team.
- Paths passed to `doc_open`/`doc_save` must lie under the root.

## Environment

| Variable | Effect |
|---|---|
| `PHOTOCRAFT_VERSION` | Pin a release (`v0.7.0` or `0.7.0`) instead of following latest — the rollback lever. |
| `PHOTOCRAFT_BIN` | Use this binary; skip provisioning entirely (air-gapped / self-built). |
| `PHOTOCRAFT_HOME` | Cache root (default `<pi agent dir>/tools/photocraft`; `PI_CODING_AGENT_DIR` or `~/.pi/agent`). |
| `GITHUB_TOKEN` | Bearer token for the GitHub API (avoids the 60 req/h anonymous limit). |

"Latest" is resolved at most once per 24 h (`latest.json` in the cache); when the lookup fails the highest
installed version is used with a warning. Command ids can change between releases — the skill is discovery-first.

Platforms: macOS (arm64/x64, universal zip), Linux x64/arm64/riscv64 (**glibc ≥ 2.35**; not musl), Windows
x64/arm64/x86 portable zip, FreeBSD x64. The desktop executable is deleted after extraction.

## Security notes

- The binary is verified against the release's `SHA256SUMS.txt` (fail closed). That is the **same origin** as the
  asset: it detects corruption and CDN tampering, **not** a compromised upstream release or a downgrade.
- High-assurance setups: build or vet `photocraft-cli` yourself, then set `PHOTOCRAFT_BIN` (and/or pin
  `PHOTOCRAFT_VERSION`).
- Archives are listed before extraction; absolute paths, `..` segments, symlinks, hard links and special files abort
  the install. Extraction happens in a staging directory and is moved into place atomically.
- macOS: `spctl --assess --type install` is recorded as `gatekeeper` (advisory; a rejection only warns).
- The MCP server is never started with unrestricted path access and never attaches to a desktop app.

## Development

```bash
npm test -w @blackbelt-technology/pi-dashboard-photocraft          # unit + packaging (fake release server)
# real binary (no Gemini call is made — the generator is stubbed); E35 also downloads the latest release
PHOTOCRAFT_E2E=1 PHOTOCRAFT_BIN=/path/to/photocraft-cli npx vitest run --project @blackbelt-technology/pi-dashboard-photocraft real-binary
node scripts/build.mjs                                              # dist/photocraft.js (also runs on prepack)
```
