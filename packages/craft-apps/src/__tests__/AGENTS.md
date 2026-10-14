# DOX — packages/photocraft/src/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `cli.test.ts` | Dispatch + exit codes, `path`/`ensure` output, `exec` argv/streaming/exit propagation (subprocess with stub `PHOTOCRAFT_BIN`), no implicit `.pi/mcp.json` (E13–E17, E21, X2b). |
| `helpers/fixtures.ts` | Fake GitHub release server (`startFixture`: latest/tags/assets/sums, 403, truncation, delay), tar.gz/crafted hostile archive builders, tmp-dir tracking. No network, no real HOME. |
| `helpers/paths.ts` | `CLI` (absolute `src/bin/photocraft.ts`) + `TSX` (absolute loader) for subprocess tests; kept out of test files so the source-reading `@structural-pin` lint does not misfire. |
| `helpers/png.ts` | Tiny 8-bit PNG encoder/decoder + `scene()` for pixel assertions in real-binary tests. |
| `helpers/provision-child.ts` | Child process for the concurrent-install test (X7). |
| `helpers/stubs.ts` | Executable node-script stubs: argv echo, fake MCP server (arrival/send log, delay, noise, hang). |
| `mcp-proxy.test.ts` | Root translation, option rejection, provisioning failure (stdout clean), serialization order, non-JSON stdout → stderr, SIGTERM/SIGINT → 143/130 (E18, E19, X10, X11, F1, F3). |
| `mcp-register.test.ts` | `.pi/mcp.json` create / merge / replace / malformed / no-project-marker warning (E20). |
| `packaging.test.ts` | `npm pack` → extract → bin runs with no TS loader (`--help`, `ensure` with override stub); skill shipped; workspace bin symlinks start (E23, E43, E45). |
| `provision.test.ts` | Provisioning against the fixture server: precedence, pin, 24 h cache, token, asset table, libc gate, sums parse, listing guard, hostile archives, races, interrupted download, staging sweep, fallbacks (E1–E12, E41, E46, X1–X9). |
| `real-binary.test.ts` | Real `photocraft-cli` + stub generator, gated `PHOTOCRAFT_E2E`: locality, resolution, layered output, selectors, masks, MCP through the wrapper, real release provisioning (E29–E35, E39, E40, F2). |
| `region-replace.test.ts` | Argument validation, geometry, composite command lists, report/temp lifecycle, generator subprocess + launcher resolution, failure semantics with injected runner (E24–E28, E38, E42, E47, X12–X15). |
