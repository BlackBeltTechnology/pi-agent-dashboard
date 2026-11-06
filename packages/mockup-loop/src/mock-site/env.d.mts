// Types for env.mjs (plain-JS module; see change: add-mock-site-exact-env).
import type { MockSiteUserOptions } from "./options.mjs";
export declare const GENERATED_DIR: string;
export declare function resolveLauncher(root: string, opts?: { options?: MockSiteUserOptions }):
  | { ok: true; adapter: "vite"; launcher: string; config: string; source: "declared" | "detected" }
  | { ok: false; error: string };
export declare function inheritAppConfig(cfg: Record<string, any>, configFile: string): { config: Record<string, any>; appRoot: string };
export declare function importProjectVite(root: string): Promise<any>;
export declare function optionsFile(root: string): string | null;
export declare function loadOptions(root: string, vite: any): Promise<{ ok: true; options: MockSiteUserOptions; file: string | null } | { ok: false; error: string }>;
export declare function prepareMockSite(root: string): Promise<
  | { ok: true; launcher: string; config: string; generated: string; source: string; optionsFile: string | null }
  | { ok: false; error: string }
>;
export declare function createMockSiteConfig(p: { projectRoot: string; config: string; options: MockSiteUserOptions; optionsFile: string | null }, env: { mode?: string }, vite: any): Promise<any>;
