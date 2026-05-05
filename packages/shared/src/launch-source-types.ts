/**
 * LaunchSource — discriminated union describing how the dashboard server was (or should be) started.
 *
 * "attach"      — a server is already running; Electron attaches to it.
 * "devMonorepo" — running from a checked-out monorepo (dev workflow).
 * "piExtension" — the pi bridge extension owns a server package in node_modules.
 * "npmGlobal"   — `pi-dashboard` is installed globally via npm.
 * "extracted"   — bundled Electron resources provide the server (managed install).
 */

export type SourceKind = "attach" | "devMonorepo" | "piExtension" | "npmGlobal" | "extracted";

export type LaunchSource =
  | { kind: "attach"; url: string; starter: "Bridge" | "Standalone" | "Electron" }
  | { kind: "devMonorepo"; cliPath: string; cwd: string }
  | { kind: "piExtension"; cliPath: string; cwd: string }
  | { kind: "npmGlobal"; cliPath: string; cwd: string }
  | { kind: "extracted"; cliPath: string; cwd: string; didExtract?: boolean };
