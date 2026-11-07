/**
 * L1 — framework-free browser modules of the mock site, in node: fixture routing,
 * the pane clock (E13) and shared surroundings (F6).
 * See change: add-mock-site-exact-env.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clockStart, createClock } from "../clock.ts";
import { matchPath, resolveRequest } from "../fixtures.ts";
import { paneContent } from "../kit.tsx";

describe("fixtures resolution", () => {
  it("routes by method + :params, HAR next, dev traffic and passthrough untouched", () => {
    const fx = { http: { "GET /api/runs/:id": () => 1, "/api/any": () => 2 }, har: { entries: [{ method: "GET", path: "/api/h", query: "?a=1", status: 200, body: "{}" }] }, passthrough: ["cdn.example"] };
    const u = (p: string) => new URL(p, "http://x.local");
    expect(matchPath("/api/runs/:id", "/api/runs/7")).toEqual({ id: "7" });
    const r = resolveRequest(fx, "get", u("/api/runs/7"), "http://x.local");
    expect(r.kind === "http" && r.params).toEqual({ id: "7" });
    expect(resolveRequest(fx, "POST", u("/api/any"), "http://x.local").kind).toBe("http");
    expect(resolveRequest(fx, "POST", u("/api/runs/7"), "http://x.local").kind).toBe("missing");
    expect(resolveRequest(fx, "GET", u("/api/h?a=1"), "http://x.local").kind).toBe("har");
    expect(resolveRequest(fx, "GET", u("/@fs/x.ts"), "http://x.local").kind).toBe("passthrough");
    expect(resolveRequest(fx, "GET", new URL("https://cdn.example/a.js"), "http://x.local").kind).toBe("passthrough");
  });
});

describe("pane clock (E13)", () => {
  it("every loop starts at clockAt; no clockAt = page-load time", () => {
    let real = 1_000_000;
    const at = "2026-01-01T12:00:00Z";
    const runStart = Date.parse(at) - 18 * 60_000;
    const clock = createClock(clockStart(at, 42), () => real);
    const ago = () => Math.round((clock.now() - runStart) / 60_000);
    expect(ago()).toBe(18); // loop 1
    real += 25_000; // loop 1 runs
    expect(ago()).toBe(18);
    real += 90_000;
    clock.reset(); // loop 2
    real += 40_000; clock.reset(); // loop 3
    expect(clock.now()).toBe(Date.parse(at));
    expect(ago()).toBe(18);
    expect(clockStart(undefined, 42)).toBe(42);
    expect(() => clockStart("yesterday", 0)).toThrow(/ISO-8601/);
  });
});

describe("surroundings (F6)", () => {
  it("DOM outside the slot is identical across panes; absent = bare in both", () => {
    const f = { surroundings: (slot: ReactNode) => createElement("main", { className: "app" }, createElement("nav", null, "Nav"), createElement("section", null, slot), createElement("footer", null, "F")) };
    const cur = renderToStaticMarkup(paneContent(f, createElement("b", null, "today")) as never);
    const pro = renderToStaticMarkup(paneContent(f, createElement("i", null, "new")) as never);
    const strip = (h: string) => h.replace(/<div data-mk-slot="" style="display:contents">.*?<\/div>/, "<SLOT/>");
    expect(strip(cur)).toBe(strip(pro));
    expect(strip(cur)).toBe('<main class="app"><nav>Nav</nav><section><SLOT/></section><footer>F</footer></main>');
    expect(cur).toContain("<b>today</b>");
    expect(renderToStaticMarkup(paneContent({}, createElement("b", null, "x")) as never)).toBe("<b>x</b>");
  });
});

