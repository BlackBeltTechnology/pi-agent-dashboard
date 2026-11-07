// pi-agent-dashboard mock options: real client components in Current | Proposed frames.
// A plain options object, NOT a build config: the mock site inherits the client's
// build shape (plugins, aliases, css, define) from package.json "mockSite"
// (launcher + packages/client/vite.config.ts). Run: serve_mock_site{} or `npm run mocks`.
// Installed consumers import "@blackbelt-technology/frontend-mockup-loop/src/mock-site/options.mjs";
// this repo ships that package, so it imports the source path.
// See change: add-live-component-mock-site (design D2, D8), add-mock-site-exact-env (D9).
import path from "node:path";
import { defineMockSite } from "../packages/mockup-loop/src/mock-site/options.mjs";

const pkg = (p: string) => path.join(__dirname, "..", "packages", p);

export default defineMockSite({
  title: "Dashboard mocks",
  app: "./mock-site.app.tsx",
  // First entry is the default; "system" follows prefers-color-scheme like the dashboard (useTheme).
  themes: [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": null } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ],
  // Mock-only aliases the client config lacks (its own aliases are inherited).
  aliases: {
    "@app": pkg("client/src"),
    // Plugin sources for plugin-surface mocks (package `exports` block deep imports).
    "@flows": pkg("flows-plugin/src"),
  },
});
