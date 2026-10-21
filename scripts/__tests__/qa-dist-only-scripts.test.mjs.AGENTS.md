# qa-dist-only-scripts.test.mjs — index

Contract guards for `qa/tests/47..51-*.sh` + `qa/tests/dist-only-lib.sh` (need a clean VM; this runs everywhere).
- `bash -n` on lib, 08, 47–51.
- `run-all.sh` registers 47–51 in numeric order.
- Every `do_*`/helper a script calls is defined in the lib (or locally).
- Each script names its test-plan id.
- 47 prints `SKIP:` first + exit 0 without `QA_CANARY_DIR`.
- 48 probes the mount by body marker, not 404.
- Lib `jx` and `dist_digest` (changes with a `dist/` mtime, stable otherwise).
- #E103 static half: `BUNDLED_WORKSPACE_PKGS` (parsed from `packages/electron/scripts/bundle-server.mjs`) has `mcp-core`, all real packages; 08 asserts mcp-core, importmap, `/host/react.js`, delivery bundled.

See change: decouple-plugins-from-core (7.8, 8.103, 8.138, 8.140–8.143).
