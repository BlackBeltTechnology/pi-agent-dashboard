/**
 * Trusted Types policy module (change: harden-client-sinks, design D5/D6/D8;
 * shadow evaluation + transport: add-trusted-types-shadow-enforce, test-plan #E1–#E14, #X2).
 * jsdom has no `trustedTypes`: a fake factory records the policies so their
 * rules can be exercised directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as trustedTypesModule from "../trusted-types.js";
import {
  __defaultHitCountForTests,
  __resetTrustedTypesForTests,
  __shadowPurifyForTests,
  __shadowTotalsForTests,
  flushViolations,
  installTrustedTypes,
  MAX_REPORT_KEYS,
  readTrustedTypesMode,
  recordViolation,
  SHADOW_OUTCOMES,
  startViolationReporter,
  type TrustedTypesMode,
} from "../trusted-types.js";

type Rules = Record<string, ((s: string, ...a: unknown[]) => unknown) | undefined>;

function fakeTrustedTypes() {
  const policies = new Map<string, Rules>();
  const order: string[] = [];
  const tt = {
    createPolicy(name: string, rules: Rules) {
      order.push(name);
      policies.set(name, rules);
      const call = (k: string) => (s: string, ...a: unknown[]) => {
        const r = rules[k];
        if (!r) throw new TypeError(`${name}.${k} not defined`);
        return r(s, ...a);
      };
      return { createHTML: call("createHTML"), createScript: call("createScript"), createScriptURL: call("createScriptURL") };
    },
  };
  return { tt, policies, order };
}

function setMeta(content: string | null) {
  document.head.querySelector('meta[name="pi-trusted-types"]')?.remove();
  if (content === null) return;
  const m = document.createElement("meta");
  m.setAttribute("name", "pi-trusted-types");
  m.setAttribute("content", content);
  document.head.append(m);
}

let fake: ReturnType<typeof fakeTrustedTypes>;

function install(mode?: TrustedTypesMode) {
  fake = fakeTrustedTypes();
  vi.stubGlobal("trustedTypes", fake.tt);
  installTrustedTypes(mode);
  return fake;
}

beforeEach(() => {
  __resetTrustedTypesForTests();
});

afterEach(() => {
  setMeta(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (globalThis as { __PI_DEV_FS_ROOT__?: string }).__PI_DEV_FS_ROOT__;
});

describe("script URL allowlist (#E13)", () => {
  const ROOT = "/Users/op/repo";
  const URLS = {
    sw: "/sw.js",
    mjs: "/assets/a.mjs",
    js: "/assets/a.js",
    nested: "/assets/sub/a.js",
    api: "/api/file/raw?path=a.js",
    cdn: "https://cdn.example/x.js",
    fsRoot: `/@fs${ROOT}/x.ts?worker_file`,
    fsEtc: "/@fs/etc/x.js",
  };

  function verdicts(dev: boolean) {
    vi.stubEnv("DEV", dev);
    if (dev) (globalThis as { __PI_DEV_FS_ROOT__?: string }).__PI_DEV_FS_ROOT__ = ROOT;
    setMeta("enforce");
    const { policies } = install("enforce");
    const worker = policies.get("pi-worker-url")!.createScriptURL!;
    const dflt = policies.get("default")!.createScriptURL!;
    const out: Record<string, [boolean, boolean]> = {};
    for (const [k, u] of Object.entries(URLS)) {
      let namedOk = true;
      try {
        worker(u);
      } catch {
        namedOk = false;
      }
      out[k] = [namedOk, dflt(u) !== null];
    }
    return out;
  }

  it("prod: /sw.js and single /assets/*.m?js only", () => {
    const v = verdicts(false);
    for (const k of ["sw", "mjs", "js"]) expect(v[k], k).toEqual([true, true]);
    for (const k of ["nested", "api", "cdn", "fsRoot", "fsEtc"]) expect(v[k], k).toEqual([false, false]);
  });

  it("DEV additionally accepts the workspace /@fs root, still refuses /@fs/etc and /api/", () => {
    const v = verdicts(true);
    for (const k of ["sw", "mjs", "js", "fsRoot"]) expect(v[k], k).toEqual([true, true]);
    for (const k of ["api", "cdn", "fsEtc"]) expect(v[k], k).toEqual([false, false]);
  });
});

describe("default policy under enforcement (#E14)", () => {
  it("passes tag-free text, keeps SVG HTML labels, strips handlers, refuses script", () => {
    setMeta("enforce");
    const { policies } = install(readTrustedTypesMode());
    const d = policies.get("default")!;
    expect(d.createHTML!("#a{color:red}")).toBe("#a{color:red}");
    const svg = String(
      d.createHTML!('<?xml version="1.0"?><svg><foreignObject><div>L1<br/>L2</div></foreignObject></svg>'),
    );
    expect(svg).toMatch(/<foreignObject/i);
    expect(svg).toMatch(/<br>/);
    expect(String(d.createHTML!("<img src=x onerror=f()>"))).not.toMatch(/onerror/);
    expect(d.createScript!("alert(1)")).toBeNull();
  });
});

describe("default policy follows the mode (#E15)", () => {
  it.each([["report"], [null], ["garbage"]] as const)("meta %s → byte-identical pass-through, hit counted", (meta) => {
    setMeta(meta);
    const { policies } = install(readTrustedTypesMode());
    const input = "<img src=x onerror=f()>";
    const before = __defaultHitCountForTests();
    expect(policies.get("default")!.createHTML!(input)).toBe(input);
    expect(__defaultHitCountForTests()).toBe(before + 1);
  });
});

describe("violation reporter (#E23)", () => {
  function sentBody(fetchFn: ReturnType<typeof vi.fn>) {
    return JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
  }

  it("50 keys → no overflow; 51 keys → 50 + overflow 1", async () => {
    install("report");
    for (let i = 0; i < MAX_REPORT_KEYS; i++) recordViolation({ effectiveDirective: "d", sample: `s${i}|x`, sourceFile: "https://h/a.js", lineNumber: 1 });
    const f1 = vi.fn().mockResolvedValue({ ok: true });
    await flushViolations(f1);
    expect(sentBody(f1).entries).toHaveLength(50);
    expect(sentBody(f1).overflow).toBeUndefined();

    for (let i = 0; i < MAX_REPORT_KEYS + 1; i++) recordViolation({ effectiveDirective: "d", sample: `s${i}|x`, sourceFile: "https://h/a.js", lineNumber: 1 });
    const f2 = vi.fn().mockResolvedValue({ ok: true });
    await flushViolations(f2);
    expect(sentBody(f2).entries).toHaveLength(50);
    expect(sentBody(f2).overflow).toBe(1);
  });

  it("sink is `unknown` without a `|`; source loses query + fragment; no sample field", async () => {
    install("report");
    recordViolation({
      effectiveDirective: "require-trusted-types-for",
      sample: "secret content no bar",
      sourceFile: "https://dash.example/folder/x/view?path=a&ni=XYZ#h",
      lineNumber: 7,
    });
    const f = vi.fn().mockResolvedValue({ ok: true });
    await flushViolations(f);
    const raw = (f.mock.calls[0][1] as RequestInit).body as string;
    const body = JSON.parse(raw);
    expect(f.mock.calls[0][0]).toBe("/api/csp-violations");
    expect(body.entries[0].sink).toBe("unknown");
    expect(body.entries[0].source).not.toMatch(/[?#]/);
    expect(raw).not.toContain("sample");
    expect(raw).not.toContain("secret content");
    expect(raw).not.toContain("XYZ");
  });
});

describe("reporter failure (#X3)", () => {
  it("a rejected POST never throws and drops the batch", async () => {
    install("report");
    recordViolation({ effectiveDirective: "d", sample: "Element innerHTML|x", sourceFile: "https://h/a.js", lineNumber: 1 });
    const bad = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(flushViolations(bad)).resolves.toBeUndefined();
    const next = vi.fn().mockResolvedValue({ ok: true });
    await flushViolations(next);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── shadow evaluation (change: add-trusted-types-shadow-enforce) ─────────────

const UNSAFE = "<img src=x onerror=f()>";
type ShadowBody = {
  entries: { directive: string; sink: string; source: string; count: number }[];
  overflow?: number;
  shadow?: Record<string, number>;
};
const okFetch = (status = 200) => vi.fn().mockResolvedValue({ ok: status < 300, status });
const bodyOf = (f: ReturnType<typeof vi.fn>, n = 0): ShadowBody => JSON.parse((f.mock.calls[n][1] as RequestInit).body as string);
async function flushed(): Promise<ShadowBody> {
  const f = okFetch();
  await flushViolations(f);
  return bodyOf(f);
}
const totals = () => ({ ...__shadowTotalsForTests() });
const dflt = () => fake.policies.get("default")!;
/** Replace `performance.now()` with a controllable clock. */
function stubClock() {
  const clock = { t: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => clock.t);
  return clock;
}

