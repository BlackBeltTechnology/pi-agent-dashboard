/**
 * Recovery HTTP server.
 *
 * Spun up by `cli.ts` when the main server can't start because a top-level
 * runtime dependency is missing (`fastify`, `toad-cache`, etc.). Binds to
 * the same port the real server would have used, so a user pointing their
 * browser at http://localhost:8000 sees a status page instead of a refused
 * connection.
 *
 * STRICT CONSTRAINT: this module imports ONLY node built-ins. If it
 * imported a third-party module, that module could be the one that's
 * missing — and the recovery server itself would fail to load. Keep it
 * dependency-free.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface RecoveryInfo {
  /** Port to bind. */
  port: number;
  /** The original error that prevented startup. */
  error: Error;
  /** Optional: extracted missing module identifier. */
  missingModule?: string | null;
  /** Optional: suggested reinstall command. */
  suggestedFix?: string;
}

/**
 * Extract the missing-module identifier from an `ERR_MODULE_NOT_FOUND` or
 * legacy `MODULE_NOT_FOUND` error. Returns null if the error isn't of that
 * shape.
 *
 * Examples it handles:
 *   "Cannot find module 'fastify'"
 *   "Cannot find module '/abs/path/foo.cjs'"
 *   "Cannot find package 'toad-cache' imported from /..."
 *   "Cannot find module 'file:///.../server.js' imported from /.../cli.ts"
 */
export function parseModuleNotFoundError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; message?: string };
  const code = e.code;
  const msg = e.message ?? "";
  const isModuleErr =
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND" ||
    /Cannot find (module|package)/.test(msg);
  if (!isModuleErr) return null;

  // Try "Cannot find module 'X'" / "Cannot find package 'X'"
  const m1 = msg.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/);
  if (m1) return m1[1];
  return null;
}

/**
 * Return true iff `err` looks like a top-level module-resolution failure
 * (the class of error this recovery server exists to handle).
 */
export function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "ERR_MODULE_NOT_FOUND" ||
    e.code === "MODULE_NOT_FOUND" ||
    (typeof e.message === "string" && /Cannot find (module|package)/.test(e.message))
  );
}

/**
 * Best-effort install-layout detection used to suggest the right reinstall
 * command. Returns "electron" when running inside the packaged Electron
 * resources tree, "npm-global" when running from a global npm install of
 * @blackbelt-technology/pi-agent-dashboard, or "monorepo" / "unknown".
 */
export function detectInstallLayout(scriptPath?: string): "electron" | "npm-global" | "monorepo" | "unknown" {
  const p = scriptPath ?? (process.argv[1] ?? "");
  if (/[/\\]Contents[/\\]Resources[/\\]/.test(p)) return "electron"; // macOS app bundle
  if (/[/\\]resources[/\\]/.test(p) && /Electron/i.test(p)) return "electron";
  if (/[/\\]node_modules[/\\]@blackbelt-technology[/\\]pi-agent-dashboard[/\\]/.test(p)) return "npm-global";
  if (/[/\\]packages[/\\]server[/\\]src[/\\]cli\.ts$/.test(p)) return "monorepo";
  return "unknown";
}

/**
 * Suggested reinstall command for the detected layout.
 */
export function suggestedReinstallCommand(layout: ReturnType<typeof detectInstallLayout>): string {
  switch (layout) {
    case "npm-global":
      return "npm install -g @blackbelt-technology/pi-agent-dashboard";
    case "electron":
      return "Reinstall the Pi Dashboard application from your installer.";
    case "monorepo":
      return "npm install   (from the repo root)";
    default:
      return "npm install -g @blackbelt-technology/pi-agent-dashboard";
  }
}

/**
 * Build the HTML page served at `/`. Pure function — exported for testing.
 */
