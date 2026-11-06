// Types for options.mjs (plain-JS module; see change: add-mock-site-exact-env).
import type { ThemeSpec } from "./plugin.mjs";
export interface MockSiteUserOptions {
  title?: string;
  /** First entry is the default; a `system` entry follows prefers-color-scheme. */
  themes?: ThemeSpec[];
  /** Project setup module, relative to `mockups/` (exports `setup`, `Providers`). */
  app?: string;
  /** Extra aliases the app config lacks (the app's own aliases are inherited). */
  aliases?: Record<string, string>;
  /** Launcher script (project-relative); package.json `mockSite.launcher` wins. */
  launcher?: string;
  /** App build config (project-relative); package.json `mockSite.config` wins. */
  config?: string;
  /** Extra keys `mock-capture` redacts. */
  redact?: string[];
}
export declare function defineMockSite(o: MockSiteUserOptions): MockSiteUserOptions;
export declare function validateOptions(o: unknown, file: string): MockSiteUserOptions;