describe("shadow outcomes (#E1–#E5)", () => {
  it("E1: report mode returns the input unchanged and counts would-alter-html for the call's source", async () => {
    install("report");
    expect(dflt().createHTML!(UNSAFE)).toBe(UNSAFE);
    expect(totals()["would-alter-html"]).toBe(1);
    const body = await flushed();
    expect(body.entries).toContainEqual({ directive: "trusted-types-shadow", sink: "would-alter-html", source: "unknown", count: 1 });
    expect(body.shadow).toEqual({ "would-alter-html": 1 });
  });

  it("E2: dropped leading head content counts via the FORCE_BODY second pass; trailing head element only on a listed removal", () => {
    install("report");
    const d = dflt();
    const inputs = ["<style>p{color:red}</style><p>x</p>", "<SCRIPT>x</SCRIPT><p>y</p>", "<p>z</p><style>q{}</style>"];
    for (const i of inputs) expect(d.createHTML!(i)).toBe(i);
    const t = totals();
    expect(t["would-alter-html"]).toBeGreaterThanOrEqual(2);
    // the third input counts only if DOMPurify lists a removal for it — compare against a direct run
    const probe = __shadowPurifyForTests();
    probe.sanitize(inputs[2], { USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true } });
    expect(t["would-alter-html"]).toBe(2 + (probe.removed.length > 0 ? 1 : 0));
  });

  it("E3: tag-free text does no work; intact HTML counts nothing", async () => {
    install("report");
    const spy = vi.spyOn(__shadowPurifyForTests(), "sanitize");
    const d = dflt();
    expect(d.createHTML!("color: red")).toBe("color: red");
    expect(spy).not.toHaveBeenCalled();
    expect(d.createHTML!('<p class="a">x</p>')).toBe('<p class="a">x</p>');
    for (const o of SHADOW_OUTCOMES) expect(totals()[o], o).toBe(0);
    const body = await flushed();
    expect(body.entries.some((e) => e.directive === "trusted-types-shadow")).toBe(false);
    expect(body.shadow).toBeUndefined();
  });

  it("E4: script text and script URLs outside the allowlist", () => {
    install("report");
    const d = dflt();
    expect(d.createScript!("1+1")).toBe("1+1");
    const blocked = ["/plugin-assets/x/abc/worker.js", "https://cdn.example/x.js", "/api/file/raw?path=a.js"];
    const allowed = ["/assets/editor.worker.js", "/sw.js"];
    for (const u of [...blocked, ...allowed]) expect(d.createScriptURL!(u)).toBe(u);
    expect(totals()["would-block-script"]).toBe(1);
    expect(totals()["would-block-script-url"]).toBe(blocked.length);
  });

  it.each([["off"], ["enforce"]] as const)("E5: %s mode does no shadow work", async (mode) => {
    install(mode);
    const d = dflt();
    d.createHTML!(UNSAFE);
    d.createScript!("1+1");
    d.createScriptURL!("https://cdn.example/x.js");
    for (const o of SHADOW_OUTCOMES) expect(totals()[o], o).toBe(0);
    const body = await flushed();
    expect(body.entries.some((e) => e.directive === "trusted-types-shadow")).toBe(false);
    expect(body.shadow).toBeUndefined();
  });

  it("E5: report mode counts exactly one outcome per would-fire call", () => {
    install("report");
    const d = dflt();
    d.createHTML!(UNSAFE);
    d.createScript!("1+1");
    d.createScriptURL!("https://cdn.example/x.js");
    expect(totals()).toMatchObject({ "would-alter-html": 1, "would-block-script": 1, "would-block-script-url": 1 });
  });
});

