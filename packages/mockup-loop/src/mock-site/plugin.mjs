// @ts-check
// `mockSite(options)` — Vite plugin that turns a project's `mockups/` into the
// live-component mock site. No runtime `vite` import (types only), so the pi
// extension loads without Vite. See change: add-live-component-mock-site (D1-D5).
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverMocks, mockRoots } from "./discover.mjs";
import { readDecisions, validateDecideBody, writeDecision } from "./decisions.mjs";

const SITE_DIR = fileURLToPath(new URL("../../site/", import.meta.url));
const V_CONFIG = "virtual:mock-site/config";
const V_APP = "virtual:mock-site/app";
const V_MOCKS = "virtual:mock-site/mocks";
const BODY_MAX = 4096;
const LOOPBACK_RE = /^(127\.|::1$|::ffff:127\.)/;

/**
 * @typedef {{ id: string, label: string, attrs?: Record<string, string|null>, system?: { dark: string, light: string } }} ThemeSpec
 * @typedef {{
 *   projectRoot: string,
 *   app: string,
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
export function mockSite(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const mockupsDir = path.join(projectRoot, "mockups");
  const appFile = path.resolve(mockupsDir, options.app);
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
    config() {
      const { mocks } = current();
      return {
        root: mockupsDir,
        cacheDir: path.join(projectRoot, "node_modules", ".vite-mock-site"),
        appType: "custom",
        resolve: {
          alias: [{ find: /^mock-site\/kit$/, replacement: path.join(siteDir, "kit.tsx") }, ...Object.entries(options.aliases ?? {}).map(([find, replacement]) => ({ find, replacement }))],
          dedupe: ["react", "react-dom"],
        },
        optimizeDeps: {
          entries: [path.join(siteDir, "main.tsx"), ...mocks.map((m) => m.file)],
          include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
        },
        server: {
          host: lan ? "0.0.0.0" : "127.0.0.1",
          ...(options.port ? { port: options.port, strictPort: true } : {}),
          fs: {
            allow: [siteDir, projectRoot, ...(options.appRoot ? [path.resolve(options.appRoot)] : [])],
            // LAN mode REPLACES Vite's deny list, so restate its defaults (and newer
            // Vite ones) before adding ours.
            ...(lan ? { deny: [".env", ".env.*", "*.{crt,pem,key,p12,pfx}", "**/.git/**", "**/.yarnrc.yml", "**/.npmrc", "**/.pi/**", "**/*secret*"] } : {}),
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
      if (id === "\0" + V_APP) return `export * from ${JSON.stringify(appFile)};`;
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
        if (!f.startsWith(projectRoot) || f.includes(`${path.sep}archive${path.sep}`)) return;
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

      const origins = () => {
        const a = srv.httpServer?.address();
        const port = a && typeof a === "object" ? a.port : options.port;
        return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
      };
      /** @param {import("node:http").IncomingMessage} req */
      const isLoopback = (req) => LOOPBACK_RE.test(req.socket.remoteAddress ?? "");

      srv.middlewares.use("/__mock/decisions", (/** @type {any} */ req, /** @type {any} */ res) => {
        const { mocks, errors } = current();
        const { decisions, warnings } = readDecisions(mocks);
        send(res, 200, { mockSite: true, canDecide: isLoopback(req), decisions, warnings, errors });
      });

      srv.middlewares.use("/__mock/decide", (/** @type {any} */ req, /** @type {any} */ res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" });
        if (!isLoopback(req)) return send(res, 403, { error: "decisions only from this machine" });
        const origin = req.headers.origin;
        if (origin && !origins().has(origin)) return send(res, 403, { error: "foreign origin" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "application/json required" });
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        let over = false;
        req.on("data", (/** @type {Buffer} */ c) => {
          size += c.length;
          if (size > BODY_MAX) over = true;
          else chunks.push(c);
        });
        req.on("error", () => { if (!res.headersSent) send(res, 400, { error: "request aborted" }); });
        req.on("end", () => {
          if (over) return send(res, 413, { error: `body over ${BODY_MAX} bytes` });
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
          const { mocks } = current();
          const v = validateDecideBody(body, new Set(mocks.map((m) => m.id)));
          if (!v.ok) return send(res, 400, { error: v.error });
          const mock = mocks.find((m) => m.id === v.id);
          try {
            writeDecision(/** @type {any} */ (mock), { status: v.status, by: "user", ...(v.note ? { note: v.note } : {}) });
          } catch (e) {
            return send(res, 400, { error: String(/** @type {Error} */ (e).message) });
          }
          send(res, 200, { ok: true });
        });
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

