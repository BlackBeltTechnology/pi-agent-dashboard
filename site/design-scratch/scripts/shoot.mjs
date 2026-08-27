#!/usr/bin/env node
/**
 * Screenshot + layout-audit driver for the mockup.
 *
 *   node site/design-scratch/mockup/scripts/shoot.mjs                       # default matrix
 *   node .../shoot.mjs --themes dark --widths 390 --sections hero,download
 *   node .../shoot.mjs --audit                                             # no PNGs, numbers only
 *   node .../shoot.mjs --page bg3d.html --widths 1440                      # the physics lab
 *
 * Run it from the repo root. Playwright is a root devDependency; invoked from
 * outside the tree (notably /tmp) node resolves nothing and dies with
 * ERR_MODULE_NOT_FOUND. The path above is written out in full for that reason.
 *
 * Worse, and the reason for the resolver below: this file lives under site/,
 * and site/ has its OWN node_modules with an OLDER playwright (1.59 vs the
 * root's 1.61). A bare `import "playwright"` therefore resolves the nearest
 * copy, whose browser binaries were never downloaded, and the run dies with
 * "Executable doesn't exist ... run npx playwright install" -- which is a lie,
 * the browser is installed, just for the other copy. Bind to the ROOT install.
 *
 * --audit is the half that matters. A screenshot proves a thing was painted;
 * it cannot prove the header is still sticky, that no anchor is dead, or that
 * the nav does not overflow 12px at one width nobody screenshots. Those are
 * measurements, and every one of them below is a bug this mockup actually
 * shipped at some point.
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let dir = fileURLToPath(new URL(".", import.meta.url));
let rootPlaywright = null;
while (dir !== dirname(dir)) {
  // The repo root is the one with pnpm-workspace.yaml, not merely any
  // node_modules: site/ would otherwise win on the first hop up.
  if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const p = join(dir, "node_modules", "playwright");
    if (existsSync(p)) rootPlaywright = p;
    break;
  }
  dir = dirname(dir);
}
const { chromium } = rootPlaywright ? require(rootPlaywright) : await import("playwright");

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const list = (n, d) => String(arg(n, d)).split(",").filter(Boolean);

const BASE = arg("base", "http://localhost:8791");
const PAGE = arg("page", "index.html");
const OUT = arg("out", "/tmp/mockup-shots");
const THEMES = list("themes", "dark,light");
const WIDTHS = list("widths", "390,1440").map(Number);
const SECTIONS = list("sections", "hero,control,features,download,install");
const AUDIT_ONLY = has("audit");
const CHECK_LINKS = has("links");
const SETTLE = Number(arg("settle", 1400)); // 3D field needs time to spin up

await mkdir(OUT, { recursive: true });

// --enable-unsafe-swiftshader: headless Chromium has no GPU, and field.js is
// WebGL. Without it the canvas silently renders nothing and every shot of the
// background comes back empty.
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
let failures = 0;

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: width < 700 ? 844 : 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Theme MUST be set explicitly, via the SAME `pi-theme` key the page reads
    // ("system" | "light" | "dark"). Headless Chromium reports the light color
    // scheme regardless of the host OS, so leaving it on "system" silently
    // shoots light every time. Clicking the control is not an option either:
    // the lab panel and some header controls are display:none at <=720px.
    await page.addInitScript((t) => localStorage.setItem("pi-theme", t), theme);
    await page.goto(`${BASE}/${PAGE}`, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE);

    const audit = await page.evaluate(() => {
      const de = document.documentElement;
      const nav = document.querySelector(".nav");
      const header = document.querySelector("header");
      const anchors = [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h !== "#" && !document.querySelector(h));
      const images = [...document.querySelectorAll("img")]
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => i.getAttribute("src"));
      return {
        docOverflowPx: de.scrollWidth - de.clientWidth,
        navOverflowPx: nav ? nav.scrollWidth - nav.clientWidth : 0,
        headerPosition: header ? getComputedStyle(header).position : "none",
        deadAnchors: anchors,
        brokenImages: images,
      };
    });

    // Sticky is asserted at the BOTTOM of the page, not at rest: the rule that
    // raises content above the 3D field once overwrote position:sticky with
    // position:relative, which is invisible until you actually scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const headerTop = await page.evaluate(() => {
      const h = document.querySelector("header");
      return h ? Math.round(h.getBoundingClientRect().top) : null;
    });

    const bad =
      audit.docOverflowPx > 0 ||
      audit.navOverflowPx > 1 ||
      audit.deadAnchors.length > 0 ||
      audit.brokenImages.length > 0 ||
      errors.length > 0 ||
      headerTop !== 0;

    if (bad) failures++;
    console.log(
      `${bad ? "FAIL" : "ok  "} ${theme.padEnd(5)} ${String(width).padStart(4)}px  ` +
        `overflow ${audit.docOverflowPx}/${audit.navOverflowPx}  ` +
        `header ${audit.headerPosition}@${headerTop}  ` +
        `dead ${audit.deadAnchors.length}  broken-img ${audit.brokenImages.length}  ` +
        `${errors.length ? `ERR ${errors.join(" | ")}` : "no-errors"}`,
    );

    if (!AUDIT_ONLY) {
      for (const id of SECTIONS) {
        const target = id === "hero" ? "body" : `#${id}`;
        const el = page.locator(target).first();
        if ((await el.count()) === 0) continue;
        if (id === "hero") await page.evaluate(() => window.scrollTo(0, 0));
        else await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900); // let the two-way reveal settle
        await page.screenshot({ path: `${OUT}/${theme}-${width}-${id}.png` });
      }
    }
    await page.close();
  }
}

// --links: every external href actually resolves. Anchors only -- <link
// rel=preconnect> targets are origins, not pages, and answer 404 by design.
// Run sparingly: it is real network traffic against github.com.
if (CHECK_LINKS) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/${PAGE}`, { waitUntil: "load" });
  const urls = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a[href^="http"]')].map((a) => a.href))],
  );
  await page.close();
  console.log(`\nchecking ${urls.length} external links`);
  for (const url of urls) {
    const status = await fetch(url, { redirect: "follow" })
      .then((r) => r.status)
      .catch(() => 0);
    if (status < 200 || status >= 300) {
      failures++;
      console.log(`FAIL ${status || "network"}  ${url}`);
    }
  }
  console.log(failures ? `${failures} bad link(s)` : "all links resolve");
}

await browser.close();
if (!AUDIT_ONLY) console.log(`\nPNGs -> ${OUT}`);
process.exit(failures ? 1 : 0); // non-zero so this is usable as a gate
