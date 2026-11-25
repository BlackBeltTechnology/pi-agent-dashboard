/**
 * D7 client mint-response decision tables: origin shape, path shapes per tier, `base`, frame `src`, `to=` encoding,
 * sandbox per tier, tier/shape mismatch and shape mixing.
 * See change: serve-live-previews-on-capability-origin (test-plan #E161, #E162, #E163, #E165-#E170, #E172, #E173).
 */
import { validateAddressPath } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { describe, expect, it } from "vitest";
import { canonicalOrigin, type MintShape, validateMintResponse } from "../mint-response.js";
import { frameSrc, parsePresetPath, sandboxFor } from "../preview-policy.js";

const OWN = ["http://localhost:8000"];
const ORIGIN = "http://k7q4mzxa2bcdefghijklmnopqr.localhost:8001";
const SECRET = "S".repeat(22);
const PID = "P".repeat(22);
const common = { expiresAt: 1, tokenId: "id", policy: { egress: "restricted", scripts: true } };
const T1_TO_4 = [1, 2, 4] as const;

const mint = (over: Record<string, unknown>, own: readonly string[] = OWN) => validateMintResponse({ ...common, ...over }, own);

describe("T.E161 / #E161 canonical-equal origin is the dashboard's own origin", () => {
  it("canonicalOrigin() folds trailing dot and default port so string-unequal origins collide", () => {
    expect(canonicalOrigin("http://LOCALHOST.:8000")).toBe("http://localhost.:8000");
    expect(canonicalOrigin("http://localhost:80")).toBe("http://localhost");
    expect(canonicalOrigin("https://localhost:443")).toBe("https://localhost");
  });

  it("rejects a tier-1 origin that is the dashboard origin up to case + trailing dot", () => {
    expect(mint({ tier: 1, origin: "http://LOCALHOST.:8000", path: "/" })).toBeNull();
    expect(mint({ tier: 1, origin: "http://localhost.:8000", path: "/" })).toBeNull();
  });

  it("rejects a tier-1 origin that is the dashboard origin up to default-port elision", () => {
    const own = ["http://localhost"];
    expect(mint({ tier: 1, origin: "http://localhost:80", path: "/" }, own)).toBeNull();
    expect(mint({ tier: 1, origin: "http://localhost", path: "/" }, own)).toBeNull();
    expect(mint({ tier: 1, origin: "http://localhost.:80", path: "/" }, own)).toBeNull();
  });

  it("still accepts a different origin (the comparison is not over-eager)", () => {
    expect(mint({ tier: 1, origin: "http://x.localhost:8000", path: "/" })?.origin).toBe("http://x.localhost:8000");
    expect(mint({ tier: 1, origin: "http://localhost:8001", path: "/" })?.origin).toBe("http://localhost:8001");
  });
});

describe("T.E162 / #E162 malformed origins are rejected (nothing framed)", () => {
  const BAD = ["null", "", "http://", "javascript:alert(1)", "ftp://x.localhost", "data:text/html,x"];
  for (const origin of BAD) {
    it(`tier 1-4 reject origin ${JSON.stringify(origin)}`, () => {
      for (const tier of [1, 2, 4]) expect(mint({ tier, origin, path: "/" })).toBeNull();
      expect(mint({ tier: 3, origin, path: `/?k=${SECRET}` })).toBeNull();
    });
  }
  it("a missing or non-string origin is rejected too", () => {
    for (const tier of T1_TO_4) {
      expect(mint({ tier, path: "/" })).toBeNull();
      expect(mint({ tier, origin: 8001, path: "/" })).toBeNull();
      expect(mint({ tier, origin: null, path: "/" })).toBeNull();
    }
  });
});

