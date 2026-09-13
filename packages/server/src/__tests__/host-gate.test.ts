import { describe, expect, it } from "vitest";
import {
  admittedHostRows,
  HostGateState,
  hostGateEnvWarning,
  renderHostGateHtml,
  resolveHostGateMode,
  wantsHtml,
} from "../auth/host-gate.js";

/**
 * Host-gate decisions + refusal bookkeeping (test-plan #E9, #E20–#E24, #X2, #X3).
 * See change: add-host-allowlist-admission.
 */

function collect(): { lines: string[]; sink: (l: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (l: string) => lines.push(l) };
}

describe("#E9 resolveHostGateMode + boot warning", () => {
  it("env wins when recognised; unrecognised falls through to config", () => {
    expect(resolveHostGateMode(undefined, undefined)).toEqual({ mode: "report", envOverridden: false });
    expect(resolveHostGateMode("enforce", undefined)).toEqual({ mode: "enforce", envOverridden: true });
    expect(resolveHostGateMode("report", "enforce")).toEqual({ mode: "report", envOverridden: true });
    expect(resolveHostGateMode("yes", undefined)).toEqual({ mode: "report", envOverridden: false });
    expect(resolveHostGateMode("yes", "enforce")).toEqual({ mode: "enforce", envOverridden: false });
  });

  it("warns once for an unrecognised env value, naming the variable", () => {
    expect(hostGateEnvWarning("yes")).toContain("PI_DASHBOARD_HOST_GATE");
    expect(hostGateEnvWarning("yes")).toContain("yes");
    expect(hostGateEnvWarning(undefined)).toBeNull();
    expect(hostGateEnvWarning("")).toBeNull();
    expect(hostGateEnvWarning("report")).toBeNull();
    expect(hostGateEnvWarning("enforce")).toBeNull();
  });
});

describe("#E22 admittedHostRows", () => {
  it("renders derived rows plus one pattern row per category", () => {
    const rows = admittedHostRows({
      publicBaseUrls: ["https://pi.example.com"],
      allowedHosts: ["dash.home.arpa"],
      getLiveTunnelOrigins: () => ["https://abc.share.zrok.io"],
    });
    expect(rows).toContainEqual({ host: "pi.example.com", source: "public-base-url" });
    expect(rows).toContainEqual({ host: "dash.home.arpa", source: "allowed-host" });
    expect(rows).toContainEqual({ host: "abc.share.zrok.io", source: "live-tunnel" });
    expect(rows.filter((r) => r.source === "local")).toHaveLength(1);
    expect(rows.filter((r) => r.source === "ip-address")).toHaveLength(1);
  });
});

describe("#X2 per-host rate limit", () => {
  it("logs at most one line per hostname per minute, counts every refusal", () => {
    const { lines, sink } = collect();
    const state = new HostGateState({ now: () => 1000, sink });
    for (let i = 0; i < 100; i++) state.recordRefusal("rebind.example:8000", "would-refuse", "GET /");
    expect(lines.filter((l) => l.includes("host=rebind.example")).length).toBeLessThanOrEqual(1);
    expect(state.recent()[0]).toMatchObject({ host: "rebind.example", count: 100 });
  });
});

describe("#X3 distinct-host scan cap", () => {
  it("caps at <=60 lines plus one suppressed summary; ring stays at 50", () => {
    const { lines, sink } = collect();
    let t = 1000;
    const state = new HostGateState({ now: () => t, sink });
    for (let i = 0; i < 10_000; i++) {
      state.recordRefusal(`a${i}.rebind.example`, "would-refuse", "GET /");
    }
    expect(lines.filter((l) => l.includes("refused host=") || l.includes("would-refuse host=")).length)
      .toBeLessThanOrEqual(60);
    t += 61_000;
    state.flush();
    expect(lines.filter((l) => l.includes("suppressed")).length).toBe(1);
    expect(lines.find((l) => l.includes("suppressed"))).toContain("9940");
    expect(state.recent().length).toBe(50);
  });
});

describe("#E23/#E24 refusal ring", () => {
  it("aggregates counts without the port and evicts least-recently-seen", () => {
    let t = 1000;
    const state = new HostGateState({ now: () => t, sink: () => {} });
    for (let i = 0; i < 3; i++) state.recordRefusal("rebind.example:8000", "would-refuse", "x");
    state.recordRefusal("proxy-int.corp", "would-refuse", "x");
    const afterBurst = state.recent();
    expect(afterBurst.find((e) => e.host === "rebind.example")?.count).toBe(3);
    expect(afterBurst.find((e) => e.host === "proxy-int.corp")?.count).toBe(1);
    for (let i = 0; i < 50; i++) {
      t += 1;
      state.recordRefusal(`b${i}.example`, "would-refuse", "x");
    }
    // Bound is 50; the two least-recently-seen (the first burst) are evicted.
    expect(state.recent().length).toBe(50);
    expect(state.recent().find((e) => e.host === "rebind.example")).toBeUndefined();
    expect(state.recent().find((e) => e.host === "proxy-int.corp")).toBeUndefined();
    t += 1;
    state.recordRefusal("rebind.example:8000", "would-refuse", "x");
    expect(state.recent()[0]).toMatchObject({ host: "rebind.example", count: 1 });
  });

  it("keys a malformed / absent Host as (malformed)", () => {
    const state = new HostGateState({ now: () => 1, sink: () => {} });
    state.recordRefusal(undefined, "would-refuse", "x");
    state.recordRefusal("evil.example/@x", "would-refuse", "x");
    expect(state.recent().find((e) => e.host === "(malformed)")?.count).toBe(2);
  });
});

describe("#E19/#E20/#E21 refusal body", () => {
  it("negotiates HTML only when the first media type is text/html", () => {
    expect(wantsHtml("text/html,*/*;q=0.8")).toBe(true);
    expect(wantsHtml("application/json")).toBe(false);
    expect(wantsHtml("application/json, text/html;q=0.9")).toBe(false);
    expect(wantsHtml("*/*")).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
  });

  it("renders the received host, localhost entry point and config keys, no assets", () => {
    const html = renderHostGateHtml("rebind.example:8000", 8000);
    expect(html).toContain("rebind.example:8000");
    expect(html).toContain("localhost:8000");
    expect(html).toContain("allowedHosts");
    expect(html).toContain("publicBaseUrls");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("/assets/");
    // no enumeration of admitted hosts
    expect(renderHostGateHtml("rebind.example", 8000)).not.toContain("abc.share.zrok.io");
  });

  it("escapes the attacker-controlled received Host", () => {
    const html = renderHostGateHtml("a<img>.example", 8000);
    expect(html).toContain("a&lt;img&gt;.example");
    expect(html).not.toContain("<img>");
  });
});