export function buildRecoveryHtml(info: RecoveryInfo): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const missing = info.missingModule ? escape(info.missingModule) : "(unknown)";
  const fix = escape(info.suggestedFix ?? "");
  const stack = escape(info.error.stack ?? info.error.message ?? String(info.error));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Pi Dashboard — Recovery Mode</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #fef2f2; color: #1f2937; margin: 0; padding: 2rem; }
    main { max-width: 720px; margin: 0 auto; background: white; border-radius: 12px;
           box-shadow: 0 4px 16px rgba(0,0,0,.08); padding: 2rem; }
    h1 { color: #b91c1c; margin: 0 0 .5rem; font-size: 1.5rem; }
    .badge { display: inline-block; background: #fecaca; color: #991b1b;
             padding: .15rem .5rem; border-radius: 4px; font-size: .75rem;
             font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
    code { background: #f3f4f6; padding: .1rem .35rem; border-radius: 3px;
           font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
    pre { background: #1f2937; color: #f9fafb; padding: 1rem; border-radius: 6px;
          overflow-x: auto; font-size: .8em; line-height: 1.4; max-height: 280px; }
    button { background: #2563eb; color: white; border: 0; border-radius: 6px;
             padding: .55rem 1rem; font-size: .9em; cursor: pointer; margin-right: .5rem; }
    button:hover { background: #1d4ed8; }
    button.secondary { background: #6b7280; }
    button.secondary:hover { background: #4b5563; }
    button:disabled { background: #9ca3af; cursor: not-allowed; }
    #status { margin-top: 1rem; font-size: .9em; color: #4b5563; }
  </style>
</head>
<body>
<main>
  <span class="badge">Recovery Mode</span>
  <h1>Dashboard failed to start</h1>
  <p>The server could not load a required dependency:
     <code>${missing}</code></p>
  <p><strong>Suggested fix:</strong> <code>${fix}</code></p>
  <div>
    <button id="retry">Retry start</button>
    <button id="reinstall" class="secondary">Reinstall dependencies</button>
  </div>
  <div id="status"></div>
  <h3 style="margin-top: 1.5rem;">Error details</h3>
  <pre>${stack}</pre>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  function setBusy(b, msg) {
    $("retry").disabled = b; $("reinstall").disabled = b;
    status.textContent = msg;
  }
  async function post(path) {
    const res = await fetch(path, { method: "POST" });
    const text = await res.text();
    return { ok: res.ok, text };
  }
  $("retry").addEventListener("click", async () => {
    setBusy(true, "Retrying…");
    const r = await post("/api/recovery/retry");
    status.textContent = r.text;
    if (r.ok) setTimeout(() => location.reload(), 1500);
    else setBusy(false, "Retry failed: " + r.text);
  });
  $("reinstall").addEventListener("click", async () => {
    setBusy(true, "Reinstalling… this may take a minute.");
    const r = await post("/api/recovery/reinstall");
    status.textContent = r.text;
    setBusy(false, r.text);
  });
</script>
</body>
</html>`;
}

/**
 * Run `npm install -g ...` (or the per-layout equivalent) and stream
 * progress lines to a callback. Resolves with the exit code.
 */
function runReinstall(
  layout: ReturnType<typeof detectInstallLayout>,
  onLine: (s: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    if (layout === "monorepo") {
      cmd = "npm";
      args = ["install"];
    } else {
      cmd = "npm";
      args = ["install", "-g", "@blackbelt-technology/pi-agent-dashboard"];
    }
    onLine(`> ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout?.on("data", (b: Buffer) => onLine(b.toString("utf8").trimEnd()));
    child.stderr?.on("data", (b: Buffer) => onLine(b.toString("utf8").trimEnd()));
    child.on("error", (e: Error) => {
      onLine(`spawn error: ${e.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Start the recovery HTTP server. Resolves once listening with the bound port
 * (the server stays bound until the process exits, typically after
 * `/api/recovery/retry` respawns the CLI and `process.exit`s).
 *
 * Pass `port: 0` to bind an OS-assigned port (used by tests to stay
 * collision-free under parallel forks); the resolved value is the real port.
 *
 * If the port is already bound (something else listening), this will log
 * and exit with code 2 — better than silent infinite-recovery loops.
 */
export async function startRecoveryServer(info: RecoveryInfo): Promise<number> {
  const scriptPath = process.argv[1] ?? "";
  const layout = detectInstallLayout(scriptPath);
  const enrichedInfo: RecoveryInfo = {
    ...info,
    suggestedFix: info.suggestedFix ?? suggestedReinstallCommand(layout),
  };

  // Log a clear banner so log-tailers see what's happening.
  console.error("");
  console.error("══════════════════════════════════════════════════════════════");
  console.error("  Pi Dashboard — entering RECOVERY MODE");
  console.error(`  reason: ${enrichedInfo.error.message}`);
  console.error(`  missing: ${enrichedInfo.missingModule ?? "(unknown)"}`);
  console.error(`  suggested: ${enrichedInfo.suggestedFix}`);
  console.error(`  requested recovery bind port: ${info.port}`);
  console.error("══════════════════════════════════════════════════════════════");
  console.error("");

  // Persist a snapshot of the failure under ~/.pi/dashboard/last-recovery.json
  // so tooling/diagnostics can see why the server is in recovery mode.
  try {
    const dir = path.join(os.homedir(), ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "last-recovery.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          port: info.port,
          missingModule: enrichedInfo.missingModule ?? null,
          error: enrichedInfo.error.message,
          stack: enrichedInfo.error.stack ?? null,
          layout,
          scriptPath,
        },
        null,
        2,
      ),
    );
  } catch {
    // Non-fatal — recovery still works without the snapshot.
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
      });
      res.end(buildRecoveryHtml(enrichedInfo));
      return;
    }
    if (req.method === "GET" && url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          mode: "recovery",
          missingModule: enrichedInfo.missingModule ?? null,
          error: enrichedInfo.error.message,
          suggestedFix: enrichedInfo.suggestedFix,
          layout,
        }),
      );
      return;
    }
    if (req.method === "POST" && url === "/api/recovery/retry") {
      // Respawn ourselves detached, then exit.
      try {
        const cliPath = scriptPath || fileURLToPath(import.meta.url);
        const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        child.unref();
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("Respawning… give it a few seconds, then reload.");
        // Defer exit so the response actually flushes.
        setTimeout(() => process.exit(0), 250);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("Failed to respawn: " + msg);
      }
      return;
    }
    if (req.method === "POST" && url === "/api/recovery/reinstall") {
      // Stream isn't easy via simple text response; just buffer and return.
      const lines: string[] = [];
      runReinstall(layout, (s) => {
        lines.push(s);
        console.log("[recovery-install] " + s);
      }).then((code) => {
        if (res.writableEnded) return;
        if (code === 0) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("Reinstall complete. Click Retry start.");
        } else {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("Reinstall failed (exit " + code + ").\n\n" + lines.slice(-30).join("\n"));
        }
      });
      return;
    }

    // Everything else: serve the same HTML so SPA-style links still work.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(buildRecoveryHtml(enrichedInfo));
  });

  return new Promise<number>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[recovery] port ${info.port} already in use — cannot bind recovery server. ` +
            `Another process (possibly an older dashboard) is holding the port. ` +
            `Run \`pi-dashboard stop\` or kill the holder, then retry.`,
        );
        process.exit(2);
      }
      reject(err);
    });
    server.listen(info.port, () => {
      const addr = server.address();
      const bound = typeof addr === "object" && addr ? addr.port : info.port;
      console.error(`[recovery] listening on http://localhost:${bound}`);
      resolve(bound);
    });
  });
}