describe("T.E163 / #E163 origin must be exactly an origin", () => {
  for (const origin of ["http://u:p@x.localhost:8000", "http://x.localhost:8000/p", "http://x.localhost:8000/?q=1", "http://x.localhost:8000#h"]) {
    it(`rejects ${origin}`, () => {
      expect(mint({ tier: 1, origin, path: "/" })).toBeNull();
      expect(mint({ tier: 3, origin, path: `/?k=${SECRET}` })).toBeNull();
    });
  }
  it("accepts a bare origin and an https wildcard-domain origin", () => {
    expect(mint({ tier: 1, origin: "http://x.localhost:8000", path: "/" })?.origin).toBe("http://x.localhost:8000");
    expect(mint({ tier: 2, origin: "https://a.preview.example.com", path: "/" })?.origin).toBe("https://a.preview.example.com");
  });
});

describe("T.E165 / #E165 path shape per tier (D7)", () => {
  const SHAPES = ["/", `/?k=${SECRET}`, "", "/x", `/?k=${"S".repeat(21)}`, `/?k=${SECRET}&to=/x`, `?k=${SECRET}`];

  it("tiers 1, 2, 4 accept ONLY `/`", () => {
    for (const tier of T1_TO_4) {
      for (const path of SHAPES) {
        const ok = mint({ tier, origin: ORIGIN, path }) !== null;
        expect({ tier, path, ok }).toEqual({ tier, path, ok: path === "/" });
      }
    }
  });

  it("tier 3 accepts ONLY `/?k=` + at least 22 secret-charset characters", () => {
    for (const path of SHAPES) {
      const ok = mint({ tier: 3, origin: ORIGIN, path }) !== null;
      expect({ path, ok }).toEqual({ path, ok: path === `/?k=${SECRET}` });
    }
  });

  it("tier 3 secret: 22 and longer accepted; 21, and any character outside [A-Za-z0-9_-], rejected", () => {
    for (const k of [SECRET, "S".repeat(43), "aZ09_-".repeat(4)]) expect(mint({ tier: 3, origin: ORIGIN, path: `/?k=${k}` })?.tier).toBe(3);
    for (const k of ["S".repeat(21), "", `${"S".repeat(21)}+`, `${"S".repeat(21)}/`, `${"S".repeat(21)}=`, `${"S".repeat(21)} `, `${"S".repeat(21)}%41`]) {
      expect(mint({ tier: 3, origin: ORIGIN, path: `/?k=${k}` })).toBeNull();
    }
  });
});

describe("T.E166 / #E166 tier-5 path shape", () => {
  const p = (n: number) => "P".repeat(n);
  const CASES: Array<[string, boolean]> = [
    [`/preview/${p(21)}/`, false],
    [`/preview/${p(22)}/`, true],
    [`/preview/${p(23)}/`, true],
    [`/preview/${p(22)}`, false],
    [`/preview/${p(22)}//`, false],
    [`/preview/${p(22)}/..%2f`, false],
    [`/preview/${p(21)}+/`, false],
    [`/preview/${p(22)}/?x=1`, false],
    [`/PREVIEW/${p(22)}/`, false],
  ];
  for (const [path, accepted] of CASES) {
    it(`${accepted ? "accepts" : "rejects"} ${path}`, () => {
      expect(mint({ tier: 5, path }) !== null).toBe(accepted);
    });
  }
  it("an accepted tier-5 src is apiBase + path + deep", () => {
    const shape = mint({ tier: 5, path: `/preview/${p(22)}/` }) as MintShape;
    expect(frameSrc("http://dash:8000", shape, "a/b?x=1")).toBe(`http://dash:8000/preview/${p(22)}/a/b?x=1`);
    expect(frameSrc("", shape, "")).toBe(`/preview/${p(22)}/`);
  });
});

describe("T.E167 / #E167 `base` on tiers 1-4", () => {
  const BASE = `/preview/${PID}/`;
  const BAD_BASES = [`/preview/${"P".repeat(21)}/`, "/evil/", "//evil.example/", `/preview/${PID}/x/`, `preview/${PID}/`, `/preview/${PID}`, `/preview/${PID}/?x=1`, "", "/"];

  it("a well-formed base is accepted and framed as origin + base + deep", () => {
    for (const tier of T1_TO_4) {
      const shape = mint({ tier, origin: ORIGIN, path: "/", base: BASE }) as MintShape;
      expect(shape.base).toBe(BASE);
      expect(frameSrc("", shape, "a?x=1")).toBe(`${ORIGIN}${BASE}a?x=1`);
    }
  });

  for (const base of BAD_BASES) {
    it(`a malformed base ${JSON.stringify(base)} rejects the WHOLE mint (not just the base)`, () => {
      for (const tier of T1_TO_4) expect(mint({ tier, origin: ORIGIN, path: "/", base })).toBeNull();
      expect(mint({ tier: 3, origin: ORIGIN, path: `/?k=${SECRET}`, base })).toBeNull();
    });
  }

  it("a non-string base rejects the mint", () => {
    for (const base of [null, 5, {}, [BASE]]) expect(mint({ tier: 1, origin: ORIGIN, path: "/", base })).toBeNull();
  });
});

