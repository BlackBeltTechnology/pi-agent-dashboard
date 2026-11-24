/**
 * Mint-response validation, frame src / sandbox composition and the tier-5 base hint (D7).
 * See change: serve-live-previews-on-capability-origin (D7; test-plan #E70-#E80 family, #E39).
 */
import { describe, expect, it } from "vitest";
import { canonicalOrigin, validateMintResponse } from "../mint-response.js";
import { frameSrc, sandboxFor } from "../preview-policy.js";

const OWN = ["http://localhost:8000"];
const LABEL = "k7q4mzxa2bcdefghijklmnopqr";
const PID = "A".repeat(22);
const TOKEN = "T".repeat(22);
const base = { expiresAt: 1, tokenId: "id", policy: { egress: "restricted", scripts: true } };

describe("validateMintResponse", () => {
  it("tiers 1/2/4: origin + path '/' only", () => {
    for (const tier of [1, 2, 4]) {
      const ok = validateMintResponse({ ...base, tier, origin: `http://${LABEL}.localhost:8001`, path: "/" }, OWN);
      expect(ok?.tier).toBe(tier);
      expect(validateMintResponse({ ...base, tier, origin: `http://${LABEL}.localhost:8001`, path: "/x" }, OWN)).toBeNull();
      expect(validateMintResponse({ ...base, tier, path: "/" }, OWN)).toBeNull(); // no origin
    }
  });
  it("tier 3: origin + `/?k=<secret>` only", () => {
    expect(validateMintResponse({ ...base, tier: 3, origin: "http://192.168.1.5:8100", path: `/?k=${TOKEN}` }, OWN)?.tier).toBe(3);
    expect(validateMintResponse({ ...base, tier: 3, origin: "http://192.168.1.5:8100", path: "/" }, OWN)).toBeNull();
  });
  it("tier 5: `/preview/<pid>/` with no origin and no base; legacy: `/live/<id>/~c/<token>/` with neither", () => {
    expect(validateMintResponse({ ...base, tier: 5, path: `/preview/${PID}/` }, OWN)?.tier).toBe(5);
    expect(validateMintResponse({ ...base, tier: 5, path: `/preview/${PID}/`, origin: "http://x.test" }, OWN)).toBeNull();
    expect(validateMintResponse({ ...base, tier: 5, path: `/preview/${PID}/`, base: `/preview/${PID}/` }, OWN)).toBeNull();
    expect(validateMintResponse({ ...base, tier: 5, path: "/preview/short/" }, OWN)).toBeNull();
    const legacy = { ...base, tier: "legacy", path: `/live/vite-5173/~c/${TOKEN}/` };
    expect(validateMintResponse(legacy, OWN)?.tier).toBe("legacy");
    expect(validateMintResponse({ ...legacy, origin: "http://x.test" }, OWN)).toBeNull();
    expect(validateMintResponse({ ...legacy, base: `/preview/${PID}/` }, OWN)).toBeNull();
    expect(validateMintResponse({ ...base, path: `/live/vite-5173/~c/${TOKEN}/` }, OWN)?.tier).toBe("legacy"); // older server: no tier
  });
  it("refuses a non-http origin, a path/query-bearing origin, and the dashboard's own origin (canonical compare)", () => {
    for (const origin of ["javascript:1", "ftp://x.test", `http://${LABEL}.localhost:8001/x`, `http://u:p@${LABEL}.localhost`, "", 5]) {
      expect(validateMintResponse({ ...base, tier: 1, origin, path: "/" }, OWN), String(origin)).toBeNull();
    }
    expect(validateMintResponse({ ...base, tier: 1, origin: "http://localhost:8000", path: "/" }, OWN)).toBeNull();
    expect(validateMintResponse({ ...base, tier: 1, origin: "HTTP://LOCALHOST:8000", path: "/" }, OWN)).toBeNull();
    expect(validateMintResponse({ ...base, tier: 1, origin: "http://localhost.:8000", path: "/" }, ["http://localhost.:8000"])).toBeNull();
    expect(canonicalOrigin("http://a.test:80")).toBe("http://a.test");
  });
  it("an unknown tier or a mistyped field is rejected", () => {
    for (const tier of [0, 6, "preview", null, {}]) expect(validateMintResponse({ ...base, tier, path: "/" }, OWN)).toBeNull();
    expect(validateMintResponse({ tier: 1, origin: `http://${LABEL}.localhost:8001`, path: "/", expiresAt: "1" }, OWN)).toBeNull();
  });
  it("tiers 1-4 may carry a tier-5 `base`; anything else is rejected", () => {
    const o = `http://${LABEL}.localhost:8001`;
    expect(validateMintResponse({ ...base, tier: 1, origin: o, path: "/", base: `/preview/${PID}/` }, OWN)?.base).toBe(`/preview/${PID}/`);
    expect(validateMintResponse({ ...base, tier: 1, origin: o, path: "/", base: "/x/" }, OWN)).toBeNull();
  });
});

describe("frameSrc / sandboxFor", () => {
  it("tiers 1, 2, 4: origin + path + deep; with a base: origin + base + deep", () => {
    const o = `http://${LABEL}.localhost:8001`;
    expect(frameSrc("", { tier: 1, origin: o, path: "/" }, "")).toBe(`${o}/`);
    expect(frameSrc("", { tier: 1, origin: o, path: "/" }, "docs/a?x=1")).toBe(`${o}/docs/a?x=1`);
    expect(frameSrc("", { tier: 1, origin: o, path: "/", base: `/preview/${PID}/` }, "a")).toBe(`${o}/preview/${PID}/a`);
  });
  it("tier 3 hops through `?k=` with `to=` carrying base + deep", () => {
    const o = "http://192.168.1.5:8100";
    expect(frameSrc("", { tier: 3, origin: o, path: `/?k=${TOKEN}` }, "a/b")).toBe(`${o}/?k=${TOKEN}&to=${encodeURIComponent("/a/b")}`);
    expect(frameSrc("", { tier: 3, origin: o, path: `/?k=${TOKEN}`, base: `/preview/${PID}/` }, "a")).toBe(
      `${o}/?k=${TOKEN}&to=${encodeURIComponent(`/preview/${PID}/a`)}`,
    );
  });
  it("tier 5 / legacy: API base + path + deep", () => {
    expect(frameSrc("https://dash.example.com", { tier: 5, path: `/preview/${PID}/` }, "x")).toBe(`https://dash.example.com/preview/${PID}/x`);
    expect(frameSrc("", { tier: "legacy", path: `/live/v/~c/${TOKEN}/` }, "")).toBe(`/live/v/~c/${TOKEN}/`);
  });
  it("sandboxFor: allow-same-origin only for tiers 1-4 and only with scripts on", () => {
    const open = { egress: "open", scripts: true } as const;
    const restricted = { egress: "restricted", scripts: true } as const;
    for (const t of [1, 2, 3, 4] as const) {
      expect(sandboxFor(restricted, t)).toBe("allow-scripts allow-same-origin allow-forms");
      expect(sandboxFor(open, t)).toBe("allow-scripts allow-same-origin allow-forms allow-popups allow-downloads");
      expect(sandboxFor({ egress: "open", scripts: false }, t)).toBe("");
    }
    for (const t of [5, "legacy"] as const) expect(sandboxFor(restricted, t)).toBe("allow-scripts allow-forms");
    expect(sandboxFor(restricted)).toBe("allow-scripts allow-forms");
  });
});
