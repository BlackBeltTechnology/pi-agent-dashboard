/**
 * Step engine (pure). Test-plan #E1–E10, #E13, E7.
 * See change: add-remote-access-wizard.
 */
import type { TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderReadiness, TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { describe, expect, it } from "vitest";
import {
  approveOutcome,
  deviceEndpoint,
  EMPTY_SNAPSHOT,
  evaluate,
  FAILED,
  foldRows,
  LOADING,
  loaded,
  type PlanRow,
  planTask,
  type RaConfig,
  type RunState,
  roads,
  type Snapshot,
  unknownLabel,
} from "../steps.js";

type Readiness = ProviderReadiness["state"];

interface SnapOpts {
  provider?: string;
  readiness?: Readiness;
  reservedName?: string;
  persistent?: boolean;
  degraded?: boolean;
  connected?: string[];
  url?: string;
  resolved?: string;
  pending?: string;
  acceptLan?: boolean;
  trusted?: string[];
  bypass?: string[];
  endpoints?: TunnelEndpoint[];
}

/** Snapshot builder: every source loaded, boring defaults, overridable. */
function snap(o: SnapOpts = {}): Snapshot {
  const provider = "provider" in o ? o.provider : "zrok";
  const config: RaConfig = {
    tunnel: { provider, zrok: { reservedName: o.reservedName, persistent: o.persistent ?? true } },
    pairing: { acceptLanRequests: o.acceptLan ?? false },
    trustedNetworks: o.trusted ?? [],
    auth: { bypassHosts: o.bypass ?? [] },
    reachability: {
      resolvedBindHost: o.resolved ?? "127.0.0.1",
      pendingBindHost: o.pending ?? o.resolved ?? "127.0.0.1",
      unreachable: [],
      bindHostSource: "config",
    },
  };
  const connected = o.connected ?? [];
  const status = (
    connected.length > 0
      ? {
          status: "active",
          url: o.url ?? "https://robson-home.shares.zrok.io",
          serverOs: "darwin",
          ...(o.degraded ? { degraded: { configuredName: "robson-home", effectiveName: "tmp" } } : {}),
          connectedProviders: connected,
        }
      : { status: "inactive", serverOs: "darwin", connectedProviders: [] }
  ) as TunnelStatusDetail;
  return {
    config: loaded(config),
    readiness: loaded([{ provider: (provider ?? "zrok") as ProviderReadiness["provider"], state: o.readiness ?? "disconnected", endpoints: [] }]),
    status: loaded(status),
    endpoints: loaded(o.endpoints ?? []),
  };
}

const states = (s: Snapshot, task: Parameters<typeof planTask>[0], run?: RunState) =>
  Object.fromEntries(planTask(task, s, run).rows.map((r) => [r.id, r.state]));

describe("planTask share", () => {
  it("E1: zrok ready but offline → current is Go online, k=5 of 6", () => {
    const plan = planTask("share", snap({ reservedName: "robson-home" }));
    expect(plan.current).toBe("connect");
    expect(plan.rows.slice(0, 4).map((r) => r.state)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(plan.k).toBe(5);
    expect(plan.n).toBe(6);
  });

  it("E6: Public address satisfaction + applicability", () => {
    const addr = (o: SnapOpts) => planTask("share", snap(o)).rows.find((r) => r.id === "address");
    expect(addr({ reservedName: "robson-home", persistent: true })?.state).toBe("skipped");
    const degraded = addr({ reservedName: "robson-home", persistent: true, degraded: true, connected: ["zrok"] });
    expect(degraded?.state).toBe("current");
    expect(degraded?.degraded).toBe(true);
    expect(addr({ persistent: true })?.state).toBe("current");
    expect(addr({ persistent: false })?.state).toBe("skipped");
    const tail = planTask("share", snap({ provider: "tailscale", persistent: true }));
    expect(tail.rows.find((r) => r.id === "address")).toBeUndefined();
    expect(tail.n).toBe(5);
  });

  it("re-opening a satisfied step makes it current and keeps its value (F4)", () => {
    const s = snap({ reservedName: "robson-home" });
    const plan = planTask("share", s, { task: "share", done: [], open: "address" });
    const row = plan.rows.find((r) => r.id === "address");
    expect(plan.current).toBe("address");
    expect(row).toMatchObject({ state: "current", value: "robson-home" });
  });

  it("a step completed during the run reads done, not already set", () => {
    const s = snap({ reservedName: "robson-home" });
    const plan = planTask("share", s, { task: "share", done: ["provider"] });
    expect(plan.rows[0].state).toBe("done");
    expect(plan.rows[1].state).toBe("skipped");
  });
});

describe("evaluate", () => {
  it("E2: Install / Enable follow readiness", () => {
    const rd = (state: Readiness) => snap({ readiness: state });
    const states4: Readiness[] = ["not-installed", "not-set", "disconnected", "connected"];
    expect(states4.map((r) => evaluate("install", rd(r)).sat)).toEqual([false, true, true, true]);
    expect(states4.map((r) => evaluate("enable", rd(r)).sat)).toEqual([false, false, true, true]);
  });

  it("E3: Who may enter is derived from the trusted entries", () => {
    const door = (trusted: string[], extra: SnapOpts = {}) => evaluate("door", snap({ trusted, ...extra })).sat;
    expect(door([])).toBe(true);
    expect(door(["127.0.0.1", "::1"])).toBe(true);
    expect(door(["::1/128"])).toBe(true);
    expect(door(["127.0.0.0/1"])).toBe(false);
    expect(door(["0.0.0.0/0"])).toBe(false);
    expect(door(["*.*.*.*"])).toBe(false);
    expect(door(["localhost"])).toBe(false);
    expect(door(["192.168.16.0/24"])).toBe(false);
  });

  it("E3: auth.bypassHosts count too, and 'continue anyway' waives for the run only", () => {
    expect(evaluate("door", snap({ bypass: ["10.0.0.0/8"] })).sat).toBe(false);
    const s = snap({ trusted: ["192.168.16.0/24"] });
    expect(evaluate("door", s, { task: "share", done: [], waived: ["door"] }).sat).toBe(true);
    expect(evaluate("door", s).sat).toBe(false);
  });

  it("E4: Listen on network follows the RESOLVED bind host", () => {
    const hosts = ["127.0.0.1", "localhost", "::1", "0.0.0.0", "::", "192.168.16.220"];
    expect(hosts.map((h) => evaluate("bind", snap({ resolved: h })).sat)).toEqual([false, false, false, true, true, true]);
    expect(evaluate("bind", snap({ resolved: "0.0.0.0" })).value).toBe("all networks (0.0.0.0)");
  });

  it("E10: an unloaded or failed source is unknown, never a default", () => {
    const loadingCfg: Snapshot = { ...EMPTY_SNAPSHOT, config: LOADING };
    const failedCfg: Snapshot = { ...EMPTY_SNAPSHOT, config: FAILED };
    for (const id of ["bind", "accept"] as const) {
      expect(evaluate(id, loadingCfg)).toMatchObject({ sat: "unknown", pending: "loading" });
      expect(evaluate(id, failedCfg)).toMatchObject({ sat: "unknown", pending: "error" });
    }
    expect(unknownLabel("loading")).toBe("Checking…");
    expect(unknownLabel("error")).toBe("unknown");
  });

  it("a live reachability broadcast outranks the config read", () => {
    const s: Snapshot = { ...snap({ resolved: "127.0.0.1" }), live: { resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" } };
    expect(evaluate("bind", s).sat).toBe(true);
    const noConfig: Snapshot = { ...EMPTY_SNAPSHOT, live: { resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" } };
    expect(evaluate("bind", noConfig).sat).toBe(true);
  });
});

describe("roads", () => {
  it("E5: LAN road states", () => {
    const lan = (o: SnapOpts) => roads(snap(o)).lan;
    expect(lan({ resolved: "127.0.0.1", pending: "127.0.0.1" }).state).toBe("off");
    expect(lan({ resolved: "127.0.0.1", pending: "0.0.0.0" }).state).toBe("restart-pending");
    expect(lan({ resolved: "0.0.0.0", acceptLan: false }).state).toBe("listening");
    expect(lan({ resolved: "0.0.0.0", acceptLan: true })).toEqual({ state: "on", bind: "all networks (0.0.0.0)" });
  });

  it("LAN road is loading, then unknown on failure — never Off", () => {
    expect(roads({ ...EMPTY_SNAPSHOT, config: LOADING }).lan.state).toBe("loading");
    expect(roads({ ...EMPTY_SNAPSHOT, config: FAILED }).lan.state).toBe("unknown");
  });

  it("Internet road shows its address and flags a private mesh", () => {
    const on = roads(snap({ connected: ["zrok"], url: "https://robson-home.shares.zrok.io" })).internet;
    expect(on).toMatchObject({ state: "on", address: "https://robson-home.shares.zrok.io", private: false });
    expect(roads(snap({ provider: "tailscale", connected: ["tailscale"] })).internet.private).toBe(true);
    expect(roads(snap()).internet.state).toBe("off");
  });
});

describe("device task", () => {
  const https: TunnelEndpoint = { kind: "public", url: "https://robson-home.shares.zrok.io", tls: true };
  const lanEp: TunnelEndpoint = { kind: "lan", url: "http://192.168.16.220:8000", tls: false };

  it("E8: road inference", () => {
    const road = (o: SnapOpts) => evaluate("road", snap(o));
    expect(road({ connected: ["zrok"], endpoints: [https] })).toMatchObject({ sat: true, value: https.url });
    expect(road({ resolved: "0.0.0.0", acceptLan: true, endpoints: [lanEp] })).toMatchObject({ sat: true, value: lanEp.url });
    expect(road({ resolved: "0.0.0.0", acceptLan: false, endpoints: [lanEp] }).sat).toBe(false);
    expect(road({}).sat).toBe(false);
  });

  it("E9: choosing a branch inserts steps and they stay listed once satisfied", () => {
    const none = snap();
    const ids = (run: RunState, s = none) => planTask("device", s, run).rows.map((r) => r.id);
    expect(ids({ task: "device", done: [], branch: "wifi" })).toEqual(["road", "bind", "accept", "qr", "approve"]);
    expect(ids({ task: "device", done: [], branch: "anywhere" })).toEqual([
      "road", "provider", "install", "enable", "address", "connect", "qr", "approve",
    ]);
    const satisfied = snap({ resolved: "0.0.0.0", acceptLan: true });
    expect(ids({ task: "device", done: [], branch: "wifi" }, satisfied)).toEqual(["road", "bind", "accept", "qr", "approve"]);
    expect(states(satisfied, "device", { task: "device", done: [], branch: "wifi" })).toMatchObject({
      road: "skipped", bind: "skipped", accept: "skipped", qr: "current",
    });
  });

  it("LAN only: never shows a stale public TLS endpoint, and prefers an https LAN address", () => {
    const lanOnly = snap({ resolved: "0.0.0.0", acceptLan: true, endpoints: [https, lanEp] });
    expect(deviceEndpoint(lanOnly)).toEqual(lanEp);
    const tlsLan: TunnelEndpoint = { kind: "lan", url: "https://192.168.16.220:8443", tls: true };
    expect(deviceEndpoint(snap({ resolved: "0.0.0.0", acceptLan: true, endpoints: [lanEp, tlsLan] }))).toEqual(tlsLan);
  });

  it("with a road already up nothing is inserted and Open it on the device is current", () => {
    const s = snap({ connected: ["zrok"], endpoints: [https] });
    const plan = planTask("device", s);
    expect(plan.rows.map((r) => r.id)).toEqual(["road", "qr", "approve"]);
    expect(plan.current).toBe("qr");
  });
});

describe("lan task", () => {
  it("lists Listen on network → Let devices ask → Who may enter", () => {
    expect(planTask("lan", snap()).rows.map((r) => r.id)).toEqual(["bind", "accept", "door"]);
  });
});

describe("foldRows", () => {
  const row = (state: PlanRow["state"], id = "provider"): PlanRow => ({ id: id as PlanRow["id"], state, sat: state !== "todo" && state !== "current" });

  it("E7: two collapsed rows fold; labels flip when any was done this run", () => {
    const f1 = foldRows([row("skipped"), row("skipped", "install"), row("current", "enable")]);
    expect(f1.map((i) => i.kind)).toEqual(["fold", "row"]);
    expect(f1[0]).toMatchObject({ kind: "fold", anyDone: false });
    const f3 = foldRows([row("skipped"), row("done", "install"), row("current", "enable")]);
    expect(f3[0]).toMatchObject({ kind: "fold", anyDone: true });
  });

  it("E7: a single collapsed row stays a row; showSkipped unfolds", () => {
    expect(foldRows([row("skipped"), row("current", "install")]).map((i) => i.kind)).toEqual(["row", "row"]);
    expect(foldRows([row("skipped"), row("skipped", "install"), row("current", "enable")], true).map((i) => i.kind)).toEqual([
      "row", "row", "row",
    ]);
  });

  it("a todo row between collapsed runs splits the fold", () => {
    const items = foldRows([row("skipped"), row("skipped", "install"), row("todo", "enable"), row("skipped", "address")]);
    expect(items.map((i) => i.kind)).toEqual(["fold", "row", "row"]);
  });
});

describe("approveOutcome", () => {
  const dev = (id: string) => ({ id, label: `${id} label` });
  it("E13: one new device is named, several are counted, none is denied/expired", () => {
    expect(approveOutcome(["a"], [dev("a"), dev("b")])).toEqual({ kind: "paired", devices: [dev("b")] });
    const many = approveOutcome(["a"], [dev("a"), dev("b"), dev("c")]);
    expect(many.kind === "paired" && many.devices.length).toBe(2);
    expect(approveOutcome(["a"], [dev("a")])).toEqual({ kind: "denied" });
  });
});
