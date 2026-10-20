# remote-browse-confinement.spec.ts — index

L3: the harness browser is a remote peer (Docker port mapping, not loopback). Add-folder picker: typing `/` → plain-language refusal (`path-picker-outside-roots`, raw `path outside allowed roots` absent); Back to home → `path-picker-confined-hint`, no `..` row. Skips when `GET /api/browse?path=/` is not 403 (peer classified local). See change: harden-server-capability-bounds. Variant harness: skips unless `PI_E2E_BROWSE_CONFINEMENT=1` (harness seeds confinement off by default). Runs on the `e2e-bounds-variants` CI leg (matrix `browse-confinement`).
