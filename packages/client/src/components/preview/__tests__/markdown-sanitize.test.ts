import type { Element, Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { MARKDOWN_SCHEMA, safeUrlTransform } from "../markdown-sanitize.js";

// See change: sanitize-untrusted-rendered-content (test-plan E9, E10).

const el = (tagName: string): Element => ({ type: "element", tagName, properties: {}, children: [] });
const run = (tag: string, key: string, value: string) => safeUrlTransform(value, key, el(tag));

const VALUES = [
  "pi-asset:x",
  "blob:x",
  "data:image/png;base64,AAAA",
  "data:text/html,x",
  "https://a",
  "HTTP://a",
  "javascript:x",
  " javascript:x",
  "./rel",
  "#frag",
  "mailto:a@b",
];

describe("safeUrlTransform decision table (E9)", () => {
  const imgSrc: Record<string, boolean> = {
    "pi-asset:x": true,
    "blob:x": true,
    "data:image/png;base64,AAAA": true,
    "data:text/html,x": false,
    "https://a": true,
    "HTTP://a": false,
    "javascript:x": false,
    " javascript:x": false,
    "./rel": true,
    "#frag": true,
    "mailto:a@b": true,
  };
  const aHref: Record<string, boolean> = {
    ...imgSrc,
    "pi-asset:x": false,
    "blob:x": false,
    "data:image/png;base64,AAAA": false,
  };

  for (const v of VALUES) {
    it(`img src ${JSON.stringify(v)} → ${imgSrc[v] ? "kept" : "dropped"}`, () => {
      expect(run("img", "src", v)).toBe(imgSrc[v] ? v : "");
    });
    it(`a href ${JSON.stringify(v)} → ${aHref[v] ? "kept" : "dropped"}`, () => {
      expect(run("a", "href", v)).toBe(aHref[v] ? v : "");
    });
  }
});

describe("transform/schema parity on img src (E10)", () => {
  it("every value the transform keeps survives MARKDOWN_SCHEMA", () => {
    for (const v of VALUES) {
      const kept = run("img", "src", v);
      if (kept === "") continue;
      const tree: Root = {
        type: "root",
        children: [{ type: "element", tagName: "img", properties: { src: kept ?? undefined }, children: [] }],
      };
      const out = rehypeSanitize(MARKDOWN_SCHEMA)(tree) as Root;
      const img = out.children[0] as Element;
      expect(img?.properties?.src, v).toBe(kept);
    }
  });
});
