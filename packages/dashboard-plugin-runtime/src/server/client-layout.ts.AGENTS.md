# client-layout.ts — index

`evaluateClientLayout({packageDir, clientBundle, clientStyles, server, bridge})` → `{clientBundlePath, clientBundleDir, clientStylesPath, clientLayoutError}`. Pure path check: asset root (dir of `clientBundle`) must be dedicated — not package root, not outside package, no server/bridge entry inside, `clientStyles` inside it; violation sets `clientLayoutError` (loader logs, status `no-bundle`). See change: decouple-plugins-from-core (task 6.1, D10, R25).
