// @ts-check
// `mockSite(options)` — Vite plugin that turns a project's `mockups/` into the
// live-component mock site. No runtime `vite` import (types only), so the pi
// extension loads without Vite. Read-only: decisions are written by the
// `mock-decide` CLI only. See change: add-live-component-mock-site (D1-D5),
// add-mock-site-exact-env (D2, D6, D8).
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { discoverMocks, mockRoots } from "./discover.mjs";
import { readDecisions } from "./decisions.mjs";
import { DEFAULT_FRAMEWORK, FRAMEWORK_ADAPTERS } from "./frameworks.mjs";

const SITE_DIR = fileURLToPath(new URL("../../site/", import.meta.url));
const V_CONFIG = "virtual:mock-site/config";
const V_APP = "virtual:mock-site/app";
const V_MOCKS = "virtual:mock-site/mocks";
/** Optional peers of fixture / script panes: pre-bundled only when the project has them. */
const LAZY_PEERS = ["@mswjs/interceptors/fetch", "@mswjs/interceptors/XMLHttpRequest", "@mswjs/interceptors/WebSocket", "@testing-library/user-event"];

/**
 * @typedef {{ id: string, label: string, attrs?: Record<string, string|null>, system?: { dark: string, light: string } }} ThemeSpec
 * @typedef {{
 *   projectRoot: string,
 *   app?: string,
 *   title?: string,
 *   themes?: ThemeSpec[],
 *   appRoot?: string,
 *   aliases?: Record<string, string>,
 *   port?: number,
 *   lan?: boolean,
 * }} MockSiteOptions
 */

/** @param {string} p */
const fsUrl = (p) => `/@fs/${p.replace(/\\/g, "/").replace(/^\/+/, "")}`;

/** @param {import("node:http").ServerResponse} res @param {number} code @param {unknown} body */
function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * @param {MockSiteOptions} options
 * @returns {any} Vite plugin
 */
/**
 * LAN mode exposes the project over the network and relies on `server.fs.deny`.
 * False for Vite releases with a known deny bypass: GHSA-8jhw-289h-jh2g (<5.2.6),
 * GHSA-93m4-6634-74q7 (<5.4.21, 6.0–6.4.0, 7.0.0–7.0.7, 7.1.0–7.1.10) and
 * GHSA-8g5g-mxqh-grgj (6.4.4).
 * Mirrors the package's optional `vite` peer range.
 * @param {string} version
 */
export function isLanSafeVite(version) {
  const [maj, min, pat] = version.split(/[.-]/).map(Number);
  const n = maj * 1e6 + min * 1e3 + pat;
  if (maj === 5) return n >= 5_004_021;
  if (maj === 6) return n >= 6_004_001 && n !== 6_004_004;
  if (maj === 7) return min === 0 ? n >= 7_000_008 : min === 1 ? n >= 7_001_011 : true;
  return maj > 7;
}

