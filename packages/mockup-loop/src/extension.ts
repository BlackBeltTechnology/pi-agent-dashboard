/**
 * @blackbelt-technology/frontend-mockup-loop — extension entry point.
 *
 * Gives the agent hands for the frontend design loop the companion
 * `frontend-mockup-loop` skill describes:
 *
 *   - `serve_mockup`     — live static server (Node http, zero deps) that
 *                          hands back a clickable local + LAN URL so the
 *                          human reviews a real page, not a screenshot.
 *   - `score_mockup`     — capture full-page screenshots at mobile/tablet/
 *                          desktop widths via Playwright (dynamic, optional)
 *                          and return them plus a scoring rubric for the
 *                          agent's vision pass.
 *   - `serve_mock_site`  — start the project's live-component mock site
 *                          (real app components, rings, read-only decisions)
 *                          on an isolated port through the project's own
 *                          launcher and inherited build config.
 *   - `init_ui_contract` — scaffold a token-referencing ui-contract.md
 *                          control plane (the cross-screen consistency
 *                          source of truth) if one is absent.
 *
 * Plus a `/mockup-loop` command that prints the loop and reminds the agent
 * to load the skill.
 *
 * Generic: no assumptions about any specific app. Works in any
 * React/Tailwind/shadcn (or plain HTML) project.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { INSTALL_HINT, launchChromium } from "./mock-site/browser.mjs";
import { DEFAULT_MOCK_SITE_PORT, children as mockSiteChildren, startMockSite, stopAllMockSites, stopMockSite } from "./mock-site-serve.js";
import { loadContract, refreshContract } from "./presets/contract.js";
import { listPresets, resolvePreset } from "./presets/registry.js";
import { loadRubric, validateMockup } from "./presets/validators.js";

// ──────────────────────────────────────────────────────────────────────────
// Module state — running mockup servers, keyed by bound port.
// ──────────────────────────────────────────────────────────────────────────

const servers = new Map<number, http.Server>();

type ToolReturn = Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}>;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function lanIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

/** True when `target` is `root` or below it (real paths; not a string prefix, so `<root>-x` is outside). */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Exact loopback Host forms (host part case-insensitive) carrying the bound port. */
function isLoopbackHost(host: string | undefined, port: number): boolean {
  const m = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i.exec(host ?? "");
  // A browser drops the default port from `Host`, so an omitted port means 80.
  return !!m && (m[2] === undefined ? port === 80 : Number(m[2]) === port);
}

/**
 * Static server. Check order: token (404) → loopback Host (421, loopback mode
 * only) → path (400 malformed, 403 escaping `..`, 404 dotfile segment) →
 * realpath confinement (404 ELOOP/ENOENT, 403 other failure or outside root).
 * The realpath-then-open race is a named residual (the agent already writes
 * the served directory).
 */
