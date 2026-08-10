# fix-pty-permissions.ts — index

Runtime fix for node-pty spawn-helper exec bit. Exports `fixPtyPermissions` (no-op on Windows / already fixed; resolves `node-pty` via `createRequire`, `chmod 0o755` each `prebuilds/*/spawn-helper` lacking `0o111`). Called once at terminal-manager creation; silent skip when node-pty unresolvable. Fixes Electron-bundle hoisting that skips postinstall.
