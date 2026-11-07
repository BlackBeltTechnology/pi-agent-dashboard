import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { prepareMockSite } from "../../../packages/mockup-loop/src/mock-site/env.mjs";
import { MARKER, makeE2eProject } from "./fixture.js";

/**
 * Start the live-component mock site for `playwright.mock-site.config.ts`: a temp fixture
 * project (dashboard example mock + e2e mocks) started like `serve_mock_site` does —
 * detected Vite launcher on the generated config that inherits the fixture's app config —
 * on a free port. No docker harness. See change: add-live-component-mock-site
 * (test-plan, New infra), add-mock-site-exact-env.
 */
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});
const ready = (port: number) => new Promise<boolean>((resolve) => {
  const r = http.get({ host: "127.0.0.1", port, path: "/__mock/decisions", agent: false }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b).mockSite === true); } catch { resolve(false); } }); });
  r.on("error", () => resolve(false));
});

export default async function mockSiteGlobalSetup(): Promise<void> {
  const root = makeE2eProject();
  const port = await freePort();
  const prep = await prepareMockSite(root);
  if (!prep.ok) throw new Error(`mock site: ${prep.error}`);
  const child = spawn(process.execPath, [prep.launcher, "--config", prep.generated, "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", detached: false });
  const t0 = Date.now();
  while (!(await ready(port))) {
    if (child.exitCode !== null) throw new Error("mock site exited during start");
    if (Date.now() - t0 > 60_000) { child.kill("SIGKILL"); throw new Error("mock site not ready in 60s"); }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.unref();
  fs.writeFileSync(MARKER, JSON.stringify({ root, port, pid: child.pid, url: `http://localhost:${port}` }));
}
