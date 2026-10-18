/**
 * Shared fixture for the Add-ons hub route tests (catalog + toggle).
 * Builds a throwaway $HOME with a global settings file, plugin config, plugin
 * packages (discovered through `repoRoot`) and installed package directories,
 * and mounts `registerAddonsRoutes` with a fake package-manager wrapper.
 *
 * See change: addons-hub-feature-catalog.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache, clearStatusStore } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import { PackageOperationBusyError } from "../package/package-manager-wrapper.js";
import { registerAddonsRoutes } from "../routes/addons-routes.js";
import { registerPluginActivationRoutes, setPluginsEnabled } from "../routes/plugin-activation-routes.js";

export interface RawRow {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
}

export interface PluginSpec {
  id: string;
  displayName?: string;
  packageName?: string;
  requires?: string[];
  dependsOn?: string[];
  bridge?: boolean;
  enabled?: boolean;
}

export interface AppOptions {
  knownDirs?: string[];
  setPluginsEnabled?: typeof setPluginsEnabled;
  writeSettingsText?: (file: string, text: string) => void;
  lookupNpm?: (name: string) => Promise<{ version?: string } | null>;
  /** Also mount the plain plugin routes (for the concurrency test). */
  withPluginRoutes?: boolean;
}

export class AddonsEnv {
  readonly home: string;
  readonly repoRoot: string;
  readonly agentDir: string;
  readonly settingsFile: string;
  readonly restoreFile: string;
  readonly configFile: string;
  readonly rows: RawRow[] = [];
  readonly logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  readonly broadcasts: unknown[] = [];
  busy = false;
  app?: FastifyInstance;
  private originalHome: string | undefined;
  private pluginConfig: Record<string, { enabled: boolean }> = {};

  constructor(name: string) {
    this.home = path.join(os.tmpdir(), `addons-hub-${name}-${process.pid}-${Date.now()}`);
    this.repoRoot = path.join(this.home, "repo");
    this.agentDir = path.join(this.home, ".pi", "agent");
    this.settingsFile = path.join(this.agentDir, "settings.json");
    this.restoreFile = path.join(this.home, ".pi", "dashboard", "addon-toggle-restore.json");
    this.configFile = path.join(this.home, ".pi", "dashboard", "config.json");
    fs.rmSync(this.home, { recursive: true, force: true });
    fs.mkdirSync(this.agentDir, { recursive: true });
    fs.mkdirSync(path.join(this.repoRoot, "packages"), { recursive: true });
    this.originalHome = process.env.HOME;
    process.env.HOME = this.home;
    clearDiscoveryCache();
    clearStatusStore();
  }

  /** Write `~/.pi/agent/settings.json`. */
  writeSettings(json: unknown): void {
    fs.writeFileSync(this.settingsFile, typeof json === "string" ? json : `${JSON.stringify(json, null, 2)}\n`);
  }

  readSettings(): { packages: unknown[]; [k: string]: unknown } {
    return JSON.parse(fs.readFileSync(this.settingsFile, "utf-8"));
  }

  readRestore(): { records: Record<string, { original: unknown; filtered: unknown; identity: string }> } | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.restoreFile, "utf-8"));
    } catch {
      return undefined;
    }
  }

  readPluginConfig(): Record<string, { enabled?: boolean }> {
    try {
      return JSON.parse(fs.readFileSync(this.configFile, "utf-8")).plugins ?? {};
    } catch {
      return {};
    }
  }

  addPlugin(spec: PluginSpec): void {
    const dir = path.join(this.repoRoot, "packages", spec.id);
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Record<string, unknown> = { id: spec.id, displayName: spec.displayName ?? spec.id, claims: [] };
    if (spec.requires) manifest.requires = { piExtensions: spec.requires };
    if (spec.dependsOn) manifest.dependsOn = spec.dependsOn;
    if (spec.bridge) {
      manifest.bridge = "bridge.ts";
      fs.writeFileSync(path.join(dir, "bridge.ts"), "export default {};\n");
    }
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: spec.packageName ?? `@test/${spec.id}`,
        version: "0.0.0",
        "pi-dashboard-plugin": manifest,
      }),
    );
    this.pluginConfig[spec.id] = { enabled: spec.enabled ?? true };
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    fs.writeFileSync(this.configFile, JSON.stringify({ plugins: this.pluginConfig }, null, 2));
  }

  bridgePath(id: string): string {
    return path.join(this.repoRoot, "packages", id, "bridge.ts");
  }

  /** Register an installed global package (row + on-disk package.json). */
  addPackage(source: string, opts: { name?: string; dir?: string } = {}): string {
    const dir = opts.dir ?? path.join(this.home, "pkgs", (opts.name ?? source).replace(/[^\w.@-]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    if (opts.name) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: opts.name, version: "1.0.0" }));
    this.rows.push({ source, scope: "user", filtered: false, installedPath: dir });
    return dir;
  }

  /** Write a known folder's `.pi/settings.json`. */
  writeFolderSettings(dir: string, json: unknown): void {
    fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pi", "settings.json"), typeof json === "string" ? json : JSON.stringify(json));
  }

  async makeApp(opts: AppOptions = {}): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    const logs = this.logs;
    registerAddonsRoutes(app, {
      networkGuard: async () => undefined,
      packageManagerWrapper: {
        listInstalled: async () => this.rows as never,
        runExclusive: async (fn) => {
          if (this.busy) throw new PackageOperationBusyError();
          this.busy = true;
          try {
            return await fn();
          } finally {
            this.busy = false;
          }
        },
      },
      broadcast: (m) => this.broadcasts.push(m),
      repoRoot: this.repoRoot,
      knownDirectories: () => opts.knownDirs ?? [],
      lookupNpm: opts.lookupNpm ?? (async () => null),
      agentDir: () => this.agentDir,
      setPluginsEnabled: opts.setPluginsEnabled ?? setPluginsEnabled,
      writeSettingsText: opts.writeSettingsText,
      log: {
        info: (m) => logs.info.push(m),
        warn: (m) => logs.warn.push(m),
        error: (m) => logs.error.push(m),
      },
    });
    if (opts.withPluginRoutes) {
      registerPluginActivationRoutes(app, {
        networkGuard: async () => undefined,
        broadcast: (m) => this.broadcasts.push(m),
        repoRoot: this.repoRoot,
      });
    }
    await app.ready();
    this.app = app;
    return app;
  }

  async toggle(featureId: string, body: Record<string, unknown>) {
    const res = await (this.app as FastifyInstance).inject({
      method: "POST",
      url: `/api/addons/${encodeURIComponent(featureId)}/toggle`,
      payload: body,
    });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  }

  async catalog() {
    const res = await (this.app as FastifyInstance).inject({ method: "GET", url: "/api/addons/catalog" });
    return { status: res.statusCode, body: res.json() as { success: boolean; features: any[] } };
  }

  async cleanup(): Promise<void> {
    await this.app?.close();
    if (this.originalHome !== undefined) process.env.HOME = this.originalHome;
    else delete process.env.HOME;
    fs.rmSync(this.home, { recursive: true, force: true });
    clearDiscoveryCache();
    clearStatusStore();
  }
}

export const FILTERED = (source: string) => ({ source, extensions: [], skills: [], prompts: [], themes: [] });