describe("shadow memo and budget (#E6–#E8)", () => {
  it("E6: a repeated input is classified once while memoized (every call counted); evicted after 512 distinct", () => {
    const clock = stubClock();
    install("report");
    const spy = vi.spyOn(__shadowPurifyForTests(), "sanitize");
    const d = dflt();
    for (let i = 0; i < 100; i++) d.createHTML!(UNSAFE);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(totals()["would-alter-html"]).toBe(100);
    for (let i = 0; i < 513; i++) {
      if (i % 150 === 0) clock.t += 30_000; // stay inside every window's budget
      d.createHTML!(`<p>${i}</p>`);
    }
    clock.t += 30_000;
    const before = spy.mock.calls.length;
    d.createHTML!(UNSAFE);
    expect(spy.mock.calls.length).toBe(before + 1);
  });

  it("E7: a late unsafe input within budget is classified", () => {
    stubClock();
    install("report");
    const d = dflt();
    for (let i = 0; i < 150; i++) d.createHTML!(`<p>${i}</p>`);
    d.createHTML!(UNSAFE);
    expect(totals()["would-alter-html"]).toBe(1);
    expect(totals()["not-evaluated"]).toBe(0);
  });

  it("E7: the 201st distinct input in a window counts not-evaluated once, and is classified in the next window", () => {
    const clock = stubClock();
    install("report");
    const spy = vi.spyOn(__shadowPurifyForTests(), "sanitize");
    const d = dflt();
    for (let i = 0; i < 200; i++) d.createHTML!(`<p>${i}</p>`);
    expect(spy).toHaveBeenCalledTimes(200);
    for (let i = 0; i < 5; i++) expect(d.createHTML!("<p>late</p>")).toBe("<p>late</p>");
    expect(spy).toHaveBeenCalledTimes(200);
    expect(totals()["not-evaluated"]).toBe(1);
    clock.t += 30_000;
    d.createHTML!("<p>late</p>");
    expect(spy).toHaveBeenCalledTimes(201);
    expect(totals()["not-evaluated"]).toBe(1);
  });

  it("E8: the size budget is exactly 2,097,152 units; the next distinct input is not evaluated", () => {
    stubClock();
    install("report");
    const spy = vi.spyOn(__shadowPurifyForTests(), "sanitize").mockImplementation(() => "");
    const d = dflt();
    const half = 1_048_576;
    d.createHTML!(`<a${"x".repeat(half - 2)}`);
    d.createHTML!(`<b${"x".repeat(half - 2)}`);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(totals()["not-evaluated"]).toBe(0);
    d.createHTML!("<");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(totals()["not-evaluated"]).toBe(1);
  });

  it("E8: the time budget is 50 ms; a window that already used it skips the next input", () => {
    const clock = stubClock();
    install("report");
    const spy = vi.spyOn(__shadowPurifyForTests(), "sanitize").mockImplementation(() => {
      clock.t += 30;
      return "";
    });
    const d = dflt();
    d.createHTML!("<p>1</p>");
    d.createHTML!("<p>2</p>");
    d.createHTML!("<p>3</p>");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(totals()["not-evaluated"]).toBe(1);
  });
});