describe("T.E168 / #E168 frame source composition", () => {
  const DEEP = "a/b?x=1#h";
  const hasDoubleSlash = (src: string): boolean => src.replace(/^[a-z]+:\/\//i, "").replace(/%2F/gi, "x").includes("//");
  const shapeOf = (over: Record<string, unknown>) => mint(over) as MintShape;

  it("tiers 1, 2, 4 = origin + deep; with a base = origin + base + deep", () => {
    for (const tier of T1_TO_4) {
      const plain = shapeOf({ tier, origin: ORIGIN, path: "/" });
      expect(frameSrc("http://dash:8000", plain, DEEP)).toBe(`${ORIGIN}/${DEEP}`);
      const based = shapeOf({ tier, origin: ORIGIN, path: "/", base: `/preview/${PID}/` });
      expect(frameSrc("http://dash:8000", based, DEEP)).toBe(`${ORIGIN}/preview/${PID}/${DEEP}`);
    }
  });

  it("tier 3 = origin/?k=<k>&to= + encodeURIComponent(base + deep)", () => {
    const plain = shapeOf({ tier: 3, origin: ORIGIN, path: `/?k=${SECRET}` });
    expect(frameSrc("", plain, DEEP)).toBe(`${ORIGIN}/?k=${SECRET}&to=${encodeURIComponent(`/${DEEP}`)}`);
    const based = shapeOf({ tier: 3, origin: ORIGIN, path: `/?k=${SECRET}`, base: `/preview/${PID}/` });
    expect(frameSrc("", based, DEEP)).toBe(`${ORIGIN}/?k=${SECRET}&to=${encodeURIComponent(`/preview/${PID}/${DEEP}`)}`);
  });

  it("tier 5 and legacy = apiBase + path + deep", () => {
    const t5 = shapeOf({ tier: 5, path: `/preview/${PID}/` });
    expect(frameSrc("http://dash:8000", t5, DEEP)).toBe(`http://dash:8000/preview/${PID}/${DEEP}`);
    const legacyPath = `/live/abc12345/~c/${"T".repeat(22)}/`;
    const legacy = shapeOf({ path: legacyPath }); // no `tier`: an older server
    expect(legacy.tier).toBe("legacy");
    expect(frameSrc("http://dash:8000", legacy, DEEP)).toBe(`http://dash:8000${legacyPath}${DEEP}`);
    expect(frameSrc("", legacy, DEEP)).toBe(`${legacyPath}${DEEP}`);
  });

  it("no tier produces a double `//` at any joint (incl. an empty deep)", () => {
    const shapes = [
      ...T1_TO_4.map((tier) => shapeOf({ tier, origin: ORIGIN, path: "/" })),
      ...T1_TO_4.map((tier) => shapeOf({ tier, origin: ORIGIN, path: "/", base: `/preview/${PID}/` })),
      shapeOf({ tier: 3, origin: ORIGIN, path: `/?k=${SECRET}` }),
      shapeOf({ tier: 5, path: `/preview/${PID}/` }),
      shapeOf({ path: `/live/abc12345/~c/${"T".repeat(22)}/` }),
    ];
    for (const shape of shapes) {
      for (const deep of [DEEP, "", "x"]) {
        const src = frameSrc("http://dash:8000", shape, deep);
        expect({ tier: shape.tier, src, dbl: hasDoubleSlash(src) }).toEqual({ tier: shape.tier, src, dbl: false });
      }
    }
  });
});

describe("T.E169 / #E169 tier-3 `to=` encoding of hostile deep paths", () => {
  const BASES = [undefined, `/preview/${PID}/`];
  const t3 = (base?: string) => mint({ tier: 3, origin: ORIGIN, path: `/?k=${SECRET}`, ...(base ? { base } : {}) }) as MintShape;

  it("a backslash path and a protocol-relative `//` path are refused before framing (invalid-path)", () => {
    for (const deep of ["/\\evil.example", "//evil.example"]) {
      expect(validateAddressPath(deep).ok).toBe(false);
      expect(parsePresetPath(`live:http://localhost:5173${deep}`)).toEqual({ kind: "invalid-path" });
    }
  });

  it("a percent-encoded slash is refused too (the tier-5 proxy refuses %2F, so it is never framed)", () => {
    expect(validateAddressPath("/a%2Fb").ok).toBe(false);
    expect(parsePresetPath("live:http://localhost:5173/a%2Fb")).toEqual({ kind: "invalid-path" });
  });

  for (const raw of ["/a&b=c", "/a?x=1&to=/evil", "/é/日本", "/a#frag", "/a/b/?q=1&r=2#z"]) {
    it(`${JSON.stringify(raw)} round-trips through exactly one \`to\` param`, () => {
      const parsed = parsePresetPath(`live:http://localhost:5173${raw}`);
      expect(parsed?.kind).toBe("port");
      const checked = validateAddressPath(raw);
      if (!checked.ok || parsed?.kind !== "port") throw new Error("expected an accepted path");
      expect(parsed.deep).toBe(checked.path);
      for (const base of BASES) {
        const src = frameSrc("", t3(base), parsed.deep);
        const url = new URL(src);
        expect(url.origin).toBe(ORIGIN);
        expect(url.searchParams.getAll("to")).toHaveLength(1);
        expect(url.searchParams.getAll("k")).toEqual([SECRET]);
        // the raw query carries exactly one `to=` and one `k=`: everything hostile is inside the encoded value.
        expect(src.match(/[?&]to=/g)).toHaveLength(1);
        expect(src.match(/[?&]k=/g)).toHaveLength(1);
        const rawTo = src.slice(src.indexOf("&to=") + "&to=".length);
        expect(decodeURIComponent(rawTo)).toBe(`${base ?? "/"}${parsed.deep}`);
      }
    });
  }

  it("an injected `to=/evil` inside the deep path never becomes a second top-level param", () => {
    const parsed = parsePresetPath("live:http://localhost:5173/a?x=1&to=/evil");
    if (parsed?.kind !== "port") throw new Error("expected port");
    const url = new URL(frameSrc("", t3(), parsed.deep));
    expect(url.searchParams.get("to")).toBe(`/${parsed.deep}`);
    expect([...url.searchParams.keys()].sort()).toEqual(["k", "to"]);
  });
});

describe("T.E170 / #E170 sandbox token set per (tier, egress, scripts)", () => {
  const TIERS = [1, 2, 3, 4, 5, "legacy"] as const;
  const split = (s: string) => s.split(" ").filter(Boolean);

  it("tiers 1-4: open+scripts and restricted+scripts add allow-same-origin", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(sandboxFor({ egress: "open", scripts: true }, tier)).toBe("allow-scripts allow-same-origin allow-forms allow-popups allow-downloads");
      expect(sandboxFor({ egress: "restricted", scripts: true }, tier)).toBe("allow-scripts allow-same-origin allow-forms");
    }
  });

  it("tier 5, legacy and an omitted tier keep the current sets with NO allow-same-origin", () => {
    for (const tier of [5, "legacy"] as const) {
      expect(sandboxFor({ egress: "open", scripts: true }, tier)).toBe("allow-scripts allow-forms allow-popups allow-downloads");
      expect(sandboxFor({ egress: "restricted", scripts: true }, tier)).toBe("allow-scripts allow-forms");
    }
    expect(sandboxFor({ egress: "open", scripts: true })).toBe("allow-scripts allow-forms allow-popups allow-downloads");
    expect(sandboxFor({ egress: "restricted", scripts: true })).toBe("allow-scripts allow-forms");
  });

  it("scripts off is the empty string on EVERY tier and egress (the attribute stays present, empty)", () => {
    for (const tier of TIERS) for (const egress of ["open", "restricted"] as const) expect(sandboxFor({ egress, scripts: false }, tier)).toBe("");
  });

  it("allow-same-origin appears only for tiers 1-4 with scripts on; no duplicate tokens anywhere", () => {
    for (const tier of TIERS) {
      for (const egress of ["open", "restricted"] as const) {
        for (const scripts of [true, false]) {
          const tokens = split(sandboxFor({ egress, scripts }, tier));
          expect(new Set(tokens).size).toBe(tokens.length);
          expect(tokens.includes("allow-same-origin")).toBe(scripts && typeof tier === "number" && tier <= 4);
        }
      }
    }
  });
});

