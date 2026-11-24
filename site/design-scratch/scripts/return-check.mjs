#!/usr/bin/env node
/**
 * Browser check for the static Google sign-in return page (site/oauth/return.html).
 *
 *   cd site && npm run build && npm run check:return [-- --only B24,B25] [--links] [--shots DIR]
 *
 * shoot.mjs --audit only ever loads index.html, so it cannot see a CSP violation on the return
 * page. This driver serves site/dist/ itself, loads oauth/return.html in Chromium with request /
 * dialog / CSP-violation logging, and fails (exit 1) on any scenario below. Every scenario id is
 * the test-plan id of change add-google-connect (B24 = #B24, GB1 = #GB1 …). The dashboard origin
 * the page hands off to is a fake `https://dash.example` answered by Playwright routing, so
 * "requests to A" can be counted without a dashboard.
 *
 * `--links` also runs the audit with its real-network external-link check (B179).
 * Playwright resolution mirrors shoot.mjs: bind to the ROOT install (site/ has an older copy
 * whose browsers were never downloaded).
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInlineHashes, cspHash } from "../../csp.mjs";

const require = createRequire(import.meta.url);
const SITE = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(SITE, "dist");
let dir = SITE;
let rootPlaywright = null;
while (dir !== dirname(dir)) {
  if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const p = join(dir, "node_modules", "playwright");
    if (existsSync(p)) rootPlaywright = p;
    break;
  }
  dir = dirname(dir);
}
const { chromium } = rootPlaywright ? require(rootPlaywright) : await import("playwright");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const ONLY = opt("only")?.split(",");
const SHOTS = opt("shots");
if (SHOTS) await mkdir(SHOTS, { recursive: true });

if (!existsSync(join(DIST, "oauth", "return.html"))) {
  console.error("site/dist/oauth/return.html is missing — run `npm run build` first");
  process.exit(2);
}

// ---- static server for dist/ (+ per-path overrides and a frame host) -----------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain", ".xml": "application/xml" };
const overrides = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/__frame.html") {
    res.setHeader("content-type", MIME[".html"]);
    res.end(`<!doctype html><iframe id="f" src="${(url.searchParams.get("src") ?? "").replace(/"/g, "&quot;")}" width="600" height="500"></iframe>`);
    return;
  }
  if (overrides.has(url.pathname)) {
    res.setHeader("content-type", MIME[".html"]);
    res.end(overrides.get(url.pathname));
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return void res.writeHead(403).end();
  if (!extname(file)) file = join(file, "index.html");
  try {
    const body = await readFile(file);
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const RETURN = `${BASE}/oauth/return.html`;
const A = "https://dash.example";
const CALLBACK = "/api/plugins/google/oauth/remote-callback";
const FLOW = "flow-0a1b2c";
const GENERIC = "This sign-in link can\u2019t be used";
const CANCELLED = "Google sign-in was cancelled";

const browser = await chromium.launch();
const html = await readFile(join(DIST, "oauth", "return.html"), "utf8");
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

// ---- helpers --------------------------------------------------------------------------------------
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (a, b, msg) => assert(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const q = (o) => new URLSearchParams(o).toString();
const state = (origin, flow = FLOW) => `${flow}~${origin}`;
const returnUrl = (o) => `${RETURN}?${q(o)}`;
const callbackUrl = (origin, o) => `${origin}${CALLBACK}?${q(o)}`;

/** A page with logging; every non-local origin is answered by a stub dashboard. */
async function open(fn, { width = 1000, scheme = "dark", init } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route((u) => u.hostname !== "127.0.0.1", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>dashboard</title>dashboard" }));
  const page = await context.newPage();
  const log = { requests: [], dialogs: 0, errors: [], csp: 0, popups: 0 };
  page.on("request", (r) => log.requests.push({ url: r.url(), referer: r.headers().referer }));
  page.on("dialog", (d) => (log.dialogs++, d.dismiss()));
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("popup", () => log.popups++);
  page.on("console", (m) => /content security policy/i.test(m.text()) && log.csp++);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", () => (window.__csp = (window.__csp ?? 0) + 1));
  });
  if (init) await page.addInitScript(init);
  try {
    return await fn(page, log, context);
  } finally {
    await context.close();
  }
}
const toHost = (log, origin) => log.requests.filter((r) => r.url.startsWith(origin));
const visible = (page, sel) => page.locator(sel).isVisible();
const cspCount = async (page, log) => log.csp + ((await page.evaluate(() => window.__csp ?? 0)) || 0);
const secret = (n) => `CODE-${"0123456789abcdef".repeat(Math.ceil(n / 16))}`.slice(0, n);