describe("shadow isolation and faults (#E9–#E11)", () => {
  it("E9: a default callback re-entered during classification returns its input and counts nothing", () => {
    install("report");
    let nested: unknown;
    vi.spyOn(__shadowPurifyForTests(), "sanitize").mockImplementation(() => {
      nested = dflt().createHTML!("<b>n</b>");
      return "<i>o</i>";
    });
    for (let i = 0; i < 3; i++) dflt().createHTML!(`<i>o</i>${"x".repeat(i)}`);
    expect(nested).toBe("<b>n</b>");
    expect(__defaultHitCountForTests()).toBe(3);
    for (const o of SHADOW_OUTCOMES) expect(totals()[o], o).toBe(0);
    // the same calls without shadow evaluation (off) count the same default hits
    __resetTrustedTypesForTests();
    install("off");
    for (let i = 0; i < 3; i++) dflt().createHTML!(`<i>o</i>${"x".repeat(i)}`);
    expect(__defaultHitCountForTests()).toBe(3);
  });

  it("E10: an unavailable sanitizer counts would-throw-html; a classifier fault counts shadow-error; neither throws", () => {
    install("report");
    const inst = __shadowPurifyForTests();
    const input = "<style>a{}</style><p>x</p>";
    inst.isSupported = false;
    expect(dflt().createHTML!(input)).toBe(input);
    expect(totals()).toMatchObject({ "would-throw-html": 1, "shadow-error": 0 });
    __resetTrustedTypesForTests();
    install("report");
    const inst2 = __shadowPurifyForTests();
    const real = inst2.sanitize.bind(inst2);
    vi.spyOn(inst2, "sanitize").mockImplementation(((s: string, cfg?: { FORCE_BODY?: boolean }) => {
      if (cfg?.FORCE_BODY) throw new Error("pass-2 fault");
      return real(s, cfg as never);
    }) as never);
    expect(dflt().createHTML!(input)).toBe(input);
    expect(totals()).toMatchObject({ "would-throw-html": 0, "shadow-error": 1 });
  });

  it("E11: one private parse-only policy, used by the classifier and not exported; no factory → no policy, classifier still works", () => {
    install("report");
    expect(fake.order.filter((n) => n === "pi-shadow-parse")).toHaveLength(1);
    expect(fake.order.filter((n) => n === "default")).toHaveLength(1);
    const parse = vi.spyOn(fake.policies.get("pi-shadow-parse")!, "createHTML" as never);
    dflt().createHTML!(UNSAFE);
    expect(parse).toHaveBeenCalled();
    expect(Object.keys(trustedTypesModule).filter((k) => /parse/i.test(k))).toEqual([]);

    __resetTrustedTypesForTests();
    vi.stubGlobal("trustedTypes", undefined);
    expect(() => installTrustedTypes("report")).not.toThrow();
    const inst = __shadowPurifyForTests();
    expect(inst.sanitize(UNSAFE)).not.toMatch(/onerror/);
  });
});

