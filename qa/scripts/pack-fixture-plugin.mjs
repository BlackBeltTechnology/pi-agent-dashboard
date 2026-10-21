#!/usr/bin/env node
/**
 * Pack the fixture pi-package plugins into a local directory (no registry), for
 * `POST /api/packages/install {source:"<abs dir>", scope:"global"}` on a clean
 * VM / prefix. Writes two self-contained packages:
 *
 *   <out>/qa-fixture-plugin/         server entry (writes a sentinel file) + bridge entry
 *   <out>/qa-fixture-plugin-throws/  same manifest shape, server entry throws on load
 *
 * Plain JS only (no toolchain, no build): the dist-only server runs them as-is.
 * Prints one JSON line: { ok, out, plugins: [{ id, dir, sentinel }] }.
 * Usage: node qa/scripts/pack-fixture-plugin.mjs --out <dir>
 * See change: decouple-plugins-from-core (task 8.6; E101, E102, X15).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_IDS = { ok: "qa-fixture-plugin", throws: "qa-fixture-plugin-throws" };

function manifestFor(id, displayName) {
  return {
    name: `${id}-pkg`,
    version: "1.0.0",
    type: "module",
    keywords: ["pi-package", "pi-dashboard-plugin"],
    "pi-dashboard-plugin": {
      id,
      displayName,
      hostApi: "^1.0.0",
      server: "./server.js",
      bridge: "./bridge.js",
      claims: [{ slot: "settings-section", component: "Settings" }],
    },
  };
}

// Proves the server entry loaded: `<out>/<id>.loaded` (next to the package dir, so the pack stays
// relocatable) exists only after a real load.
const OK_SERVER = (id) => `import { writeFileSync } from "node:fs";
export default function register() {
  writeFileSync(new URL("../${id}.loaded", import.meta.url), String(Date.now()));
}
`;
const THROWS_SERVER = `throw new Error("qa-fixture-plugin-throws: server entry failed on load");\n`;
const BRIDGE = `export default function bridge() {}\n`;

/** Write both fixture packages under `out`. Returns the descriptor list. */
export function packFixturePlugins({ out }) {
  const root = resolve(out);
  const plugins = [];
  for (const [kind, id] of Object.entries(FIXTURE_IDS)) {
    const dir = join(root, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const sentinel = join(root, `${id}.loaded`);
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifestFor(id, kind === "ok" ? "QA Fixture Plugin" : "QA Fixture Plugin (throws)"), null, 2)}\n`);
    writeFileSync(join(dir, "server.js"), kind === "ok" ? OK_SERVER(id) : THROWS_SERVER);
    writeFileSync(join(dir, "bridge.js"), BRIDGE);
    plugins.push({ id, dir, sentinel });
  }
  return plugins;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const out = get("--out");
  if (!out) {
    console.error("usage: pack-fixture-plugin.mjs --out <dir>");
    process.exit(2);
  }
  const plugins = packFixturePlugins({ out });
  console.log(JSON.stringify({ ok: true, out: resolve(out), plugins }));
}
