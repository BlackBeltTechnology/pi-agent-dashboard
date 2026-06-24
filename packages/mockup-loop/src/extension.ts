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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as http from "node:http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { listPresets, resolvePreset } from "./presets/registry.js";
import { loadContract, refreshContract } from "./presets/contract.js";
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

function startStaticServer(rootDir: string, port: number): Promise<http.Server> {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
      let target = path.join(root, rel);
      // Confine to root — reject traversal escapes.
      if (!target.startsWith(root)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(target);
      } catch {
        stat = null;
      }
      if (stat?.isDirectory()) {
        target = path.join(target, "index.html");
      }
      if (!fs.existsSync(target)) {
        res.writeHead(404, { "content-type": "text/plain" }).end(`Not found: ${rel}`);
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      fs.createReadStream(target).pipe(res);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" }).end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
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
      "Serve a directory of static mockup files over HTTP on 0.0.0.0 and return a clickable local + LAN URL (LAN URL works on a phone). Hand the URL to the human for live review instead of a screenshot. Pass stop:true with a port to stop a running server.",
    parameters: Type.Object({
      dir: Type.Optional(
        Type.String({ description: "Directory to serve (required unless stopping)." }),
      ),
      port: Type.Optional(
        Type.Number({ description: "Port to bind. Omit for an ephemeral free port." }),
      ),
      stop: Type.Optional(
        Type.Boolean({ description: "Stop the server bound to `port` instead of starting one." }),
      ),
    }),
    async execute(_id: string, params: { dir?: string; port?: number; stop?: boolean }): ToolReturn {
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
        const root = path.resolve(params.dir);
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
          return { content: [{ type: "text", text: `Error: not a directory: ${root}` }], details: {} };
        }
        const server = await startStaticServer(root, params.port ?? 0);
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : params.port ?? 0;
        servers.set(port, server);
        const ip = lanIp();
        const local = `http://localhost:${port}`;
        const lan = ip ? `http://${ip}:${port}` : "(no LAN IPv4 detected)";
        return {
          content: [
            {
              type: "text",
              text: `Serving ${root}\n  local: ${local}\n  LAN:   ${lan}\n\nOpen the LAN URL on a phone to check responsive. Stop with serve_mockup{stop:true,port:${port}}.`,
            },
          ],
          details: { port, root, local, lan },
        };
      } catch (err) {
        return { content: [{ type: "text", text: `serve_mockup failed: ${String(err)}` }], details: {} };
      }
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
                "Playwright not available. Install it to enable breakpoint capture:\n  npm i -D playwright && npx playwright install chromium\n\nMeanwhile, capture manually (e.g. the agent-browser CLI) at widths " +
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
        const browser = await pw.chromium.launch();
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
                `Captured ${files.length} screenshots — Read each, then fill the rubric:\n` +
                files.map((f) => `  ${f}`).join("\n") +
                "\n" +
                rubric,
            },
          ],
          details: { playwright: true, files, outDir, widths },
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
  });
}
