/**
 * The app's own Vite `base` never leaks into the mock site (D11 (7)), against the REAL launcher (Vite via `serve-cli`, a plain
 * node child so the config load is not slowed by the vitest transform): without `--base` the site serves at `/`, with
 * `--base` at that prefix only, two sites of one project run side by side each at its own base, and the generated per-project
 * config carries no `base` and is byte-identical across launches.
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #E187).
 */
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freePort, httpGet } from "./mock-site-fake-launcher";
import { makeServableFixture } from "./mock-site-fixture";

vi.setConfig({ testTimeout: 600_000 });

const roots: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** Start the foreground launcher and wait for the marker at `<base>__mock/decisions`. */
async function start(root: string, port: number, base?: string): Promise<() => void> {
  const cli = path.resolve(__dirname, "../mock-site/serve-cli.mjs");
  const child = spawn(process.execPath, [cli, "--port", String(port), ...(base ? ["--base", base] : [])], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (c) => (out += c));
  child.stderr?.on("data", (c) => (out += c));
  const stop = () => void child.kill("SIGKILL");
  stops.push(stop);
  for (let i = 0; i < 240; i++) {
    if ((await httpGet(port, `${base ?? "/"}__mock/decisions`)).body.includes("mockSite")) return stop;
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`mock site did not start:\n${out.slice(-1500)}`);
}
const marks = async (port: number, p: string) => (await httpGet(port, p)).body.includes("mockSite");
/** This project's generated config(s): `node_modules` is a symlink shared with other fixtures, the file name carries a hash of the root. */
const generatedConfigs = (root: string) => {
  const dir = path.join(root, "node_modules/.vite-mock-site");
  const mine = `mock-site.config.${crypto.createHash("sha256").update(root).digest("hex").slice(0, 8)}.mjs`;
  return fs.existsSync(path.join(dir, mine)) ? [path.join(dir, mine)] : [];
};
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** A servable project whose APP config declares `base: '/app/'` (and no options file: skips the slow Vite load of it). */
function appWithBase(): string {
  const root = makeServableFixture();
  roots.push(root);
  fs.writeFileSync(path.join(root, "vite.config.mjs"), "export default { base: '/app/', define: { __FX__: '1' } };\n");
  fs.rmSync(path.join(root, "mockups/mock-site.config.ts"));
  return root;
}

describe("T.E187 — the app's base never leaks in; the site's base comes only from `--base`", () => {
  // A real Vite start costs ~35-45 s here, so independent projects start together; the two sites of ONE project start in sequence.
  it("app config base `/app/`: (a) no --base serves at `/` and not `/app/`; (b) --base serves at the prefix only; two sites of one project each serve their own base; the generated config has no `base` and is byte-identical", async () => {
    const [rootA, rootB, rootCD] = [appWithBase(), appWithBase(), appWithBase()];
    const [pa, pb, p1, p2] = [await freePort(), await freePort(), await freePort(), await freePort()];

    // (a) no --base, (b) --base /some/prefix/, and the first of the two concurrent sites, all booting at once
    const [stopA, stopB, stop1] = await Promise.all([start(rootA, pa), start(rootB, pb, "/some/prefix/"), start(rootCD, p1, "/one/")]);

    // (a)
    expect(await marks(pa, "/__mock/decisions")).toBe(true);
    const home = await httpGet(pa, "/");
    expect(home.status).toBe(200);
    expect(home.body).toContain('src="/@fs/'); // assets are rooted at `/`, not `/app/`
    expect(home.body).not.toContain("/app/@fs/");
    expect(await marks(pa, "/app/__mock/decisions")).toBe(false);
    expect((await httpGet(pa, "/app/")).body).not.toContain('id="root"');
    expect(await marks(pa, "/some/prefix/__mock/decisions")).toBe(false);

    // (b)
    const prefixed = await httpGet(pb, "/some/prefix/");
    expect(prefixed.status).toBe(200);
    expect(prefixed.body).toContain('src="/some/prefix/@fs/');
    expect(await marks(pb, "/some/prefix/__mock/decisions")).toBe(true);
    for (const p of ["/", "/app/", "/__mock/decisions", "/app/__mock/decisions"]) {
      const r = await httpGet(pb, p);
      expect(r.body.includes("mockSite") || r.body.includes('id="root"'), p).toBe(false);
    }

    // Two sites of one project: the generated config (one file per project) carries no `base` and survives the second launch untouched.
    const [cfg] = generatedConfigs(rootCD);
    expect(generatedConfigs(rootCD)).toHaveLength(1);
    const text = fs.readFileSync(cfg, "utf8");
    expect(text).not.toMatch(/["']?base["']?\s*:/); // no `base` key
    expect(text).not.toMatch(/\/one\/|\/two\/|some\/prefix/); // none of the launcher's bases either
    const before = sha(cfg);
    const stop2 = await start(rootCD, p2, "/two/");
    await new Promise((r) => setTimeout(r, 1500)); // let a config-change restart (if any) settle
    expect(sha(cfg)).toBe(before); // byte-identical after the second launch
    expect(generatedConfigs(rootCD)).toEqual([cfg]);

    expect(await marks(p1, "/one/__mock/decisions")).toBe(true);
    expect(await marks(p2, "/two/__mock/decisions")).toBe(true);
    expect(await marks(p1, "/two/__mock/decisions")).toBe(false);
    expect(await marks(p2, "/one/__mock/decisions")).toBe(false);
    expect((await httpGet(p1, "/one/")).body).toContain('src="/one/@fs/');
    expect((await httpGet(p2, "/two/")).body).toContain('src="/two/@fs/');
    for (const [port, prefix] of [[p1, "/app/"], [p2, "/app/"], [p1, "/"], [p2, "/"]] as const) expect(await marks(port, `${prefix}__mock/decisions`), `${port}${prefix}`).toBe(false);
    for (const stop of [stopA, stopB, stop1, stop2]) stop();
  });
});
