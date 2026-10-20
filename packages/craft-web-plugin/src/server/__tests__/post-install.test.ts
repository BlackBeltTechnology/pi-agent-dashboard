/**
 * Post-install (design D3): every executable inline script externalized in order, ready-hook injection
 * (exactly once), profile + shim (+ worker) scripts first, markers, idempotence, `.gz` siblings (no `.br`),
 * `craft-build.json`. Test-plan #E5, #E7; E13 of edit-office-in-pane-with-craft-web.
 * Fixtures under `fixtures/post-install/` are the pristine `index.html` of the released web zips
 * (WordCraft 0.8.0, SoundCraft 0.8.0, FilmCraft 0.9.0, LightCraft 0.9.1).
 * See change: edit-office-in-pane-with-craft-web (D2), extend-craft-web-to-all-apps (D3).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { CRAFT_APP_PROFILES, type CraftAppProfile } from "../../shared/app-profiles.js";
import { BUILD_INFO_FILE, createPostInstall, profileHash, readBuildInfo } from "../post-install.js";
import { cleanupTmp, TRUNK_BOOTSTRAP, tmp, writeShim, writeTrunkBuild } from "./helpers.js";

afterEach(cleanupTmp);

const FIXTURES = path.join(__dirname, "fixtures", "post-install");
const WORDCRAFT = CRAFT_APP_PROFILES.find((p) => p.appId === "wordcraft") as CraftAppProfile;

const profileOf = (appId: string, ready: CraftAppProfile["ready"], extra: Partial<CraftAppProfile> = {}): CraftAppProfile => ({
  ...WORDCRAFT,
  appId,
  label: appId,
  ready,
  title: undefined,
  openedFallbackMs: 3000,
  cleanOnAckedSave: true,
  ...extra,
});

const PROFILES: Record<string, CraftAppProfile> = {
  wordcraft: WORDCRAFT,
  soundcraft: profileOf("soundcraft", { kind: "trunk" }),
  filmcraft: profileOf("filmcraft", { kind: "load-ready-ms", global: "filmcraftLoad" }),
  lightcraft: profileOf("lightcraft", { kind: "after-start-call", call: "start" }, { workerTrampoline: true }),
};

const ctx = (dir: string, app = "wordcraft", shimVersion = 2) => ({ dir, app: app as "wordcraft", version: "0.8.0", shimVersion });

function setup(o: { br?: boolean; html?: string; profiles?: Record<string, CraftAppProfile> } = {}) {
  const dir = writeTrunkBuild(path.join(tmp(), "tree"), o);
  if (o.html !== undefined) fs.writeFileSync(path.join(dir, "index.html"), o.html);
  const shim = writeShim(tmp(), 2);
  const worker = path.join(tmp(), "craft-worker.js");
  fs.writeFileSync(worker, "/* worker trampoline */\n");
  const profiles = o.profiles ?? PROFILES;
  return { dir, run: createPostInstall(shim, { profile: (a) => profiles[a], workerSourcePath: worker }) };
}

const fixture = (app: string): string => fs.readFileSync(path.join(FIXTURES, `${app}.html`), "utf8");
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const readIndex = (dir: string): string => fs.readFileSync(path.join(dir, "index.html"), "utf8");
/** `src` of every script tag, document order. */
const scriptSrcs = (html: string): string[] => [...html.matchAll(/<script\b[^>]*\bsrc="\.\/([^"]+)"/g)].map((m) => m[1]);
/** Inline scripts that would execute (no src; no type, text/javascript or module). */
const executableInline = (html: string): string[] =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc=/.test(m[1]))
    .filter((m) => !/\btype=/.test(m[1]) || /type="(module|text\/javascript)"/.test(m[1]))
    .map((m) => m[2]);
const allInlineJs = (dir: string): string =>
  fs
    .readdirSync(dir)
    .filter((f) => /^inline-\d+-[0-9a-f]{10}\.js$/.test(f))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");