export function mockSite(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const mockupsDir = path.join(projectRoot, "mockups");
  const appFile = options.app ? path.resolve(mockupsDir, options.app) : null;
  const fw = FRAMEWORK_ADAPTERS[DEFAULT_FRAMEWORK];
  const req = createRequire(path.join(projectRoot, "package.json"));
  const peers = LAZY_PEERS.filter((p) => { try { req.resolve(p); return true; } catch { return false; } });
  const lan = options.lan ?? process.env.MOCK_SITE_LAN === "1";
  const siteDir = fs.existsSync(SITE_DIR) ? SITE_DIR : path.join(path.dirname(fileURLToPath(import.meta.url)), "../../site/");
  const themes = options.themes ?? [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": "dark" } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ];
  const current = () => discoverMocks(projectRoot);

  return {
    name: "mock-site",
    enforce: "pre",
    async config() {
      if (lan) {
        const { version } = await import("vite");
        if (!isLanSafeVite(version)) throw new Error(`mock-site: LAN mode refused on vite ${version} (known server.fs.deny bypass); upgrade vite (>=5.4.21 <6, >=6.4.1 except 6.4.4, >=7.0.8, >=7.1.11)`);
      }
      const { mocks } = current();
      return {
        root: mockupsDir,
        cacheDir: path.join(projectRoot, "node_modules", ".vite-mock-site"),
        appType: "custom",
        resolve: {
          alias: [{ find: /^mock-site\/kit$/, replacement: path.join(siteDir, "kit.tsx") }, ...Object.entries(options.aliases ?? {}).map(([find, replacement]) => ({ find, replacement }))],
          dedupe: fw.dedupe,
        },
        optimizeDeps: {
          entries: [path.join(siteDir, "main.tsx"), ...mocks.map((m) => m.file)],
          include: [...fw.include, ...peers],
        },
        server: {
          host: lan ? "0.0.0.0" : "127.0.0.1",
          ...(options.port ? { port: options.port, strictPort: true } : {}),
          fs: {
            allow: [siteDir, projectRoot, ...(options.appRoot ? [path.resolve(options.appRoot)] : [])],
            // LAN mode REPLACES Vite's deny list, so restate its defaults (and newer
            // Vite ones) before adding ours.
            ...(lan ? { deny: [".env", ".env.*", "*.{crt,cer,der,pem,key,p12,pfx}", "**/.git/**", "**/.yarnrc.yml", "**/.npmrc", "**/.pi/**",
              // secret DATA files by extension only — a bare *secret* glob would also block app modules (SecretsPanel.tsx)
              "**/.secrets", "**/.secrets/**", "**/*.secret", "**/*secret*.{json,yaml,yml,env,txt,ini,toml}", "**/.secrets*.{json,yaml,yml,env,txt}"] } : {}),
          },
        },
      };
    },
    /** @param {string} id */
    resolveId(id) {
      if (id === V_CONFIG || id === V_APP || id === V_MOCKS) return "\0" + id;
      return null;
    },
    /** @param {string} id */
    load(id) {
      if (id === "\0" + V_CONFIG) return `export const MOCK_CONFIG = ${JSON.stringify({ title: options.title ?? "Mocks", themes })};`;
      if (id === "\0" + V_APP) return appFile ? `export * from ${JSON.stringify(appFile)};` : "export const setup = undefined;\nexport const Providers = (p) => p.children;\n";
      if (id === "\0" + V_MOCKS) {
        const { mocks, errors } = current();
        const imports = mocks.map((m, i) => `import m${i} from ${JSON.stringify(m.file)};`).join("\n");
        const list = mocks.map((m, i) => `{ id: ${JSON.stringify(m.id)}, mock: m${i} }`).join(",\n  ");
        return `${imports}\nexport const MOCKS = [\n  ${list}\n];\nexport const ERRORS = ${JSON.stringify(errors)};\n`;
      }
      return null;
    },
    /** @param {any} srv */
    configureServer(srv) {
      for (const r of [mockupsDir, path.join(projectRoot, "openspec", "changes"), ...mockRoots(projectRoot)]) if (fs.existsSync(r)) srv.watcher.add(r);
      /** @param {string} f */
      const onFs = (f) => {
        const base = path.basename(f);
        if (!f.startsWith(projectRoot) || f.includes(`${path.sep}archive${path.sep}`) || f.includes(`${path.sep}node_modules${path.sep}`)) return;
        if (base === "decision.json") srv.ws.send({ type: "custom", event: "mock:decisions" });
        if (base === "mock.tsx") {
          const mod = srv.moduleGraph.getModuleById("\0" + V_MOCKS);
          if (mod) srv.moduleGraph.invalidateModule(mod);
          srv.ws.send({ type: "full-reload" });
        }
      };
      srv.watcher.on("add", onFs);
      srv.watcher.on("unlink", onFs);
      srv.watcher.on("change", (/** @type {string} */ f) => { if (path.basename(f) === "decision.json") onFs(f); });

      srv.middlewares.use("/__mock/decisions", (/** @type {any} */ _req, /** @type {any} */ res) => {
        const { mocks, errors } = current();
        const { decisions, warnings } = readDecisions(mocks);
        send(res, 200, { mockSite: true, decisions, warnings, errors });
      });

      // HTML entry (the package ships no index.html): `/` and `/?pane=…`.
      srv.middlewares.use(async (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) return next();
        const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${(options.title ?? "Mocks").replace(/[<&]/g, "")}</title></head>
<body><div id="root"></div><script type="module" src="${fsUrl(path.join(siteDir, "main.tsx"))}"></script></body></html>`;
        try {
          const out = await srv.transformIndexHtml(req.url, html);
          res.statusCode = 200;
          res.setHeader("content-type", "text/html");
          res.end(out);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