let auditRun;
const audit = () =>
  (auditRun ??= new Promise((resolve) => {
    const out = [];
    const args = ["design-scratch/scripts/shoot.mjs", "--audit", "--base", BASE, ...(flag("links") ? ["--links"] : [])];
    const p = spawn(process.execPath, args, { cwd: SITE });
    p.stdout.on("data", (d) => out.push(String(d)));
    p.stderr.on("data", (d) => out.push(String(d)));
    p.on("close", (code) => resolve({ code, out: out.join("").slice(-800) }));
  }));

// ---- scenarios ------------------------------------------------------------------------------------
const scenarios = [];
const check = (id, title, fn) => scenarios.push({ id, title, fn });

check("B24", "return page: code leaves the address bar, origin shown, Continue present, nothing navigated", () =>
  open(async (page, log) => {
    const code = secret(24);
    await page.goto(returnUrl({ code, state: state(A) }));
    assert(!page.url().includes(code), "address bar still contains the code");
    eq(page.url(), RETURN, "address bar");
    eq(await page.locator("#origin").innerText(), A, "origin text");
    assert(await visible(page, "#origin"), "origin not visible");
    eq(await page.locator("#go").innerText(), `Continue to ${A}`, "Continue label");
    eq(toHost(log, A).length, 0, "requests to the dashboard before the click");
    assert(!(await page.locator("body").innerText()).includes(code), "code rendered in the DOM");
  }));

check("B25", "Continue navigates the SAME window to the remote callback; no opener/postMessage/popup", () =>
  open(async (page, log, context) => {
    const code = secret(40);
    const s = state(A);
    await page.goto(returnUrl({ code, state: s }));
    eq(await page.evaluate(() => window.opener), null, "window.opener");
    await page.click("#go");
    const target = callbackUrl(A, { code, state: s });
    await page.waitForURL(target);
    eq(toHost(log, A).map((r) => r.url).join(), target, "requests to the dashboard");
    eq(log.popups, 0, "popups");
    eq(context.pages().length, 1, "open windows");
    assert(!/postMessage|window\.open|opener/.test(inlineScript), "script uses opener/postMessage/window.open");
  }));

check("B26", "disallowed state origin: generic error, no Continue, no navigation", () =>
  open(async (page, log) => {
    for (const bad of ["http://example.com", "https://user@host.example"]) {
      await page.goto(returnUrl({ code: secret(16), state: state(bad) }));
      eq(await page.locator("#title").innerText(), GENERIC, `title for ${bad}`);
      assert(!(await visible(page, "#go")), `Continue offered for ${bad}`);
      eq(page.url(), RETURN, `address for ${bad}`);
    }
    eq(log.requests.filter((r) => !r.url.startsWith(BASE)).length, 0, "requests to any other origin");
  }));

/** Copy fallback (B27, GB1): clipboard holds the full original URL; the DOM never shows it. */
const copyCheck = (variant) => () =>
  open(async (page, log, context) => {
    await context.route(`${A}/**`, (r) => r.abort()); // dashboard unreachable from this browser
    const code = secret(64);
    const s = state(A);
    const original = variant === "hash" ? `${RETURN}#${q({ code, state: s })}` : returnUrl({ code, state: s });
    await page.goto(original);
    assert(!(await page.content()).includes(code), "code in DOM before Copy");
    await page.click("#copy");
    await page.locator("#status").filter({ hasText: "Copied" }).waitFor();
    eq(await page.evaluate(() => navigator.clipboard.readText()), original, "clipboard");
    assert(!(await page.content()).includes(code), "code in DOM after Copy");
    const pasted = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    const p = new URLSearchParams(variant === "hash" ? pasted.hash.slice(1) : pasted.search);
    eq(p.get("code"), code, "pasted code");
    eq(p.get("state"), s, "pasted state");
    eq(toHost(log, A).length, 0, "navigation to the unreachable dashboard");
  });
check("B27", "Copy puts the full original return URL on the clipboard (never rendered)", copyCheck("query"));