describe("T.E172 / #E172 tier vs shape mismatch fails closed", () => {
  const T5_PATH = `/preview/${PID}/`;
  const LEGACY_PATH = `/live/abc12345/~c/${"T".repeat(22)}/`;
  const CASES: Array<[string, Record<string, unknown>]> = [
    ["tier 2 with a tier-5 path", { tier: 2, path: T5_PATH }],
    ["tier 2 with an origin and a tier-5 path", { tier: 2, origin: ORIGIN, path: T5_PATH }],
    ["tier 5 with path `/`", { tier: 5, path: "/" }],
    ["tier 6", { tier: 6, path: "/" }],
    ["tier 6 with an origin", { tier: 6, origin: ORIGIN, path: "/" }],
    ['tier "5" (string)', { tier: "5", path: T5_PATH }],
    ['tier "legacy" with path `/`', { tier: "legacy", path: "/" }],
    ["tier 0", { tier: 0, origin: ORIGIN, path: "/" }],
    ["tier null", { tier: null, origin: ORIGIN, path: "/" }],
    ["tier 1 with the legacy path", { tier: 1, origin: ORIGIN, path: LEGACY_PATH }],
    ["tier 5 with the legacy path", { tier: 5, path: LEGACY_PATH }],
    ["empty object", {}],
    ["no path", { tier: 1, origin: ORIGIN }],
  ];
  for (const [name, body] of CASES) {
    it(`rejects: ${name}`, () => {
      expect(validateMintResponse({ ...common, ...body }, OWN)).toBeNull();
    });
  }
  it("rejects: no expiresAt", () => {
    expect(validateMintResponse({ tier: 1, origin: ORIGIN, path: "/" }, OWN)).toBeNull();
  });
});

