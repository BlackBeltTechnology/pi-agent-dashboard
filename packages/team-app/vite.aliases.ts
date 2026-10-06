/**
 * Worktree-local source aliases shared by vite + vitest. The hoisted workspace
 * symlinks escape to the main checkout, so every first-party sibling resolves
 * to this tree's source (also lets the app build without a prebuilt app-kit
 * `dist/`). See change: add-team-plugin.
 */
import path from "node:path";

const root = path.resolve(__dirname, "..");
const p = (...s: string[]) => path.join(root, ...s);

export const aliases = [
  { find: "@blackbelt-technology/pi-dashboard-app-kit/react", replacement: p("app-kit/src/react/index.ts") },
  { find: "@blackbelt-technology/pi-dashboard-app-kit", replacement: p("app-kit/src/index.ts") },
  { find: "@blackbelt-technology/pi-dashboard-web/chat-embed", replacement: p("client/src/chat-embed/index.ts") },
  { find: "@blackbelt-technology/pi-dashboard-web/package.json", replacement: p("client/package.json") },
  // Deep chat internals the embed barrel does not export (markdown / tool step / thinking block primitives).
  { find: /^@dash\//, replacement: `${p("client/src")}/` },
  { find: "@blackbelt-technology/pi-dashboard-shared", replacement: p("shared/src") },
  { find: "@blackbelt-technology/pi-dashboard-client-utils", replacement: p("client-utils/src") },
  { find: "@blackbelt-technology/dashboard-plugin-runtime/server", replacement: p("dashboard-plugin-runtime/src/server/index.ts") },
  { find: "@blackbelt-technology/dashboard-plugin-runtime/context", replacement: p("dashboard-plugin-runtime/src/plugin-context.tsx") },
  { find: "@blackbelt-technology/dashboard-plugin-runtime", replacement: p("dashboard-plugin-runtime/src/index.ts") },
];