check("B28", "framed: error, no Continue, no navigation", () =>
  open(async (page, log) => {
    const code = secret(16);
    await page.goto(`${BASE}/__frame.html?src=${encodeURIComponent(returnUrl({ code, state: state(A) }))}`);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    assert(frame, "no frame");
    await frame.waitForLoadState("load");
    eq(await frame.locator("#title").innerText(), GENERIC, "frame title");
    for (const sel of ["#go", "#copy"]) assert(!(await frame.locator(sel).isVisible()), `${sel} offered in a frame`);
    eq(toHost(log, A).length, 0, "requests to the dashboard");
  }));

check("B29", "hostile / malformed state origins render inert; no handoff; CSP clean", () =>
  open(async (page, log) => {
    const evil = ["<script>alert(1)</script>", "javascript:alert(1)", "http://evil", "https://user@evil", ""];
    for (const o of evil) {
      await page.goto(returnUrl({ code: secret(16), state: o ? state(o) : "" }));
      eq(await page.evaluate(() => document.scripts.length), 1, `script elements for ${JSON.stringify(o)}`);
      assert(!(await page.content()).includes("alert(1)"), `payload echoed for ${JSON.stringify(o)}`);
      assert(!(await visible(page, "#go")), `Continue offered for ${JSON.stringify(o)}`);
    }
    eq(log.dialogs, 0, "dialogs");
    eq(await cspCount(page, log), 0, "CSP violations");
    eq(log.errors.length, 0, `page errors ${log.errors}`);
    eq(log.requests.filter((r) => !r.url.startsWith(BASE)).length, 0, "requests to any other origin");
  }));

check("B41", "code cleared from query AND fragment", () =>
  open(async (page) => {
    const code = secret(24);
    const s = state(A);
    for (const url of [returnUrl({ code, state: s }), `${RETURN}#${q({ code, state: s })}`]) {
      await page.goto("about:blank"); // a hash-only goto would be a same-document navigation
      await page.goto(url);
      const loc = await page.evaluate(() => ({ href: location.href, search: location.search, hash: location.hash }));
      assert(!loc.href.includes(code), `href keeps the code for ${url}`);
      eq(loc.search + loc.hash, "", `query/fragment for ${url}`);
      eq(await page.locator("#go").innerText(), `Continue to ${A}`, `page reads ${url.includes("#") ? "fragment" : "query"}`);
    }
  }));

check("B42", "same-origin only, no <script src>, hashed inline script, no-referrer meta, audit exit 0", () =>
  open(async (page, log) => {
    await page.goto(returnUrl({ code: secret(16), state: state(A) }));
    eq(log.requests.filter((r) => !r.url.startsWith(BASE)).length, 0, "cross-origin requests");
    eq(log.requests.length, 1, `requests ${log.requests.map((r) => r.url)}`);
    assert(!/<script[^>]*\bsrc=/i.test(html), "<script src> present");
    eq(await page.locator('meta[name="referrer"]').getAttribute("content"), "no-referrer", "referrer meta");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    assert(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/.test(csp), `CSP ${csp}`);
    assert(csp.includes(cspHash(inlineScript)), "CSP does not pin the inline script");
    eq(checkInlineHashes(html, "return.html").join(), "", "inline hash problems");
    eq(await cspCount(page, log), 0, "CSP violations");
    const a = await audit();
    eq(a.code, 0, `npm run audit: ${a.out}`);
  }));

check("B43", "replaceState runs before the body exists; no Referer on the handoff", () =>
  open(
    async (page, log) => {
      const code = secret(24);
      await page.goto(returnUrl({ code, state: state(A) }));
      const seen = await page.evaluate(() => ({ calls: window.__rs, atBody: window.__atBody }));
      assert(seen.calls?.length >= 1, "replaceState never called");
      eq(seen.calls[0].hadBody, false, "body existed at the first replaceState");
      assert(seen.calls[0].search.includes("code="), "probe did not see the original query");
      eq(seen.atBody, "", "address (query+fragment) when the body first appeared");
      await page.click("#go");
      await page.waitForURL(`${A}/**`);
      const to = toHost(log, A);
      eq(to.length, 1, "requests to the dashboard");
      eq(to[0].referer, undefined, "Referer header");
    },
    {
      init: () => {
        const orig = History.prototype.replaceState;
        History.prototype.replaceState = function (...a) {
          (window.__rs ??= []).push({ hadBody: !!document.body, search: location.search, hash: location.hash });
          return orig.apply(this, a);
        };
        new MutationObserver(() => {
          if (document.body && window.__atBody === undefined) window.__atBody = location.search + location.hash;
        }).observe(document, { childList: true, subtree: true });
      },
    },
  ));