function startStaticServer(rootDir: string, port: number, opts: { lan: boolean; token: string }): Promise<http.Server> {
  // `rootDir` is the canonical root the tool already admitted against the session cwd; never re-resolve it here.
  const root = rootDir;
  const prefix = `/${opts.token}/`;
  const send = (res: http.ServerResponse, status: number, body = ""): void => {
    res.writeHead(status, { "content-type": "text/plain" }).end(body);
  };

  /** realpath + confinement; returns the real path or the status to answer. */
  async function resolveInside(target: string): Promise<string | number> {
    let real: string;
    try {
      real = await fsp.realpath(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === "ELOOP" || code === "ENOENT" || code === "ENOTDIR" ? 404 : 403;
    }
    return isWithin(root, real) ? real : 403;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, boundPort: number): Promise<void> {
    const rawPath = (req.url ?? "/").split(/[?#]/)[0];
    if (!rawPath.startsWith(prefix)) return send(res, 404);
    if (!opts.lan && !isLoopbackHost(req.headers.host, boundPort)) return send(res, 421, "Misdirected Request");

    let rel: string;
    try {
      rel = decodeURIComponent(rawPath.slice(prefix.length));
    } catch {
      return send(res, 400, "Bad Request");
    }
    if (rel.includes("\0")) return send(res, 400, "Bad Request");

    const segments = rel.split(/[\\/]/).filter(Boolean);
    let depth = 0;
    for (const seg of segments) {
      depth += seg === ".." ? -1 : seg === "." ? 0 : 1;
      if (depth < 0) return send(res, 403, "Forbidden");
    }
    if (segments.some((seg) => seg.startsWith("."))) return send(res, 404, `Not found: ${rel}`);

    let real = await resolveInside(path.join(root, ...segments));
    if (typeof real === "string" && (await fsp.stat(real)).isDirectory()) {
      real = await resolveInside(path.join(real, "index.html"));
    }
    if (typeof real === "number") return send(res, real, real === 404 ? `Not found: ${rel}` : "Forbidden");
    if (!(await fsp.stat(real)).isFile()) return send(res, 404, `Not found: ${rel}`);

    res.writeHead(200, {
      "content-type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    pipeline(fs.createReadStream(real), res, () => {});
  }

  const server = http.createServer((req, res) => {
    const addr = server.address();
    handle(req, res, typeof addr === "object" && addr ? addr.port : port).catch(() => {
      if (!res.headersSent) send(res, 500, "Internal Server Error");
      else res.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, opts.lan ? "0.0.0.0" : "127.0.0.1", () => resolve(server));
  });
}

const CONTRACT_TEMPLATE = `# UI Contract

Single source of truth for cross-screen visual consistency. Every value here
references a design token (CSS custom property / Tailwind theme key) — never a
raw hex or pixel literal. If a screen needs a value not listed, add the token
first, then cite it here.

## Tokens (authority)

Tokens live in the theme layer (e.g. \`:root { --primary: ... }\` /
\`tailwind.config\`). This file references them by name; it does not redefine them.

| Role        | Token            | Notes                          |
|-------------|------------------|--------------------------------|
| background  | \`--background\`   | page surface                   |
| foreground  | \`--foreground\`   | primary text                   |
| primary     | \`--primary\`      | brand / primary action         |
| muted       | \`--muted\`        | secondary surfaces             |
| border      | \`--border\`       | hairlines / dividers           |
| radius      | \`--radius\`       | corner rounding base           |

## Spacing scale

Use the token scale only (e.g. 4 / 8 / 12 / 16 / 24 / 32). No arbitrary px.

## Type scale

Define each step as token + weight + line-height. No ad-hoc font sizes.

## Elevation

Shadow tiers mapped to tokens. State which surface sits at which tier.

## Component invariants

One row per recurring surface (card, button, input, dialog). Record the exact
token recipe so every instance matches.

| Component | Recipe (tokens only)                              |
|-----------|---------------------------------------------------|
| card      | bg \`--card\`, border \`--border\`, radius \`--radius\` |
| button    | bg \`--primary\`, text \`--primary-foreground\`        |

## Motion

Durations + easings as tokens. State when motion is suppressed (reduced-motion).

## Anti-slop guardrails

- No default-average look (generic Inter + purple gradient + centered hero).
- Real hierarchy: one focal point per screen.
- Intentional spacing: rhythm from the scale, not eyeballed gaps.
- Verified contrast (WCAG AA) in BOTH light and dark.
`;

const LOOP_TEXT = `frontend-mockup-loop — the 7 steps:

  1. GROUND   read the real UI + authoritative component source; capture EXACT
              existing tokens. Adapt what ships, don't invent parallel styling.
  2. CONTRACT read/update ui-contract.md — the cross-screen consistency control
              plane. All values reference design tokens, never raw hex/px.
              (scaffold one with the init_ui_contract tool)
  3. MOCKUP   build HTML/Tailwind grounded in 1–2, serve LIVE (serve_mockup) —
              clickable URL, dark+light — NOT a screenshot, so the human reacts.
  4. TEST     score_mockup: screenshots @ mobile/tablet/desktop, score against
              an explicit checklist (contrast, responsive, anti-slop).
  5. FIX      apply the top issue, re-serve, re-score. One criterion at a time.
  6. PROMOTE  translate the approved HTML to real React/shadcn components in an
              ISOLATED env (never the live server) — tokens 1:1, zero apply-gap.
  7. LEARN    record durable taste decisions (memory / ui-contract.md) so the
              next run starts smarter.

Read the full skill: /skill:frontend-mockup-loop`;

// ──────────────────────────────────────────────────────────────────────────
// Extension
// ──────────────────────────────────────────────────────────────────────────

export default function frontendMockupLoop(pi: ExtensionAPI): void {
  // ── serve_mockup ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: "serve_mockup",
    label: "Serve Mockup",
    description:
      "Serve a directory of static mockup files over HTTP, bound to loopback (127.0.0.1) by default so the URL works only on this machine; pass lan:true to also reach it from the LAN (e.g. a phone). `dir` must be inside the session working directory. Every URL carries a private path token; use relative asset links (style.css) — root-relative links (/style.css) drop the token and 404. Hand the returned URL to the human for live review instead of a screenshot. Pass stop:true with a port to stop a running server.",
    parameters: Type.Object({
      dir: Type.Optional(
        Type.String({ description: "Directory to serve, inside the session working directory (required unless stopping)." }),
      ),
      port: Type.Optional(
        Type.Number({ description: "Port to bind. Omit for an ephemeral free port." }),
      ),
      lan: Type.Optional(
        Type.Boolean({ description: "Also listen on the LAN (0.0.0.0) for a phone check. Default false: loopback only." }),
      ),
      stop: Type.Optional(
        Type.Boolean({ description: "Stop the server bound to `port` instead of starting one." }),
      ),
    }),
    async execute(
      _id: string,
      params: { dir?: string; port?: number; lan?: boolean; stop?: boolean },
      _signal?: unknown,
      _onUpdate?: unknown,
      ctx?: { cwd?: string },
    ): ToolReturn {
      try {
        if (params.stop) {
          if (params.port == null) {
            return { content: [{ type: "text", text: "Error: port required to stop a server." }], details: {} };
          }
          const s = servers.get(params.port);
          if (!s) {
            return { content: [{ type: "text", text: `No mockup server on port ${params.port}.` }], details: {} };
          }
          await new Promise<void>((r) => s.close(() => r()));
          servers.delete(params.port);
          return { content: [{ type: "text", text: `Stopped mockup server on port ${params.port}.` }], details: {} };
        }

        if (!params.dir) {
          return { content: [{ type: "text", text: "Error: dir required to start a server." }], details: {} };
        }
        // Root follows the session cwd (ctx.cwd), never the server's; process.cwd() only without ctx.
        const cwd = ctx?.cwd ?? process.cwd();
        const resolved = path.resolve(cwd, params.dir);
        let root: string;
        try {
          root = await fsp.realpath(resolved);
          if (!(await fsp.stat(root)).isDirectory()) throw new Error("not a directory");
        } catch {
          return { content: [{ type: "text", text: `Error: not a directory: ${resolved}` }], details: {} };
        }
        const realCwd = await fsp.realpath(cwd);
        if (!isWithin(realCwd, root)) {
          return {
            content: [{ type: "text", text: `Error: dir must be inside the session working directory (${cwd}); ${root} is outside it. Move the mockup into the project and serve it from there.` }],
            details: {},
          };
        }
        const lan = params.lan === true;
        const token = randomBytes(16).toString("hex");
        const server = await startStaticServer(root, params.port ?? 0, { lan, token });
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : params.port ?? 0;
        servers.set(port, server);
        // eslint-disable-next-line no-console
        console.info(`[mockup-loop] serve_mockup bind=${lan ? "0.0.0.0" : "127.0.0.1"}:${port} lan=${lan} root=${root}`);
        const local = `http://localhost:${port}/${token}/`;
        const ip = lan ? lanIp() : null;
        const lanUrl = lan ? (ip ? `http://${ip}:${port}/${token}/` : "(no LAN IPv4 detected)") : undefined;
        const lines = [`Serving ${root}`, `  local: ${local}`];
        if (lanUrl) lines.push(`  LAN:   ${lanUrl}`);
        lines.push(
          "",
          lan
            ? "Show the local URL to the user. Use the LAN URL only for a phone check."
            : "Show the local URL to the user. It is loopback-only (this machine); pass lan:true for a phone check.",
          `Use relative asset links (style.css, not /style.css). Stop with serve_mockup{stop:true,port:${port}}.`,
        );
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { port, root, local, ...(lanUrl ? { lan: lanUrl } : {}) },
        };
      } catch (err) {
        return { content: [{ type: "text", text: `serve_mockup failed: ${String(err)}` }], details: {} };
      }
    },
  });

  // ── serve_mock_site ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "serve_mock_site",
    label: "Serve Mock Site",
    description:
      "Start the project's live-component mock site (mockups/<id>/mock.tsx rendered with the app's real components, numbered rings, fixtures and scripted frames) through the project's own launcher and inherited build config (package.json mockSite, else detected). Show the returned URL to the user. Decisions are read-only in the site: record them with the mock-decide CLI. Localhost-only unless lan:true (LAN = view-only). Reserved ports are refused. Pass stop:true with a port to stop it.",
    parameters: Type.Object({
      dir: Type.Optional(Type.String({ description: "Project root (default: cwd)." })),
      port: Type.Optional(Type.Number({ description: `Port (default ${DEFAULT_MOCK_SITE_PORT}).` })),
      lan: Type.Optional(Type.Boolean({ description: "Also listen on the LAN for phone review (view-only)." })),
      stop: Type.Optional(Type.Boolean({ description: "Stop the mock site on `port`." })),
    }),
    async execute(_id: string, params: { dir?: string; port?: number; lan?: boolean; stop?: boolean }): ToolReturn {
      if (params.stop) {
        const port = params.port ?? DEFAULT_MOCK_SITE_PORT;
        const ok = await stopMockSite(port);
        return { content: [{ type: "text", text: ok ? `Stopped mock site on port ${port}.` : `No mock site on port ${port}.` }], details: { port, stopped: ok } };
      }
      const r = await startMockSite(params);
      if (!r.ok) return { content: [{ type: "text", text: `serve_mock_site failed: ${r.error}` }], details: { error: r.error } };
      const lines = [`Mock site for ${r.root}`, `  local: ${r.local}`];
      if (params.lan) {
        lines.push(`  LAN:   ${r.lan ?? "(no LAN IPv4 detected)"}`);
        lines.push("LAN clients are view-only. Project sources are readable on the LAN while it runs.");
      }
      lines.push(`  launcher: ${r.launcher}`, `  app config: ${r.config}`);
      lines.push("", `Show the URL to the user, with #ref links for anything you ask about. Record decisions with the CLI: mock-decide accept|reject <ref> [note]. Stop: serve_mock_site{stop:true,port:${r.port}}.`);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { port: r.port, local: r.local, lan: r.lan, root: r.root, launcher: r.launcher, config: r.config } };
    },
  });

  // ── score_mockup ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "score_mockup",
    label: "Score Mockup",
    description:
      "Capture full-page screenshots of a running mockup URL at mobile/tablet/desktop widths (via Playwright) and return their file paths plus a scoring rubric. Read the PNGs, then score each criterion — do not claim 'looks good' without filling the rubric. If Playwright is absent, returns install guidance.",
    parameters: Type.Object({
      url: Type.String({ description: "URL of the running mockup (from serve_mockup)." }),
      widths: Type.Optional(
        Type.Array(Type.Number(), {
          description: "Viewport widths to capture. Default [375, 768, 1440].",
        }),
      ),
      outDir: Type.Optional(
        Type.String({ description: "Where to write PNGs. Default a fresh temp dir." }),
      ),
      system: Type.Optional(
        Type.String({ description: "Design-system preset id (e.g. shadcn, apple-hig). Swaps the generic rubric for that system's boolean rubric. See list_design_systems." }),
      ),
    }),
    async execute(_id: string, params: { url: string; widths?: number[]; outDir?: string; system?: string }): ToolReturn {
      const widths = params.widths?.length ? params.widths : [375, 768, 1440];
      let rubric: string;
      if (params.system) {
        const r = resolvePreset(params.system);
        if ("error" in r) {
          return { content: [{ type: "text", text: r.error }], details: { error: r.error } };
        }
        const checks = loadRubric(r.preset.id);
        rubric = [
          "",
          `SCORING RUBRIC — ${r.preset.label} (answer each PASS/FAIL + one-line reason):`,
          ...checks.map((c) => `  [ ] ${c.text}`),
          `Score = passCount / ${checks.length} (computed in code — do not emit a float yourself).`,
          "Loop FIX→re-score until every check passes.",
        ].join("\n");
      } else {
        rubric = [
          "",
          "SCORING RUBRIC — fill each (PASS/FAIL + one-line reason):",
          "  [ ] Contrast (WCAG AA) — light AND dark",
          "  [ ] Responsive — no overflow/clipping at any width; touch targets >=44px on mobile",
          "  [ ] Hierarchy — one clear focal point, intentional emphasis",
          "  [ ] Spacing — rhythm from the token scale, not eyeballed gaps",
          "  [ ] Token fidelity — colors/radii/spacing trace to ui-contract.md tokens",
          "  [ ] Anti-slop — not the default-average look (generic Inter + purple gradient + centered hero)",
          "  [ ] Console — no errors/warnings",
          "Loop FIX→re-score until every line is PASS in both themes.",
        ].join("\n");
      }

      let pw: any = null;
      try {
        const spec = "playwright"; // non-literal: avoids static resolution when absent
        pw = await import(spec);
      } catch {
        pw = null;
      }
      if (!pw?.chromium) {
        return {
          content: [
            {
              type: "text",
              text:
                `Playwright not available. Install it to enable breakpoint capture:\n  npm i -D playwright && ${INSTALL_HINT}\n\nMeanwhile, capture manually (e.g. the agent-browser CLI) at widths ` +
                widths.join(", ") +
                " and score against the rubric below." +
                "\n" +
                rubric,
            },
          ],
          details: { playwright: false, widths },
        };
      }

      try {
        const outDir = params.outDir
          ? path.resolve(params.outDir)
          : await fsp.mkdtemp(path.join(os.tmpdir(), "mockup-shots-"));
        await fsp.mkdir(outDir, { recursive: true });
        let launched: { browser: any; build: string };
        try {
          launched = await launchChromium(pw.chromium);
        } catch (e) {
          const msg = String((e as Error).message ?? e);
          return {
            content: [{ type: "text", text: `${msg}\n\nMeanwhile, capture manually at widths ${widths.join(", ")} and score against the rubric below.\n${rubric}` }],
            details: { playwright: true, browser: false, widths, error: msg },
          };
        }
        const { browser, build } = launched;
        const files: string[] = [];
        for (const w of widths) {
          const context = await browser.newContext({ viewport: { width: w, height: 900 } });
          const page = await context.newPage();
          await page.goto(params.url, { waitUntil: "networkidle" }).catch(() => {});
          const file = path.join(outDir, `mockup-${w}.png`);
          await page.screenshot({ path: file, fullPage: true });
          files.push(file);
          await context.close();
        }
        await browser.close();
        return {
          content: [
            {
              type: "text",
              text:
                `Captured ${files.length} screenshots${build === "pinned" ? "" : ` (cached browser ${build})`} — Read each, then fill the rubric:\n` +
                files.map((f) => `  ${f}`).join("\n") +
                "\n" +
                rubric,
            },
          ],
          details: { playwright: true, files, outDir, widths, browser: build },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `score_mockup capture failed: ${String(err)}\n${rubric}` }],
          details: { playwright: true, error: String(err) },
        };
      }
    },
  });

  // ── init_ui_contract ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "init_ui_contract",
    label: "Init UI Contract",
    description:
      "Scaffold a ui-contract.md design control plane (cross-screen consistency source of truth) if absent. The contract references design tokens only — no raw hex/px. Use before mocking up so every screen shares one system.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Target file path. Default ./ui-contract.md (or ./ui-contract.tokens.json when --system is set)." }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Overwrite if it already exists." }),
      ),
      system: Type.Optional(
        Type.String({ description: "Design-system preset id (e.g. shadcn, mui, material-3, fluent-2, apple-hig). Writes that system's DTCG contract instead of the blank template. See list_design_systems." }),
      ),
      refresh: Type.Optional(
        Type.Boolean({ description: "Re-fetch upstream tokens and rewrite the bundled snapshot before writing (token-publishing systems only)." }),
      ),
    }),
    async execute(_id: string, params: { path?: string; force?: boolean; system?: string; refresh?: boolean }): ToolReturn {
      try {
        // ── system-specific DTCG contract ──────────────────────────────────
        if (params.system) {
          const r = resolvePreset(params.system);
          if ("error" in r) {
            return { content: [{ type: "text", text: r.error }], details: { error: r.error } };
          }
          const target = path.resolve(params.path ?? "ui-contract.tokens.json");
          if (fs.existsSync(target) && !params.force) {
            return {
              content: [{ type: "text", text: `${target} already exists. Pass force:true to overwrite.` }],
              details: { created: false, path: target, system: r.preset.id },
            };
          }
          if (params.refresh) {
            try {
              await refreshContract(r.preset.id);
            } catch (err) {
              return { content: [{ type: "text", text: `refresh failed: ${String(err)}` }], details: { system: r.preset.id } };
            }
          }
          const contract = loadContract(r.preset.id);
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(target, JSON.stringify(contract, null, 2) + "\n", "utf8");
          return {
            content: [{ type: "text", text: `Wrote ${r.preset.label} DTCG contract to ${target} (${r.preset.contractSource}). Generate mockups to this system's conventions, then validate_mockup{system:"${r.preset.id}"}.` }],
            details: { created: true, path: target, system: r.preset.id },
          };
        }

        // ── back-compat: blank template ────────────────────────────────────
        const target = path.resolve(params.path ?? "ui-contract.md");
        if (fs.existsSync(target) && !params.force) {
          return {
            content: [
              { type: "text", text: `ui-contract.md already exists at ${target}. Read + extend it (or pass force:true to overwrite).` },
            ],
            details: { created: false, path: target },
          };
        }
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, CONTRACT_TEMPLATE, "utf8");
        return {
          content: [{ type: "text", text: `Scaffolded design contract at ${target}. Fill it from the real tokens captured in step 1 (GROUND).` }],
          details: { created: true, path: target },
        };
      } catch (err) {
        return { content: [{ type: "text", text: `init_ui_contract failed: ${String(err)}` }], details: {} };
      }
    },
  });

  // ── list_design_systems ────────────────────────────────────────────────
  pi.registerTool({
    name: "list_design_systems",
    label: "List Design Systems",
    description:
      "Enumerate the selectable design-system presets (id, label, platform, substrate, validator layers). Pass an id to init_ui_contract/score_mockup/validate_mockup via their `system` param to target that system.",
    parameters: Type.Object({}),
    async execute(): ToolReturn {
      const presets = listPresets().map((p) => ({
        id: p.id,
        label: p.label,
        platform: p.platform,
        substrate: p.substrate,
        validators: p.validators.map((v) => `${v.layer}:${v.tool}${v.gate ? " (gate)" : ""}${v.bundled ? "" : " (optional)"}`),
      }));
      const text =
        "Design systems:\n" +
        presets
          .map((p) => `  ${p.id} — ${p.label} [${p.platform}, ${p.substrate}]\n      ${p.validators.join(", ")}`)
          .join("\n");
      return { content: [{ type: "text", text }], details: { presets } };
    },
  });

  // ── validate_mockup ────────────────────────────────────────────────────
  pi.registerTool({
    name: "validate_mockup",
    label: "Validate Mockup",
    description:
      "Run the layered validation pipeline for a design system: L1 token-lint + L2 a11y/contrast floor (hard GATES), L3 named-system auditor + L4 boolean rubric (ADVISORY). Returns { gates, advisory, pass }. `pass` is determined by gates only; advisory layers score and drive the fix loop. Pass `dir` (the served mockup directory) so L1/L2 can scan files.",
    parameters: Type.Object({
      system: Type.String({ description: "Design-system preset id. See list_design_systems." }),
      url: Type.Optional(Type.String({ description: "URL of the running mockup (from serve_mockup), for context." })),
      dir: Type.Optional(Type.String({ description: "Directory of the mockup source files to lint/scan (L1/L2)." })),
    }),
    async execute(_id: string, params: { system: string; url?: string; dir?: string }): ToolReturn {
      const r = resolvePreset(params.system);
      if ("error" in r) {
        return { content: [{ type: "text", text: r.error }], details: { error: r.error } };
      }
      const dir = params.dir ? path.resolve(params.dir) : undefined;
      const result = validateMockup({ preset: r.preset, dir });
      const fmt = (l: { layer: string; tool: string; status: string; gate: boolean; messages: string[] }) =>
        `  ${l.layer} ${l.tool}${l.gate ? " (gate)" : " (advisory)"}: ${l.status.toUpperCase()}\n      ${l.messages.join("\n      ")}`;
      const text = [
        `validate_mockup — ${r.preset.label}: ${result.pass ? "PASS" : "BLOCKED"}`,
        "GATES:",
        fmt(result.gates.l1),
        fmt(result.gates.l2),
        "ADVISORY:",
        fmt(result.advisory.l3),
        fmt(result.advisory.l4),
      ].join("\n");
      return { content: [{ type: "text", text }], details: { ...result } };
    },
  });

  // ── /mockup-loop command ───────────────────────────────────────────────
  pi.registerCommand("mockup-loop", {
    description: "Show the frontend mockup loop and load the skill",
    handler: async (_args: string, ctx: any) => {
      ctx?.ui?.notify?.("frontend-mockup-loop — read /skill:frontend-mockup-loop to start", "info");
      // Print the loop to the transcript for immediate reference.
      // eslint-disable-next-line no-console
      console.log(LOOP_TEXT);
    },
  });

  // ── cleanup ──────────────────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    for (const [port, s] of servers) {
      await new Promise<void>((r) => s.close(() => r()));
      servers.delete(port);
    }
    await stopAllMockSites();
  });
  // Never orphan a Vite child holding the port when pi exits without a shutdown event.
  process.once("exit", () => { for (const c of mockSiteChildren.values()) c.kill("SIGKILL"); });
}
