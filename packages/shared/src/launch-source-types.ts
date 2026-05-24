/**
 * LaunchSource — discriminated union describing how the dashboard server was (or should be) started.
 *
 * "attach"      — a server is already running; Electron attaches to it.
 * "bundled"     — bundled Electron resources provide the server (immutable .app/Contents/Resources tree).
 * "devMonorepo" — running from a checked-out monorepo (dev workflow only, gated by ELECTRON_DEV).
 *
 * Pre-R3 layouts (`piExtension`, `npmGlobal`, `extracted`) are removed:
 * the immutable bundle is the only runtime layout under packaged Electron.
 * See change: eliminate-electron-runtime-install.
 */

export type SourceKind = "attach" | "bundled" | "devMonorepo";

export type LaunchSource =
  | { kind: "attach"; url: string; starter: "Bridge" | "Standalone" | "Electron" }
  | { kind: "bundled"; cliPath: string; cwd: string }
  | { kind: "devMonorepo"; cliPath: string; cwd: string };