check("B44", "Back never restores a URL with the code; code not in the title", () =>
  open(async (page) => {
    const code = secret(24);
    await page.goto(returnUrl({ code, state: state(A) }));
    assert(!(await page.title()).includes(code), "code in document.title");
    await page.goto(`${BASE}/privacy.html`);
    await page.goBack();
    assert(!page.url().includes(code), `Back restored ${page.url()}`);
    eq(page.url(), RETURN, "address after Back");
  }));

check("B179", "built page: in ENTRIES, no external refs, hash matches, audit exit 0", async () => {
  const build = await readFile(join(SITE, "build.mjs"), "utf8");
  assert(/"oauth"/.test(build), "oauth/ missing from build.mjs ENTRIES");
  for (const f of ["privacy.html", "terms.html"]) assert(existsSync(join(DIST, f)), `dist/${f} missing`);
  assert(!/(?:src|href|action)="(?:https?:)?\/\//i.test(html), "external reference in return.html");
  assert(!/url\(|@import/.test(html), "CSS loads a resource");
  const m = /script-src '(sha256-[^']+)'/.exec(html);
  eq(`'${m?.[1]}'`, cspHash(inlineScript), "script-src hash");
  const a = await audit();
  eq(a.code, 0, `npm run audit${flag("links") ? " -- --links" : ""}: ${a.out}`);
});

check("B180", "one-character edit of the inline script is caught (checker) and blocked (browser)", () =>
  open(async (page, log) => {
    const tampered = html.replace("Finish connecting Google", "Finish connecting Googlf");
    assert(tampered !== html, "mutation did not apply");
    const problems = checkInlineHashes(tampered, "return.html");
    assert(problems.some((p) => /hash mismatch/.test(p)), `checker missed it: ${problems}`);
    overrides.set("/oauth/tampered.html", tampered);
    try {
      await page.goto(`${BASE}/oauth/tampered.html?${q({ code: secret(16), state: state(A) })}`);
      assert((await cspCount(page, log)) >= 1, "no CSP violation reported for the edited script");
      assert(!(await visible(page, "#go")), "edited script still ran");
    } finally {
      overrides.delete("/oauth/tampered.html");
    }
  }));

check("B181", "4 KiB code + long valid origin: layout holds, full values handed over", () =>
  open(
    async (page, log) => {
      const code = secret(4096);
      const long = `https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example.com`;
      const s = state(long, "f".repeat(200));
      await page.goto(returnUrl({ code, state: s }));
      assert(!page.url().includes(code.slice(0, 40)), "address bar keeps the code");
      eq(await page.locator("#origin").innerText(), long, "origin text");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, `horizontal overflow ${over}px`);
      await page.click("#go");
      const target = callbackUrl(long, { code, state: s });
      await page.waitForURL(target);
      eq(toHost(log, long).map((r) => r.url).join(), target, "handoff URL");
    },
    { width: 375 },
  ));

check("B182", "Google error / missing params: never blank, no exception; cancelled + Close", () =>
  open(async (page, log) => {
    for (const [name, o] of [
      ["error with valid state", { error: "access_denied", state: state(A) }],
      ["error with opaque state", { error: "access_denied", state: "S" }],
      ["no params", {}],
    ]) {
      await page.goto(Object.keys(o).length ? returnUrl(o) : RETURN);
      assert((await page.locator("body").innerText()).trim().length > 0, `${name}: blank page`);
      eq(await page.locator("#title").innerText(), CANCELLED, `${name}: title`);
      assert(await visible(page, "#close"), `${name}: no Close`);
      await page.click("#close");
      await page.locator("#status").filter({ hasText: "close it now" }).waitFor();
    }
    eq(log.errors.length, 0, `page errors ${log.errors}`);
  }));

