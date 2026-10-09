/**
 * site-seo-contract.test.ts — static contracts for change
 * add-site-seo-foundation (test-plan E1–E23). Reads `site/` sources with
 * `fs` + regex + `JSON.parse` (no DOM lib), following
 * site-deploy-workflow-contract.test.ts.
 *
 *   E1–E5   head metadata, social card, JSON-LD
 *   E6–E7   pi entity link (hero subhead, FAQ)
 *   E8–E11  crawler files + build copy loop
 *   E12–E15 on-page FAQ
 *   E16–E23 reconciled marketing-site behaviour, pinned as source facts
 *
 * NOT covered (runtime — test-plan manual-only F1–F8, X1–X3): theme swap,
 * reduced-motion still frame, reveal reverse, rendered audit, live deploy.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(REPO_ROOT, p));

const ORIGIN = "https://pi-dashboard.dev/";
const PI_MONO = "https://github.com/badlogic/pi-mono";
const GH_REPO = "https://github.com/BlackBeltTechnology/pi-agent-dashboard";
const NPM_PKG = "https://www.npmjs.com/package/@blackbelt-technology/pi-agent-dashboard";

const html = read("site/index.html");
const head = html.slice(0, html.indexOf("</head>"));
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripTags = (s: string) =>
  stripComments(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Markup between `<section … id="X"` and its closing `</section>`. */
function section(id: string): string {
  const m = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`));
  if (!m || m.index === undefined) throw new Error(`no <section id="${id}">`);
  const end = html.indexOf("</section>", m.index);
  return html.slice(m.index, end + "</section>".length);
}

function meta(attr: "name" | "property", key: string): string | undefined {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[:]/g, "\\:")}"\\s+content="([^"]*)"`);
  return head.match(re)?.[1];
}