describe("post-install basics (E13 of edit-office-in-pane-with-craft-web)", () => {
  it("leaves no inline script; the shim and the externalized bootstrap are each referenced once, shim first", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const html = readIndex(dir);
    expect(executableInline(html)).toEqual([]);
    const srcs = scriptSrcs(html);
    const shim = srcs.find((f) => /^craft-shim-[0-9a-f]{10}\.js$/.test(f));
    const prof = srcs.find((f) => /^craft-profile-[0-9a-f]{10}\.js$/.test(f));
    const boot = srcs.find((f) => /^inline-0-[0-9a-f]{10}\.js$/.test(f));
    expect(shim && prof && boot).toBeTruthy();
    expect(count(html, `./${shim}`)).toBe(1);
    expect(count(html, `./${boot}`)).toBe(1);
    expect(fs.readFileSync(path.join(dir, boot as string), "utf8")).toBe(TRUNK_BOOTSTRAP);
    expect(srcs.indexOf(prof as string)).toBeLessThan(srcs.indexOf(shim as string));
    expect(srcs.indexOf(shim as string)).toBeLessThan(srcs.indexOf(boot as string));
    expect(html).toMatch(new RegExp(`<script type="module" src="./${boot}"`));
    expect(html).toContain("<!-- craft-shim:2 -->");
    expect(html).toContain(`<!-- craft-profile:${profileHash(WORDCRAFT)} -->`);
  });

  it("the profile script sets window.__CRAFT_PROFILE__ from the profile", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const prof = scriptSrcs(readIndex(dir)).find((f) => f.startsWith("craft-profile-")) as string;
    const win: { __CRAFT_PROFILE__?: { appId: string; title: { pattern: string } } } = {};
    new Function("window", fs.readFileSync(path.join(dir, prof), "utf8"))(win);
    expect(win.__CRAFT_PROFILE__?.appId).toBe("wordcraft");
    expect(win.__CRAFT_PROFILE__?.title.pattern).toBe(WORDCRAFT.title?.pattern);
  });

  it("is idempotent on a rerun", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const first = readIndex(dir);
    const names = fs.readdirSync(dir).sort();
    await run(ctx(dir));
    expect(readIndex(dir)).toBe(first);
    expect(fs.readdirSync(dir).sort()).toEqual(names);
    expect(count(first, "craft-shim:")).toBe(1);
  });

  it("refuses a tree already shimmed with another version or another profile", async () => {
    const { dir, run } = setup();
    await run(ctx(dir, "wordcraft", 1));
    await expect(run(ctx(dir, "wordcraft", 2))).rejects.toThrow(/already carries craft-shim 1/);
    const other = createPostInstall(writeShim(tmp(), 1), { profile: () => ({ ...WORDCRAFT, cleanOnAckedSave: true }) });
    await expect(other(ctx(dir, "wordcraft", 1))).rejects.toThrow(/already carries craft-profile/);
  });

  it("fails for an app without a profile", async () => {
    const { dir, run } = setup();
    await expect(run(ctx(dir, "figcraft"))).rejects.toThrow(/figcraft has no craft-web adapter profile/);
  });

  it("writes .gz siblings for wasm/js/html/css, never .br, and removes a shipped .br", async () => {
    const { dir, run } = setup({ br: true });
    await run(ctx(dir));
    const all = fs.readdirSync(dir);
    for (const f of ["index.html", "wordcraft-1a2b3c.js", "wordcraft-1a2b3c_bg.wasm"]) expect(all).toContain(`${f}.gz`);
    expect(all.filter((f) => f.endsWith(".br"))).toEqual([]);
    expect(all).not.toContain("icon.png.gz");
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, "index.html.gz"))).toString()).toBe(readIndex(dir));
  });

  it("writes craft-build.json {app, version, shimVersion, profileHash, sizeGzip}", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const info = readBuildInfo(dir);
    expect(info).toMatchObject({ app: "wordcraft", version: "0.8.0", shimVersion: 2, profileHash: profileHash(WORDCRAFT) });
    const expected = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".gz") || f === "icon.png")
      .reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    expect(info?.sizeGzip).toBe(expected);
    expect(fs.existsSync(path.join(dir, BUILD_INFO_FILE))).toBe(true);
  });

  it("readBuildInfo is null for an absent or malformed file; a v1 file without profileHash still parses", () => {
    const dir = tmp();
    expect(readBuildInfo(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, BUILD_INFO_FILE), "{nope");
    expect(readBuildInfo(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, BUILD_INFO_FILE), JSON.stringify({ app: "wordcraft", version: "0.8.0", shimVersion: 1, sizeGzip: 9 }));
    expect(readBuildInfo(dir)).toEqual({ app: "wordcraft", version: "0.8.0", shimVersion: 1, sizeGzip: 9 });
  });
});