describe("T.E173 / #E173 shape mixing (exactly one of origin / base)", () => {
  const T5_PATH = `/preview/${PID}/`;
  const LEGACY_PATH = `/live/abc12345/~c/${"T".repeat(22)}/`;

  it("a tier-5 response carrying `origin` is rejected", () => {
    expect(mint({ tier: 5, path: T5_PATH, origin: "http://x.test" })).toBeNull();
    expect(mint({ tier: 5, path: T5_PATH })?.tier).toBe(5);
  });
  it("a legacy response carrying `base` (or `origin`) is rejected", () => {
    expect(mint({ path: LEGACY_PATH, base: T5_PATH })).toBeNull();
    expect(mint({ path: LEGACY_PATH, origin: "http://x.test" })).toBeNull();
    expect(mint({ tier: "legacy", path: LEGACY_PATH, base: T5_PATH })).toBeNull();
    expect(mint({ path: LEGACY_PATH })?.tier).toBe("legacy");
  });
  it("a tier-5 response carrying `base` is rejected", () => {
    expect(mint({ tier: 5, path: T5_PATH, base: T5_PATH })).toBeNull();
  });
  it("a tier 1-4 response whose `base` is not in pid shape is rejected", () => {
    for (const tier of T1_TO_4) for (const base of ["/evil/", "/live/abc12345/", `/preview/${"P".repeat(10)}/`]) expect(mint({ tier, origin: ORIGIN, path: "/", base })).toBeNull();
  });
});