const titleText = () => stripTags(head.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");

function faqDetails(): string[] {
  return [...section("faq").matchAll(/<details\b[\s\S]*?<\/details>/g)].map((m) => m[0]);
}
const summaryOf = (d: string) => stripTags(d.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "");

/** Width/height from the first SOF0/SOF2 marker of a JPEG buffer. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function jsonLdBlocks(): string[] {
  return [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

describe("E1 — title, description, canonical, og/twitter titles", () => {
  it("title ≤60 names PI Dashboard + pi Coding Agent", () => {
    const t = titleText();
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.toLowerCase()).toContain("pi dashboard");
    expect(t.toLowerCase()).toContain("pi coding agent");
  });
  it("description ≤155 names the pi coding agent", () => {
    const d = meta("name", "description");
    expect(d).toBeDefined();
    expect(d!.length).toBeLessThanOrEqual(155);
    expect(d!.toLowerCase()).toContain("pi coding agent");
  });
  it("canonical is the apex", () => {
    expect(head).toMatch(/<link rel="canonical" href="https:\/\/pi-dashboard\.dev\/">/);
  });
  it("og:title and twitter:title equal <title>", () => {
    const t = titleText();
    expect(stripTags(meta("property", "og:title") ?? "")).toBe(t);
    expect(stripTags(meta("name", "twitter:title") ?? "")).toBe(t);
  });
});

describe("E2 — social card declared completely and ≤300 KB", () => {
  for (const [attr, key] of [
    ["property", "og:image"],
    ["name", "twitter:image"],
  ] as const) {
    it(`${key} maps to a 1200×630 JPEG ≤307200 bytes in site/public/`, () => {
      const u = meta(attr, key);
      expect(u, `${key} declared`).toBeDefined();
      expect(u!.startsWith(ORIGIN), `${key} absolute on ${ORIGIN}`).toBe(true);
      const rel = `site/public/${u!.slice(ORIGIN.length)}`;
      expect(exists(rel), `${rel} exists`).toBe(true);
      const buf = fs.readFileSync(path.join(REPO_ROOT, rel));
      expect(buf.length).toBeLessThanOrEqual(307200);
      expect(jpegSize(buf)).toEqual({ width: 1200, height: 630 });
    });
  }
  it("og:image:width/height/alt declared and match the file", () => {
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect((meta("property", "og:image:alt") ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("E3 — no stale og-card.png reference", () => {
  it("index.html never names og-card.png and the file is gone", () => {
    expect(html).not.toContain("og-card.png");
    expect(exists("site/public/og-card.png")).toBe(false);
  });
});

describe("E4 — exactly one SoftwareApplication JSON-LD block", () => {
  it("parses with the required shape", () => {
    const blocks = jsonLdBlocks();
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("SoftwareApplication");
    for (const k of ["name", "description", "operatingSystem", "applicationCategory"]) {
      expect(String(ld[k] ?? "").trim().length, `${k} non-empty`).toBeGreaterThan(0);
    }
    expect(ld.offers?.price).toBe("0");
    expect(ld.offers?.priceCurrency).toBe("USD");
    expect(String(ld.license)).toMatch(/^https:\/\//);
  });
});

describe("E5 — JSON-LD names the entity and carries no release values", () => {
  it("sameAs ⊇ GitHub, npm, pi-mono; no version, no download URL", () => {
    const raw = jsonLdBlocks()[0] ?? "{}";
    const ld = JSON.parse(raw);
    expect(ld.sameAs).toEqual(expect.arrayContaining([GH_REPO, NPM_PKG, PI_MONO]));
    expect(ld).not.toHaveProperty("softwareVersion");
    expect(raw).not.toContain("/releases/download/");
  });
});

describe("E6 — hero subhead links the pi coding agent", () => {
  const afterH1 = html.slice(html.indexOf("<h1"));
  const lede = afterH1.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
  const anchors = [...lede.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  it("pi-mono link text is the full phrase", () => {
    const pi = anchors.find((a) => a[1].includes(`href="${PI_MONO}"`));
    expect(pi, "subhead links pi-mono").toBeDefined();
    expect(stripTags(pi![2]).toLowerCase()).toBe("pi coding agent");
  });
  it("no bare 'pi' link", () => {
    for (const a of anchors) expect(stripTags(a[2]).toLowerCase()).not.toBe("pi");
  });
});

describe("E7 — FAQ compatibility item links pi-mono", () => {
  it("the Claude Code item links pi-mono and names Oh My Pi", () => {
    const item = faqDetails().find((d) => summaryOf(d).includes("Claude Code"));
    expect(item, "a <details> whose summary names Claude Code").toBeDefined();
    expect(item).toContain(`href="${PI_MONO}"`);
    expect(stripTags(item!)).toContain("Oh My Pi");
  });
});

describe("E8 — robots.txt", () => {
  it("allows the site, excludes /app/, points at the sitemap", () => {
    const lines = read("site/public/robots.txt").split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain("User-agent: *");
    expect(lines).toContain("Disallow: /app/");
    expect(lines).toContain("Sitemap: https://pi-dashboard.dev/sitemap.xml");
    expect(lines.some((l) => /^Disallow:\s*\/\s*$/.test(l))).toBe(false);
  });
});

describe("E9 — sitemap.xml lists only the apex", () => {
  it("sitemap-0.9 urlset with exactly one loc", () => {
    const xml = read("site/public/sitemap.xml");
    expect(xml).toMatch(/<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim());
    expect(locs).toEqual([ORIGIN]);
  });
});

describe("E10 — llms.txt", () => {
  it("heading, entity phrase, links", () => {
    const txt = read("site/public/llms.txt");
    expect(txt.split(/\r?\n/)[0]).toBe("# PI Dashboard");
    expect(txt.toLowerCase()).toContain("pi coding agent");
    for (const u of [ORIGIN, GH_REPO, PI_MONO]) expect(txt).toContain(u);
  });
});

describe("E11 — build copies every site/public/ entry to the dist root", () => {
  it("build.mjs keeps the public/ copy loop", () => {
    const src = read("site/build.mjs");
    expect(src).toMatch(/readdir\(join\(HERE,\s*"public"\)\)/);
    expect(src).toMatch(/cp\(join\(HERE,\s*"public",\s*name\),\s*join\(DIST,\s*name\)/);
  });
});

describe("E12 — FAQ present, ordered, complete", () => {
  it("#faq follows #install with data-field=close", () => {
    const iInstall = html.search(/<section\b[^>]*\bid="install"/);
    const iFaq = html.search(/<section\b[^>]*\bid="faq"/);
    expect(iFaq).toBeGreaterThan(iInstall);
    expect(section("faq")).toMatch(/^<section\b[^>]*\bdata-field="close"/);
  });
  it("≥6 details, each with a summary and an answer", () => {
    const items = faqDetails();
    expect(items.length).toBeGreaterThanOrEqual(6);
    for (const d of items) {
      const q = summaryOf(d);
      expect(q.length, "summary non-empty").toBeGreaterThan(0);
      const answer = stripTags(d.replace(/<summary\b[\s\S]*?<\/summary>/, ""));
      expect(answer.length, `answer for "${q}"`).toBeGreaterThan(0);
    }
  });
  it("covers every topic keyword", () => {
    const text = stripTags(section("faq"));
    for (const k of ["Claude Code", "Oh My Pi", "install", "MIT", "phone", "Anthropic", "SmartScreen"]) {
      expect(text, `FAQ mentions ${k}`).toContain(k);
    }
  });
});

describe("E13 — every FAQ answer carries a source comment", () => {
  it("each <details> contains <!-- source:", () => {
    const items = faqDetails();
    expect(items.length).toBeGreaterThan(0);
    for (const d of items) {
      expect(d.includes("<!-- source:"), `missing source comment: "${summaryOf(d)}"`).toBe(true);
    }
  });
});

describe("E14 — FAQ in-page anchors resolve", () => {
  it("every #x target exists", () => {
    const hrefs = [...section("faq").matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    for (const id of hrefs) expect(html, `id="${id}" exists`).toContain(`id="${id}"`);
  });
  it("unsigned-build item links #install", () => {
    const item = faqDetails().find((d) => /macOS|Windows|SmartScreen/.test(summaryOf(d)));
    expect(item, "an unsigned-build item").toBeDefined();
    expect(item).toContain('href="#install"');
  });
});

describe("E15 — FAQ uses tokens only", () => {
  const LIT = /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/;
  it("no colour literals in #faq markup", () => {
    const markup = stripComments(section("faq")).replace(/href="[^"]*"/g, "");
    expect(markup).not.toMatch(LIT);
  });
  it("no colour literals in CSS rules targeting the FAQ", () => {
    const css = (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => /faq/.test(r[1]));
    expect(rules.length, "FAQ has CSS rules").toBeGreaterThan(0);
    for (const r of rules) expect(r[2], `rule ${r[1].trim()}`).not.toMatch(LIT);
  });
});

/** #features cards: split by `<div class="cell">`. */
function featureCards(): { title: string; body: string }[] {
  return section("features")
    .split('<div class="cell">')
    .slice(1)
    .map((c) => ({
      title: stripTags(c.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? ""),
      body: stripTags(c.match(/<\/h3>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? ""),
    }));
}

describe("E16 — features grid has ≥9 titled cards with bodies", () => {
  it("each card has an h3 and a non-empty body", () => {
    const cards = featureCards();
    expect(cards.length).toBeGreaterThanOrEqual(9);
    for (const c of cards) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length, `body of ${c.title}`).toBeGreaterThan(0);
    }
  });
});

