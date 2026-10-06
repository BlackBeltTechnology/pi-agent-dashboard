/**
 * A minimal static server for the team SPA build on its OWN origin (the optional standalone
 * deployment): serves `dist/app` under `/apps/team/` with a runtime `config.json`, SPA fallback
 * for deep links and the OIDC callback. See change: add-team-plugin (D11).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

export interface StaticApp {
  origin: string;
  setDashboardUrl(url: string): void;
  close(): Promise<void>;
}

export async function startStaticApp(distDir: string): Promise<StaticApp> {
  let dashboardUrl = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/apps/team")) {
      res.writeHead(404).end();
      return;
    }
    if (url.pathname === "/apps/team/config.json") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ dashboardUrl }));
      return;
    }
    const rel = decodeURIComponent(url.pathname.slice("/apps/team/".length));
    const candidate = path.resolve(distDir, rel);
    const file = rel && candidate.startsWith(path.resolve(distDir)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(distDir, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    setDashboardUrl: (u) => {
      dashboardUrl = u;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
