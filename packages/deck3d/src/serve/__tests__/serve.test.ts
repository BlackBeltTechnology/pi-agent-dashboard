/**
 * `deck3d serve` — the authoring server (Section 15).
 *
 * These cover the contract at the HTTP boundary: rebuild-on-change, last-good
 * retention, loopback confinement, and the WRITE endpoints. The write path is
 * the reason this server never leaves loopback, so its refusals are asserted
 * as hard requirements, not conveniences.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startServe, type ServeHandle } from "../index.js";

const DECK = `# Opening

- one

# Second

- two
`;

function deckDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-serve-"));
  writeFileSync(join(dir, "deck.md"), DECK);
  return dir;
}

const open: ServeHandle[] = [];
async function serve(dir: string, opts: Parameters<typeof startServe>[1] = {}): Promise<ServeHandle> {
  const h = await startServe(join(dir, "deck.md"), opts);
  open.push(h);
  return h;
}

afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

/**
 * The palette the SERVED copy actually carries. A substring match on the html
 * is worthless here: the runtime bundle contains "remember", so
 * `toContain("ember")` passes even when nothing rebuilt.
 */
async function servedPalette(h: ServeHandle): Promise<string | undefined> {
  const html = await (await fetch(h.url)).text();
  const m = html.match(/window\.__DECK=(\{[\s\S]*?\});window\.__DECK_FONT=/);
  if (!m) return undefined;
  return (JSON.parse(m[1]) as { defaults?: { palette?: string } }).defaults?.palette;
}

async function post(h: ServeHandle, path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${h.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("S serve: watch and rebuild", () => {
  it("#S1 serves the built deck and rebuilds when the source changes", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const first = await (await fetch(h.url)).text();
    expect(first).toContain("window.__DECK");
    expect(first).toContain("Opening");

    writeFileSync(join(dir, "deck.md"), `${DECK}\n# Appended\n\n- three\n`);
    await h.settled();
    expect(await (await fetch(h.url)).text()).toContain("Appended");
  }, 120_000);

  it("#S12 rebuilds when deck.json is edited out of band, without a rebuild storm", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const jsonPath = join(dir, "deck.json");

    // An editor or `deck3d overrides apply` writing the overrides block is the
    // other half of the tune loop — the HTTP endpoints are not the only writer.
    const ir = JSON.parse(readFileSync(jsonPath, "utf8")) as { overrides?: Record<string, unknown> };
    ir.overrides = { ...(ir.overrides ?? {}), deck: { palette: "ember" } };
    writeFileSync(jsonPath, `${JSON.stringify(ir, null, 2)}\n`);
    await new Promise((r) => setTimeout(r, 600));
    await h.settled();
    expect(await servedPalette(h)).toBe("ember");

    // Watching the file the rebuild itself rewrites must not self-trigger:
    // a settled server leaves deck.json alone.
    const stable = statSync(jsonPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 900));
    await h.settled();
    expect(statSync(jsonPath).mtimeMs).toBe(stable);
  }, 120_000);

  it("#S3 keeps serving the last good deck when a rebuild fails", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const good = await (await fetch(h.url)).text();
    expect(good).toContain("Opening");

    // Front matter naming an unknown key fails validation — an empty buffer
    // would not: it parses to a zero-slide deck and renders fine.
    writeFileSync(join(dir, "deck.md"), `---\ntitle: nope\n---\n\n# Broken\n\n- x\n`);
    await h.settled();
    const res = await fetch(h.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Opening");
    expect(h.lastError()).toBeTruthy();

    // ...and it recovers on the next valid edit.
    writeFileSync(join(dir, "deck.md"), `${DECK}\n# Recovered\n\n- four\n`);
    await h.settled();
    expect(await (await fetch(h.url)).text()).toContain("Recovered");
    expect(h.lastError()).toBeNull();
  }, 120_000);

  it("#S4 binds loopback only", async () => {
    const h = await serve(deckDir());
    expect(h.host).toBe("127.0.0.1");
    expect(h.url.startsWith("http://127.0.0.1:")).toBe(true);
  }, 120_000);

  it("#S5 injects the reload client ONLY into the served copy", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    expect(await (await fetch(h.url)).text()).toContain('EventSource("/__events")');
    // The on-disk artifact a `build` would produce stays offline and clientless.
    // (The bundle mentions `__deck3dServe` either way — the panel feature-detects
    // it — so the stream subscription is what distinguishes the served copy.)
    expect(readFileSync(h.htmlPath, "utf8")).not.toContain('EventSource("/__events")');
  }, 120_000);
});

