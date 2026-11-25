import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { makeFixture } from "./mock-site-fixture";

/**
 * A project whose declared launcher is a tiny node script (no Vite, no options file, so a start costs only a node boot).
 * It honours `--port` / `--base`, appends `{argv, at}` to `$FAKE_LOG`, and is shaped by env knobs read at spawn time:
 *  - `FAKE_READY_FILE`   listen at once, but answer every request `503` until that file exists, then serve the marker;
 *  - `FAKE_IGNORE_BASE`  serve the marker at THIS base whatever `--base` says (a launcher that ignores the flag).
 */
const LAUNCHER = `import http from "node:http"; import fs from "node:fs";
const a = process.argv; const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: a.slice(2), at: Date.now() }) + "\\n");
const base = process.env.FAKE_IGNORE_BASE ?? val("--base") ?? "/";
const ready = () => !process.env.FAKE_READY_FILE || fs.existsSync(process.env.FAKE_READY_FILE);
console.log("fake-launcher: waiting for readiness on base " + base);
http.createServer((q, s) => {
  if (!ready()) { s.statusCode = 503; return s.end('{"starting":true}'); }
  if (q.url === base + "__mock/decisions") { s.setHeader("content-type", "application/json"); s.end('{"mockSite":true}'); } else { s.statusCode = 404; s.end(); }
}).listen(Number(val("--port")), "127.0.0.1");
`;

export function makeFakeLauncherProject(opts: { appBase?: string } = {}): { root: string; launcher: string; log: string } {
  const root = makeFixture();
  fs.rmSync(path.join(root, "mockups", "mock-site.config.ts")); // no options file: nothing is loaded through Vite
  fs.writeFileSync(path.join(root, "vite.config.mjs"), `export default { ${opts.appBase ? `base: ${JSON.stringify(opts.appBase)}, ` : ""}define: { __FX__: '1' } };\n`);
  fs.writeFileSync(path.join(root, "fake-launcher.mjs"), LAUNCHER);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", private: true, type: "module", mockSite: { launcher: "fake-launcher.mjs", config: "vite.config.mjs" } }));
  return { root, launcher: path.join(root, "fake-launcher.mjs"), log: path.join(root, "argv.log") };
}

export const freePort = (): Promise<number> =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

export const portRefused = (port: number): Promise<boolean> =>
  new Promise((r) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      r(false);
    });
    s.on("error", () => r(true));
  });

export const httpGet = (port: number, p: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, agent: false, timeout: 5000 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
  });

export const launchLog = (log: string): { argv: string[]; at: number }[] =>
  fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