describe("E5 executable-script externalization over released index.html fixtures", () => {
  for (const app of ["wordcraft", "soundcraft", "filmcraft", "lightcraft"]) {
    it(`${app}: no executable inline script left, order preserved, one dispatch after the hook point, profile before shim`, async () => {
      const original = fixture(app);
      const inlineBefore = executableInline(original);
      const { dir, run } = setup({ html: original });
      await run(ctx(dir, app));
      const html = readIndex(dir);
      expect(executableInline(html)).toEqual([]);
      const srcs = scriptSrcs(html);
      const inlineFiles = srcs.filter((f) => f.startsWith("inline-"));
      expect(inlineFiles.map((f) => Number(f.split("-")[1]))).toEqual(inlineBefore.map((_, i) => i));
      // each externalized file is the original body (plus the injected dispatch for non-Trunk loaders)
      const bodies = inlineFiles.map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
      bodies.forEach((b, i) => expect(b.startsWith(inlineBefore[i].slice(0, 40))).toBe(true));
      // TrunkApplicationStarted is dispatched exactly once across the build's inline code
      expect(count(allInlineJs(dir), "TrunkApplicationStarted")).toBe(1);
      const ready = PROFILES[app].ready;
      const js = allInlineJs(dir);
      if (ready.kind === "load-ready-ms") expect(js).toMatch(/window\.filmcraftLoad\.readyMs = performance\.now\(\) - t0;\n;dispatchEvent\(new CustomEvent\("TrunkApplicationStarted"\)\);/);
      if (ready.kind === "after-start-call") expect(js).toMatch(/start\(font\);\n;dispatchEvent\(new CustomEvent\("TrunkApplicationStarted"\)\);/);
      const prof = srcs.findIndex((f) => f.startsWith("craft-profile-"));
      const shim = srcs.findIndex((f) => f.startsWith("craft-shim-"));
      expect(prof).toBeGreaterThanOrEqual(0);
      expect(prof).toBeLessThan(shim);
      expect(shim).toBeLessThan(srcs.findIndex((f) => f.startsWith("inline-")));
      // a classic inline script stays classic, a module stays a module
      for (const f of inlineFiles) {
        const i = Number(f.split("-")[1]);
        const wasModule = new RegExp(`<script type="module">\\s*${inlineBefore[i].trim().slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(original);
        expect(new RegExp(`<script type="module" src="./${f}"`).test(html)).toBe(wasModule);
      }
      // worker trampoline only for profiles that ask for it, loaded first
      const worker = srcs.findIndex((f) => f.startsWith("craft-worker-"));
      if (PROFILES[app].workerTrampoline) expect(worker).toBe(0);
      else expect(worker).toBe(-1);
      // rerun is idempotent
      const names = fs.readdirSync(dir).sort();
      await run(ctx(dir, app));
      expect(readIndex(dir)).toBe(html);
      expect(fs.readdirSync(dir).sort()).toEqual(names);
    });
  }

  it("SoundCraft keeps both inline scripts in their places (head module, body classic)", async () => {
    const { dir, run } = setup({ html: fixture("soundcraft") });
    await run(ctx(dir, "soundcraft"));
    const html = readIndex(dir);
    const body = html.slice(html.indexOf("<body>"));
    expect(body).toMatch(/<script src="\.\/inline-1-[0-9a-f]{10}\.js" crossorigin="anonymous"><\/script>/);
    expect(html.slice(0, html.indexOf("<body>"))).toMatch(/<script type="module" src="\.\/inline-0-/);
  });

  it("a JSON data block stays inline", async () => {
    const html = fixture("wordcraft").replace("<body>", `<body>\n<script type="application/json" id="cfg">{"a":1}</script>`);
    const { dir, run } = setup({ html });
    await run(ctx(dir));
    expect(readIndex(dir)).toContain(`<script type="application/json" id="cfg">{"a":1}</script>`);
  });

  it("an inline importmap fails", async () => {
    const html = fixture("wordcraft").replace("<head>", `<head><script type="importmap">{"imports":{}}</script>`);
    const { dir, run } = setup({ html });
    await expect(run(ctx(dir))).rejects.toThrow(/inline importmap/);
  });

  it("a loader whose hook point matches zero times fails and leaves index.html untouched", async () => {
    const html = fixture("filmcraft").replace("window.filmcraftLoad.readyMs = performance.now() - t0;", "window.filmcraftLoad.done = 1;");
    const { dir, run } = setup({ html });
    await expect(run(ctx(dir, "filmcraft"))).rejects.toThrow(/matched 0 times/);
    expect(readIndex(dir)).toBe(html);
  });

  it("a loader whose hook point matches twice fails", async () => {
    const html = fixture("lightcraft").replace("start(font);", "start(font);\n      start(font);");
    const { dir, run } = setup({ html });
    await expect(run(ctx(dir, "lightcraft"))).rejects.toThrow(/matched 2 times/);
  });

  it("a Trunk build with no (or two) TrunkApplicationStarted dispatches fails", async () => {
    const { dir, run } = setup({ html: "<html><head></head><body><script src='x.js'></script></body></html>" });
    await expect(run(ctx(dir))).rejects.toThrow(/exactly one inline Trunk bootstrap/);
    const one = 'dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));';
    const twice = setup({ html: fixture("wordcraft").replace(one, `${one}\n${one}`) });
    await expect(twice.run(ctx(twice.dir))).rejects.toThrow(/found 2 TrunkApplicationStarted/);
  });
});

describe("E7 downgrade parse", () => {
  it("the v1 MARKER_RE reads the shim version of a v2 index.html (both marker lines)", async () => {
    const { dir, run } = setup();
    await run(ctx(dir, "wordcraft", 2));
    const html = readIndex(dir);
    expect(html).toMatch(/<!-- craft-profile:[0-9a-f]{10} -->/);
    expect(/<!-- craft-shim:(\d+) -->/.exec(html)?.[1]).toBe("2");
  });
});
