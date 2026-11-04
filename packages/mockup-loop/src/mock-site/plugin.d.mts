// Types for plugin.mjs (plain-JS module; see change: add-live-component-mock-site).
export interface ThemeSpec { id: string; label: string; attrs?: Record<string, string | null>; system?: { dark: string; light: string } }
export interface MockSiteOptions {
  /** Project root holding `mockups/` (and optionally `openspec/changes/`). */
  projectRoot: string;
  /** Project adapter module, relative to `mockups/` (exports `setup`, `Providers`). */
  app: string;
  title?: string;
  /** First entry is the default; a `system` entry follows prefers-color-scheme. */
  themes?: ThemeSpec[];
  /** Extra dir the app's sources live in (added to `server.fs.allow`). */
  appRoot?: string;
  aliases?: Record<string, string>;
  port?: number;
  /** Bind 0.0.0.0 (LAN clients view only). Default from MOCK_SITE_LAN=1. */
  lan?: boolean;
}
/** Vite plugin (typed loosely so the package needs no `vite` dependency). */
export declare function mockSite(options: MockSiteOptions): { name: string; [hook: string]: unknown };
