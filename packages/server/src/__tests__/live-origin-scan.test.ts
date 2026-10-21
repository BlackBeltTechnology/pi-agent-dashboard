/**
 * Static origin scan (design D6, task 2.7) — test-plan E23.
 * See change: improve-canvas-html-and-url-ux.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPreviewEgress } from "../live-server/live-egress.js";
import { SCAN_MAX_HTML_BYTES, scanHtmlFile, scanMarkup, scanStillValid } from "../live-server/live-origin-scan.js";

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "live-scan-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (rel: string, content: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

const E23_HTML = `<!doctype html><html><head>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://unpkg.com/x.css">
<link rel="stylesheet" href="./local.css">
<script src="/app.js"></script>
</head><body>
<img srcset="a.png 1x, https://img.example.com/b.png 2x">
<video poster="https://poster.example.com/p.jpg"></video>
<object data="https://object.example.com/o.swf"></object>
<div style="background:url(https://bg.example.com/x.png)"></div>
<a href="https://navigation.example.com/page">a plain link is not a load</a>
</body></html>`;

describe("E23 — origin scan", () => {
  it("finds every markup origin, follows same-root CSS, and flags root-absolute references", async () => {
    write("local.css", "@import url(https://fonts.googleapis.com/css);\nbody{background:url(img/x.png)}");
    const html = write("index.html", E23_HTML);
    const out = await scanHtmlFile(root, html);
    expect(new Set(out.origins)).toEqual(
      new Set([
        "https://cdn.tailwindcss.com",
        "https://unpkg.com",
        "https://img.example.com",
        "https://poster.example.com",
        "https://object.example.com",
        "https://bg.example.com",
        "https://fonts.googleapis.com",
      ]),
    );
    expect(out.origins).toHaveLength(7);
    expect(out.rootAbsolute).toBe(true);
    expect(out.incomplete).toBe(false);
  });

  it("a document over 2 MiB is scanned up to the cut and reported incomplete", async () => {
    const pad = "x".repeat(SCAN_MAX_HTML_BYTES + 100 * 1024);
    const html = write("big.html", `<script src="https://early.example.com/a.js"></script><!-- ${pad} -->`);
    const out = await scanHtmlFile(root, html);
    expect(out.incomplete).toBe(true);
    expect(out.origins).toContain("https://early.example.com");
  });

  it("does not read stylesheets outside the root or with forbidden names", async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "live-scan-out-")));
    fs.writeFileSync(path.join(outside, "evil.css"), "@import url(https://outside.example.com/x.css);");
    write(".hidden/secret.css", "body{background:url(https://hidden.example.com/x.png)}");
    const html = write(
      "index.html",
      `<link rel=stylesheet href="../${path.basename(outside)}/evil.css"><link rel=stylesheet href=".hidden/secret.css">`,
    );
    const out = await scanHtmlFile(root, html);
    expect(out.origins).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("a missing document is incomplete, never a throw", async () => {
    expect((await scanHtmlFile(root, path.join(root, "gone.html"))).incomplete).toBe(true);
  });

  it("canonicalises: protocol-relative → https, http kept as its own origin, comments ignored", () => {
    const refs = scanMarkup(
      `<!-- <script src="https://commented.example.com/a.js"></script> -->
       <script src="//Cdn.Example.com./x.js"></script><img src="http://192.168.1.10/a.png"><img src="data:image/png;base64,AAAA">`,
    );
    expect([...refs.origins].sort()).toEqual(["http://192.168.1.10", "https://cdn.example.com"]);
  });

  it("a cached scan is invalidated by a changed mtime/size, including of a stylesheet", async () => {
    const css = write("s.css", "body{}");
    const html = write("index.html", `<link rel=stylesheet href="s.css">`);
    const first = await scanHtmlFile(root, html);
    expect(await scanStillValid(first)).toBe(true);
    fs.writeFileSync(css, "@import url(https://changed.example.com/a.css);");
    expect(await scanStillValid(first)).toBe(false);
    expect((await scanHtmlFile(root, html)).origins).toEqual(["https://changed.example.com"]);
  });
});

describe("E23 — lazily, per token, through the egress service", () => {
  const grant = { targetId: "st-1", tokenId: "tok-1", kind: "static", policy: { egress: "restricted", scripts: false }, minterKey: "local", principal: { kind: "local" } } as const;

  it("scans only the HTML served under the token, on the first view, and re-scans after a change", async () => {
    const html = write("index.html", `<script src="https://cdn.tailwindcss.com"></script>`);
    write("other.html", `<script src="https://not-served.example.com/a.js"></script>`);
    const egress = createPreviewEgress({
      getStatic: () => ({ id: "st-1", cwd: root, root }),
      projectKeyOf: (c) => c,
      projectGrants: () => [],
      allowOnce: () => [],
    });
    expect((await egress.view(grant)).origins).toEqual([]); // nothing served yet
    egress.noteServed(grant, html);
    let view = await egress.view(grant);
    expect(view.origins).toEqual([{ origin: "https://cdn.tailwindcss.com", source: "markup", state: "blocked" }]);
    expect(view.scanIncomplete).toBe(false);
    fs.writeFileSync(html, `<script src="https://cdn.tailwindcss.com"></script><img src="https://more.example.com/a.png">`);
    view = await egress.view(grant);
    expect(view.origins.map((o) => o.origin)).toEqual(["https://cdn.tailwindcss.com", "https://more.example.com"]);
  });
});
