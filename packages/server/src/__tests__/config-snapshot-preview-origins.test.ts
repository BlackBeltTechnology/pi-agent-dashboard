/**
 * `getResolvedPreviewOrigins()` — live read, change-only logging, change listeners.
 * See change: serve-live-previews-on-capability-origin (D12; test-plan #E9, #E13, #E53, #P6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configSnapshotParseCount,
  getResolvedPreviewOrigins,
  notifyPreviewOriginsRuntimeChanged,
  onPreviewOriginsChange,
  resetConfigSnapshot,
  setPreviewOriginsRuntime,
} from "../config-snapshot.js";

let tmp: string;
let origHome: string | undefined;
let tick = 0;
const cfg = () => path.join(tmp, ".pi", "dashboard", "config.json");
/** Write the file and force a distinct mtime so the stamp moves even within one millisecond. */
function write(data: object) {
  fs.mkdirSync(path.dirname(cfg()), { recursive: true });
  fs.writeFileSync(cfg(), JSON.stringify(data), { mode: 0o600 });
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(cfg(), t, t);
}
const a26 = "a".repeat(26);
const wildcard = { suffix: "preview.example.com", forHosts: ["dash.example.com"] };
const lines = (spy: { mock: { calls: unknown[][] } }, needle: string) =>
  spy.mock.calls.filter((c) => String(c[0]).includes(needle));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-po-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
  setPreviewOriginsRuntime({});
});
afterEach(() => {
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  setPreviewOriginsRuntime({});
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("getResolvedPreviewOrigins (E13)", () => {
  it("defaults: tiers 1 and 5, boot line logged once", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    write({});
    expect(getResolvedPreviewOrigins().tiers).toEqual([1, 5]);
    getResolvedPreviewOrigins();
    expect(lines(log, "tiers:")).toHaveLength(1);
    expect(String(lines(log, "tiers:")[0][0])).toContain("tiers: 1, 5");
  });

  it("flips on the next read with no restart; the live-change line names the tiers", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    write({ liveServer: { previewOrigins: { wildcard } } });
    expect(getResolvedPreviewOrigins().tiers).toEqual([1, 2, 5]);
    write({ liveServer: { previewOrigins: { enabled: false, wildcard } } });
    const off = getResolvedPreviewOrigins();
    expect(off.enabled).toBe(false);
    expect(off.tiers).toEqual([]);
    write({ liveServer: { previewOrigins: { wildcard: { ...wildcard, suffix: "p2.example.com" } } } });
    expect(getResolvedPreviewOrigins().wildcard?.suffix).toBe("p2.example.com");
    expect(lines(log, "tiers:")).toHaveLength(3);
    expect(String(lines(log, "tiers:")[1][0])).toContain("legacy");
  });

  it("logs parse issues of the raw file (the cleaned config no longer has them)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    write({ liveServer: { previewOrigins: { portPool: "8100" } } });
    expect(getResolvedPreviewOrigins().issues).toHaveLength(1);
    getResolvedPreviewOrigins();
    expect(lines(warn, "liveServer.previewOrigins.portPool")).toHaveLength(1);
  });
});

describe("live re-evaluation (E9)", () => {
  it("an overlapping allowedHosts entry disables tier 2 on the next read; removing it re-enables", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    write({ liveServer: { previewOrigins: { wildcard } } });
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    write({ allowedHosts: [`${a26}.preview.example.com`], liveServer: { previewOrigins: { wildcard } } });
    const r = getResolvedPreviewOrigins();
    expect(r.tiers).not.toContain(2);
    expect(lines(warn, "allowedHosts")).toHaveLength(1);
    write({ liveServer: { previewOrigins: { wildcard } } });
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
  });
});

describe("tunnel / TLS runtime inputs (E53)", () => {
  it("a live tunnel overlapping the suffix disables tier 2 after notify, and fires the change listener", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    let tunnels: string[] = [];
    setPreviewOriginsRuntime({ tunnelOrigins: () => tunnels });
    write({ liveServer: { previewOrigins: { wildcard } } });
    const seen: number[][] = [];
    onPreviewOriginsChange((next) => seen.push(next.tiers));
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    tunnels = [`https://${a26}.preview.example.com`];
    // memoised until the runtime says it moved
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    notifyPreviewOriginsRuntimeChanged();
    expect(getResolvedPreviewOrigins().tiers).not.toContain(2);
    expect(seen).toEqual([[1, 5]]);
  });

  it("static admission rows disable the tier through the injected classifier", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    setPreviewOriginsRuntime({ classifyAdmittedHostname: (h) => (h.endsWith(".local") ? "local" : null) });
    write({ liveServer: { previewOrigins: { wildcard: { suffix: "preview.local", forHosts: ["d.example.com"] } } } });
    expect(getResolvedPreviewOrigins().tiers).toEqual([1, 5]);
  });
});

describe("churn (P6)", () => {
  it("validator runs per change only; an unchanged read is memoised; a persistently invalid value logs once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    write({ liveServer: { previewOrigins: { portPool: "bad" } } });
    getResolvedPreviewOrigins();
    const parses = configSnapshotParseCount();
    for (let i = 0; i < 500; i++) getResolvedPreviewOrigins();
    expect(configSnapshotParseCount()).toBe(parses);
    // 20 unrelated rewrites that keep the same invalid value: still one line
    for (let i = 0; i < 20; i++) write({ sessionList: { x: i }, liveServer: { previewOrigins: { portPool: "bad" } } });
    for (let i = 0; i < 20; i++) getResolvedPreviewOrigins();
    expect(lines(warn, "portPool")).toHaveLength(1);
    // a validity transition logs once each way
    write({ liveServer: { previewOrigins: { portPool: "8100-8199" } } });
    getResolvedPreviewOrigins();
    write({ liveServer: { previewOrigins: { portPool: "bad" } } });
    getResolvedPreviewOrigins();
    expect(lines(warn, "portPool")).toHaveLength(2);
  });
});
