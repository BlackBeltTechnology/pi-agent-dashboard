#!/usr/bin/env node
// Vite build wrapper that registers tsx as the Node module loader before
// invoking vite's bin. Vite bundles vite.config.ts via esbuild (configLoader
// default "bundle"), but external imports from node_modules — including
// transitive workspace .ts sources of @blackbelt-technology/pi-dashboard-shared
// hoisted by npm into packages/dashboard-plugin-runtime/node_modules/ — stay
// externalized and are resolved by Node at runtime. On Node 22+, Node's native
// type-stripping refuses to strip .ts files under node_modules and throws
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. tsx's loader takes over
// resolution for those externals and strips types via esbuild instead.
//
// See change: add-ci-electron-on-demand-build (downstream build fix).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

register();

// vite/bin/vite.js is exposed via package.bin but not in package.exports, so
// we resolve it via the package.json itself + require.resolve to keep this
// loader-agnostic and immune to vite version reshuffles.
const require = createRequire(import.meta.url);
const viteRoot = require.resolve("vite/package.json");
const viteBin = new URL("./bin/vite.js", pathToFileURL(viteRoot));
await import(viteBin.href);