describe("S serve: write endpoints", () => {
  it("#S6 POST /__overrides writes overrides.json beside the deck", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const r = await post(h, "/__overrides", { deck: { palette: "ember" } });
    expect(r.status).toBe(200);
    const written = JSON.parse(readFileSync(join(dir, "overrides.json"), "utf8")) as { deck: { palette: string } };
    expect(written.deck.palette).toBe("ember");
  }, 120_000);

  it("#S7 POST /__apply merges into deck.json overrides", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    expect((await post(h, "/__apply", { deck: { palette: "ember" } })).status).toBe(200);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as { overrides: { deck: { palette: string } } };
    expect(deck.overrides.deck.palette).toBe("ember");
    // The merged value is what gets served next.
    await h.settled();
    expect(await servedPalette(h)).toBe("ember");
  }, 120_000);

  it("#S9 refuses an invalid payload and leaves both targets untouched", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const before = readFileSync(join(dir, "deck.json"), "utf8");
    const r = await post(h, "/__apply", { deck: { palette: "not-a-palette" } });
    expect(r.status).toBe(400);
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "overrides.json"))).toBe(false);
  }, 120_000);

  it("#S8 refuses a write that would escape the deck directory", async () => {
    const dir = deckDir();
    const h = await serve(dir);
    const r = await post(h, "/__overrides?path=../escaped.json", { deck: { palette: "ember" } });
    expect(r.status).toBe(400);
    expect(existsSync(join(dir, "..", "escaped.json"))).toBe(false);
  }, 120_000);
});

describe.skipIf(!process.env.CI && !existsSync(join(process.env.HOME ?? "", "Library/Caches/ms-playwright")))("S serve: browser (chromium)", () => {
  it("#S4b reloads onto the slide the author was on, and Save writes to disk", async () => {
    const { chromium } = await import("playwright");
    const dir = deckDir();
    const h = await serve(dir);
    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    try {
      await page.goto(h.url);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(1200);
      expect(await page.evaluate(() => window.__deck3d!.current())).toBe(2);

      // An edit triggers a rebuild; the client reloads itself.
      writeFileSync(join(dir, "deck.md"), `${DECK}\n# Appended\n\n- three\n`);
      await page.waitForFunction(() => document.body.textContent?.includes("Appended") === true, undefined, { timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.waitForTimeout(800);
      // Position preserved across the automatic reload.
      expect(await page.evaluate(() => window.__deck3d!.current())).toBe(2);

      // Save goes to disk with no download involved.
      await page.keyboard.press("c");
      await page.evaluate(() => document.querySelectorAll("#deck3d-hud details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
      await page.evaluate(() => {
        const n = document.querySelector('#deck3d-hud [data-path="palette"]') as HTMLSelectElement;
        n.value = "ember";
        n.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.click("#deck3d-hud-save");
      await page.waitForTimeout(1200);
      const saved = JSON.parse(readFileSync(join(dir, "overrides.json"), "utf8")) as { deck: { palette: string } };
      expect(saved.deck.palette).toBe("ember");
    } finally {
      await browser.close();
    }
  }, 180_000);
});

/**
 * #S10 — the CLI path, not the in-process one. Every other test here calls
 * `startServe()` directly, which never evaluates `cli.ts` as the process
 * ENTRY. That mattered: `serve/index.ts` imports `run` from `cli.ts`, so when
 * `cli.ts` is the entry its top-level `await run(...)` is still pending and
 * the cycle's `await import("./serve/index.js")` can never resolve — the
 * process just exits 13 ("unsettled top-level await"). Only a spawned CLI
 * reproduces it.
 */
describe("S10 serve: the spawned CLI actually serves", () => {
  it("stays up and answers on its port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-serve-cli-"));
    writeFileSync(join(dir, "deck.md"), DECK);
    const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bin", "deck3d");
    const child = spawn(process.execPath, [bin, "serve", "deck.md", "--port", "4839"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => {
      out += String(b);
    });
    child.stderr.on("data", (b) => {
      out += String(b);
    });
    try {
      const deadline = Date.now() + 60_000;
      let res: Response | null = null;
      while (Date.now() < deadline && res === null) {
        await new Promise((r) => setTimeout(r, 500));
        if (child.exitCode !== null) break;
        res = await fetch("http://127.0.0.1:4839/").catch(() => null);
      }
      expect(child.exitCode, `CLI exited early:\n${out}`).toBeNull();
      expect(res?.status).toBe(200);
      expect(await res!.text()).toContain("__deck3dServe");
    } finally {
      child.kill("SIGTERM");
    }
  }, 90_000);
});