describe("shadow transport (#E12–#E14, #X2)", () => {
  it("E12: a total over 1,000,000 is split; a shadow-only report has no entries", async () => {
    install("report");
    __shadowTotalsForTests()["would-block-script"] = 1_000_001;
    const f = okFetch();
    await flushViolations(f);
    await flushViolations(f);
    expect(bodyOf(f, 0).entries).toEqual([]);
    expect(bodyOf(f, 0).shadow).toEqual({ "would-block-script": 1_000_000 });
    expect(bodyOf(f, 1).shadow).toEqual({ "would-block-script": 1 });
  });

  it.each([
    [200, { "would-block-script": 1 }],
    [400, { "would-block-script": 1, "shadow-error": 1 }],
    [401, { "would-alter-html": 3, "would-block-script": 1 }],
    [403, { "would-alter-html": 3, "would-block-script": 1 }],
    [408, { "would-alter-html": 3, "would-block-script": 1 }],
    [413, { "would-alter-html": 3, "would-block-script": 1 }],
    [429, { "would-alter-html": 3, "would-block-script": 1 }],
    [500, { "would-alter-html": 3, "would-block-script": 1 }],
    ["reject", { "would-alter-html": 3, "would-block-script": 1 }],
  ] as const)("E13: first send answered %s → next shadow aggregate %j", async (outcome, expected) => {
    install("report");
    __shadowTotalsForTests()["would-alter-html"] = 3;
    const first = outcome === "reject" ? vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) : okFetch(outcome);
    await expect(flushViolations(first)).resolves.toBeUndefined();
    __shadowTotalsForTests()["would-block-script"] += 1;
    const second = okFetch();
    await flushViolations(second);
    expect(bodyOf(second).shadow).toEqual(expected);
  });

  const sources = (n: number) => `https://h/${"a".repeat(600)}${n}`;
  const violate = (directive: string, i: number) =>
    recordViolation({ effectiveDirective: directive, sample: `sink${i}|x`, sourceFile: sources(i), lineNumber: 1 });

  it("E14: the body stays ≤ 7,168 B, sources are cut to 512, priority order violations → default hits → shadow detail", async () => {
    install("report");
    for (let i = 0; i < 20; i++) violate("require-trusted-types-for", i);
    for (let i = 0; i < 20; i++) violate("trusted-types-default", i);
    for (let i = 0; i < 20; i++) violate("trusted-types-shadow", i);
    __shadowTotalsForTests()["would-alter-html"] = 1;
    const f = okFetch();
    await flushViolations(f);
    const raw = (f.mock.calls[0][1] as RequestInit).body as string;
    const body = bodyOf(f);
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(7_168);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.length).toBeLessThan(60);
    for (const e of body.entries) expect(e.source).toHaveLength(512);
    const rank = (d: string) => (d === "trusted-types-shadow" ? 2 : d === "trusted-types-default" ? 1 : 0);
    const ranks = body.entries.map((e) => rank(e.directive));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(body.overflow).toBe(60 - body.entries.length);
    expect(body.shadow).toEqual({ "would-alter-html": 1 });
  });

  it("E14: 60 non-shadow keys + 1 shadow outcome — the cap is 50, shadow detail is shed first, the aggregate is still sent", async () => {
    install("report");
    for (let i = 0; i < 60; i++) recordViolation({ effectiveDirective: "d", sample: `s${i}|x`, sourceFile: "https://h/a.js", lineNumber: 1 });
    recordViolation({ effectiveDirective: "trusted-types-shadow", sample: "would-block-script|x", sourceFile: "https://h/a.js", lineNumber: 1 });
    __shadowTotalsForTests()["would-block-script"] = 1;
    const body = await flushed();
    expect(body.entries).toHaveLength(MAX_REPORT_KEYS);
    expect(body.entries.every((e) => e.directive === "d")).toBe(true);
    expect(body.overflow).toBe(11);
    expect(body.shadow).toEqual({ "would-block-script": 1 });
  });

  it("X2: pagehide sends the totals once with keepalive and never throws", () => {
    install("report");
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const stop = startViolationReporter(window);
    __shadowTotalsForTests()["would-alter-html"] = 2;
    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    stop();
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
    expect(bodyOf(f).shadow).toEqual({ "would-alter-html": 2 });
  });
});
