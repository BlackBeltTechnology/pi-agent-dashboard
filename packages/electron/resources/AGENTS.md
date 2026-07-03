# DOX — packages/electron/resources

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `dirname-shim.js` | ESM global shim loaded via `node --import`. Defines `globalThis.__dirname` (returns `process.cwd()`) + `globalThis.__filename` fallback for CJS deps (node-pty) loaded as ESM. |