describe("E17 — capability phrases bound to their cards", () => {
  const binding: Record<string, string[]> = {
    "Branches and worktrees": ["git worktree", "OpenSpec"],
    "Watch multi-agent runs": ["in parallel"],
    "Cron and file triggers": ["schedule"],
    "Phone in 10 seconds": ["from your phone"],
  };
  const cards = featureCards();
  for (const [title, phrases] of Object.entries(binding)) {
    for (const p of phrases) {
      it(`"${title}" contains "${p}"`, () => {
        const card = cards.find((c) => c.title === title);
        expect(card, `card "${title}"`).toBeDefined();
        expect(card!.body.toLowerCase(), `card "${title}" missing "${p}"`).toContain(p.toLowerCase());
      });
    }
  }
});

describe("E18 — Why section argument and statuses", () => {
  it("h2 text and status chips", () => {
    const sec = section("control");
    const h2 = stripTags(sec.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
    expect(h2).toBe("Agents run for hours. You should not have to sit there.");
    const text = stripTags(sec);
    for (const s of ["Working", "Needs you", "Idle"]) expect(text).toContain(s);
  });
});

describe("E19 — hero film attributes", () => {
  it("muted inline looping described film with webm + mp4", () => {
    const m = html.match(/<video\s+id="film"([^>]*)>([\s\S]*?)<\/video>/);
    expect(m, "<video id=film>").not.toBeNull();
    const attrs = m![1];
    for (const a of ["autoplay", "muted", "loop", "playsinline"]) expect(attrs).toMatch(new RegExp(`\\b${a}\\b`));
    expect(attrs).toContain('poster="media/hero-');
    expect(attrs).toMatch(/aria-label="[^"]+"/);
    expect(m![2]).toContain('type="video/webm"');
    expect(m![2]).toContain('type="video/mp4"');
  });
});

describe("E20 — ambient WebGL background (source pins)", () => {
  it("both canvases are decorative", () => {
    expect(html).toMatch(/<canvas id="field" aria-hidden="true">/);
    expect(html).toMatch(/<canvas id="life" aria-hidden="true">/);
  });
  for (const f of ["site/field.js", "site/gol.js"]) {
    it(`${f} observes data-theme and composes a still frame`, () => {
      const src = read(f);
      expect(src).toMatch(/new MutationObserver\([\s\S]*?attributeFilter:\s*\['data-theme'\]/);
      expect(src).toContain("if (still.matches) composeStill()");
    });
  }
});

describe("E21 — script-applied reveal (source pins)", () => {
  const script = html.match(/<script>\s*\/\* -+ scroll reveal[\s\S]*?<\/script>/)?.[0] ?? "";
  it("early return precedes tagging", () => {
    const ret = script.indexOf("if (still || !('IntersectionObserver' in window)) return;");
    const tag = script.indexOf("classList.add('reveal')");
    expect(ret).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(ret);
  });
  it("stagger capped at 5 × 70 ms", () => {
    expect(script).toContain("Math.min(i, 5) * 70");
  });
  it("exit sets --rv and removes .in", () => {
    expect(script).toMatch(/setProperty\('--rv'/);
    expect(script).toContain("classList.remove('in')");
  });
  it("only .reveal hides content statically", () => {
    const css = (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    const hidden = [...css.matchAll(/([^{}]+)\{[^{}]*opacity:\s*0[;}]/g)].map((r) => r[1].trim());
    expect(hidden).toEqual([".reveal"]);
  });
});

describe("E22 — first-paint theme script (source pin)", () => {
  it("first head script sets data-theme light before any stylesheet", () => {
    const code = stripComments(head);
    const iScript = code.indexOf("<script>");
    const iSheet = Math.min(
      ...[code.search(/<link\b[^>]*rel="stylesheet"|<link\b[^>]*stylesheet/), code.indexOf("<style")].filter(
        (i) => i >= 0,
      ),
    );
    expect(iScript).toBeGreaterThan(-1);
    expect(iScript).toBeLessThan(iSheet);
    const first = code.slice(iScript, code.indexOf("</script>", iScript));
    expect(first).toContain("pi-theme");
    expect(first).toContain("setAttribute('data-theme','light')");
  });
  it("no class=dark theming on <html>", () => {
    const code = stripComments(html);
    expect(code).not.toMatch(/<html\b[^>]*class="[^"]*\bdark\b/);
    expect(code).not.toContain("classList.add('dark')");
  });
});

describe("E23 — screenshot/audit driver (source pins)", () => {
  const shoot = read("site/design-scratch/scripts/shoot.mjs");
  it("default SECTIONS include the five prior sections + faq", () => {
    const m = shoot.match(/const SECTIONS = list\("sections",\s*"([^"]+)"\)/);
    expect(m).not.toBeNull();
    expect(m![1].split(",")).toEqual(
      expect.arrayContaining(["hero", "control", "features", "download", "install", "faq"]),
    );
  });
  it("exits non-zero on failure and names no mockup/scripts path", () => {
    expect(shoot).toContain("process.exit(failures ? 1 : 0)");
    expect(shoot).not.toContain("mockup/scripts");
  });
  it("root screenshots script targets the site shots script", () => {
    const root = JSON.parse(read("package.json"));
    expect(root.scripts.screenshots).toBe("npm --prefix site run shots");
    const site = JSON.parse(read("site/package.json"));
    expect(site.scripts.shots).toBeDefined();
    expect(site.scripts.audit).toBeDefined();
  });
});