check("B183", "375/768/1440 × light/dark: no overflow, controls visible, focus ring, Enter/Space activate", async () => {
  for (const width of [375, 768, 1440]) {
    for (const scheme of ["dark", "light"]) {
      await open(
        async (page) => {
          await page.goto(returnUrl({ code: secret(16), state: state(A) }));
          eq(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), scheme === "light" ? "light" : null, `theme @${width} ${scheme}`);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert(over <= 0, `${width}/${scheme}: horizontal overflow ${over}px`);
          for (const sel of ["#origin", "#go", "#copy"]) {
            const box = await page.locator(sel).boundingBox();
            assert(box && box.x >= 0 && box.x + box.width <= width, `${width}/${scheme}: ${sel} not within the viewport`);
          }
          await page.keyboard.press("Tab");
          eq(await page.evaluate(() => document.activeElement?.id), "go", "first Tab target");
          const ring = await page.evaluate(() => {
            const s = getComputedStyle(document.activeElement);
            return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
          });
          assert(ring.style !== "none" && ring.width > 0, `${width}/${scheme}: no focus ring`);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/return-${scheme}-${width}.png`, fullPage: true });
        },
        { width, scheme },
      );
    }
  }
  for (const key of ["Enter", "Space"]) {
    await open(async (page, log) => {
      await page.goto(returnUrl({ code: secret(16), state: state(A) }));
      await page.keyboard.press("Tab");
      await page.keyboard.press(key);
      await page.waitForURL(`${A}/**`);
      eq(toHost(log, A).length, 1, `${key} activation requests`);
    });
  }
});

check("B184", "double-click Continue: exactly one navigation", () =>
  open(async (page, log) => {
    await page.goto(returnUrl({ code: secret(16), state: state(A) }));
    await page.dblclick("#go");
    await page.waitForURL(`${A}/**`);
    await page.waitForTimeout(500);
    eq(toHost(log, A).length, 1, "requests to the remote callback");
  }));

check("GB1", "Copy (store-full / unreachable cases): full original URL, query and fragment forms", async () => {
  await copyCheck("query")();
  await copyCheck("hash")();
});

check("GB2", "error redirect: cancelled + Close; Continue hands error+state (no code) to the dashboard", () =>
  open(async (page, log) => {
    const s = state(A);
    await page.goto(returnUrl({ error: "access_denied", state: s }));
    eq(await page.locator("#title").innerText(), CANCELLED, "title");
    assert(await visible(page, "#close"), "Close missing");
    eq(toHost(log, A).length, 0, "requests before the click");
    await page.click("#go");
    const target = callbackUrl(A, { error: "access_denied", state: s });
    await page.waitForURL(target);
    assert(!page.url().includes("code="), "code in the callback");
  }));

check("GB3", "origin allow-list: https, localhost / 127.0.0.1 any port, no userinfo", () =>
  open(async (page) => {
    const cases = [
      ["https://dash.example", true],
      ["https://dash.example:8443", true],
      ["http://localhost:8000", true],
      ["http://localhost", true],
      ["http://127.0.0.1:3000", true],
      ["http://example.com", false],
      ["http://localhost.evil.com", false],
      ["http://127.0.0.1.evil.com", false],
      ["http://[::1]:8000", false],
      ["https://user@dash.example", false],
      ["https://user:pw@dash.example", false],
      ["http://localhost@evil.com", false],
      ["ftp://dash.example", false],
      ["javascript:alert(1)", false],
      ["https://", false],
    ];
    for (const [origin, allowed] of cases) {
      await page.goto(returnUrl({ code: secret(16), state: state(origin) }));
      eq(await visible(page, "#go"), allowed, `Continue for ${origin}`);
      if (allowed) eq(await page.locator("#go").innerText(), `Continue to ${new URL(origin).origin}`, `label for ${origin}`);
      else eq(await page.locator("#title").innerText(), GENERIC, `title for ${origin}`);
    }
  }));

// ---- run ------------------------------------------------------------------------------------------
let failed = 0;
for (const s of scenarios) {
  if (ONLY && !ONLY.includes(s.id)) continue;
  try {
    await s.fn();
    console.log(`ok   ${s.id.padEnd(5)} ${s.title}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${s.id.padEnd(5)} ${s.title}\n       ${String(e.message).split("\n")[0].slice(0, 400)}`);
  }
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} scenario(s) failed` : "\nall return-page scenarios passed");
process.exit(failed ? 1 : 0);
