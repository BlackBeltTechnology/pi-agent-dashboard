/**
 * Trusted Types policy module (change: harden-client-sinks, design D5/D6/D8).
 * jsdom has no `trustedTypes`: a fake factory records the policies so their
 * rules can be exercised directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __defaultHitCountForTests,
  __resetTrustedTypesForTests,
  flushViolations,
  installTrustedTypes,
  MAX_REPORT_KEYS,
  readTrustedTypesMode,
  recordViolation,
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
