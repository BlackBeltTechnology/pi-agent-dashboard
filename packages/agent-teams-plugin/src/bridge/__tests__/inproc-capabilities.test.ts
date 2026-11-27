/**
 * Capability handshake and availability gate of the lead bridge (test-plan S4-S8): the 500 ms probe, the lost
 * activation race, the fail-closed verdict (decision table + malformed answers) and the `no_context` retry. The
 * probe reports through a real `inproc hello` into the real server runtime.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { type HelloShape, linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { createDoubleBus, type DoubleOptions, installSubagentsDouble, validCapabilities } from "../../__tests__/harness/subagents-double.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import { type CapabilityVerdict, evaluateCapabilities, OPTIONAL_FEATURES, REQUIRED_API_VERSION, REQUIRED_FEATURES, SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import { CAPABILITY_PROBE_TIMEOUT_MS, createCapabilityProber } from "../inproc-capabilities.js";

function rig(options: Partial<Omit<DoubleOptions, "clock">> = {}, installed = true) {
  const clock = new FakeClock(1_000);
  const bus = createDoubleBus();
  const probes: string[] = [];
  const emitSpy = { emit: (channel: string, payload: unknown) => (channel === SUBAGENTS_CHANNEL.capabilities && probes.push(channel), bus.emit(channel, payload)) };
  const double = installed ? installSubagentsDouble(bus, { clock, ...options }) : undefined;
  const verdicts: Array<{ verdict: CapabilityVerdict; trigger: string }> = [];
  const prober = createCapabilityProber({ bus: emitSpy, clock, report: (verdict, trigger) => void verdicts.push({ verdict, trigger }) });
  return { clock, bus, double, prober, verdicts, probes, install: () => installSubagentsDouble(bus, { clock, ...options }) };
}

describe("S4 availability gate: the 500 ms probe", () => {
  it("the deadline constant is 500 ms", () => expect(CAPABILITY_PROBE_TIMEOUT_MS).toBe(500));

  it.each([
    [0, true],
    [499, true],
    [500, true],
    [501, false],
  ])("a reply delayed %i ms → available: %s", async (delay, available) => {
    const r = rig({ capabilities: { delayMs: delay } });
    const p = r.prober.probe("session_start");
    await r.clock.advanceAsync(600);
    const v = await p;
    expect(v.available).toBe(available);
    if (!available) expect(v).toMatchObject({ reason: "subagents_extension_missing" });
    expect(r.verdicts).toHaveLength(1);
  });

  it("no answer at all (never) → unavailable subagents_extension_missing with the install hint", async () => {
    const r = rig({ capabilities: "never" });
    const p = r.prober.probe("session_start");
    await r.clock.advanceAsync(10_000);
    expect(await p).toMatchObject({ available: false, reason: "subagents_extension_missing" });
  });

  it("no handler at all (package not installed) → missing at once, without waiting", async () => {
    const r = rig({}, false);
    expect(await r.prober.probe("session_start")).toMatchObject({ available: false, reason: "subagents_extension_missing" });
    expect(r.clock.pendingCount).toBe(0);
  });

  it("a late answer (after 501 ms) does not flip the first verdict, but the next trigger re-probe does", async () => {
    const r = rig({ capabilities: { delayMs: 501 } });
    const first = r.prober.probe("session_start");
    await r.clock.advanceAsync(600);
    expect(await first).toMatchObject({ available: false });
    expect(r.prober.verdict?.available).toBe(false); // the late 501 ms answer came and changed nothing
    r.double?.setCapabilities("sync");
    r.prober.onEmptyReply();
    await Promise.resolve();
    expect(r.prober.verdict?.available).toBe(true);
    expect(r.verdicts.map((v) => v.verdict.available)).toEqual([false, true]);
  });
});

describe("S5 availability gate: the lost activation race", () => {
  it("the probe at session_start is unanswered, the extension activates a tick later and emits its first event: one re-probe, a second hello available, TeamCreate works with no reconnect", async () => {
    const env = createTeamsEnv({ runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    const bus = createDoubleBus();
    let queries = 0;
    const counted = { emit: (c: string, p: unknown) => (c === SUBAGENTS_CHANNEL.capabilities && queries++, bus.emit(c, p)) };
    const toHello = (v: CapabilityVerdict): HelloShape => (v.available ? { available: true, apiVersion: v.apiVersion, features: v.features, maxConcurrent: v.limits.maxConcurrent } : { available: false, reason: v.reason, missing: v.missing });
    const hellos: Array<Promise<unknown>> = [];
    const prober = createCapabilityProber({ bus: counted, clock: env.clock, report: (v) => void hellos.push(link.hello(toHello(v))) });
    for (const ch of [SUBAGENTS_CHANNEL.created, SUBAGENTS_CHANNEL.started, SUBAGENTS_CHANNEL.idle]) bus.on(ch, () => prober.onSubagentsEvent());

    await prober.probe("session_start"); // nobody listens yet
    await Promise.all(hellos);
    expect(await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).toMatchObject({ ok: false, error: "mode_unavailable" });

    installSubagentsDouble(bus, { clock: env.clock }); // the subagents extension activates one tick later
    await Promise.resolve();
    for (let i = 0; i < 50; i++) bus.emit(SUBAGENTS_CHANNEL.created, { agentId: `agent-${i}` }); // a burst of events
    await Promise.resolve();
    await Promise.all(hellos);
    expect(queries).toBe(2); // the session_start probe + exactly ONE re-probe, no storm
    expect(hellos).toHaveLength(2);
    expect((await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).ok).toBe(true);
  });

  it("a burst of 50 events while a probe is in flight triggers no second probe", async () => {
    const r = rig({ capabilities: { delayMs: 300 } }, false);
    r.install();
    const first = r.prober.probe("session_start");
    for (let i = 0; i < 50; i++) r.prober.onSubagentsEvent();
    expect(r.probes).toHaveLength(1);
    await r.clock.advanceAsync(400);
    await first;
    expect(r.probes).toHaveLength(1);
  });
});

describe("S6 the capability handshake fails closed (decision table)", () => {
  const versions = [REQUIRED_API_VERSION - 1, REQUIRED_API_VERSION, REQUIRED_API_VERSION + 1];
  const removals: Array<string | undefined> = [undefined, ...REQUIRED_FEATURES, ...OPTIONAL_FEATURES];
  const cases = versions.flatMap((apiVersion) => removals.map((removed) => ({ apiVersion, removed })));

  it("covers 3 versions × (none + 4 required + 3 optional removed) = 24 cases", () => expect(cases).toHaveLength(24));

  it.each(cases.map((c) => [`apiVersion ${c.apiVersion}, removed ${c.removed ?? "nothing"}`, c] as const))("%s", (_name, { apiVersion, removed }) => {
    const features = [...REQUIRED_FEATURES, ...OPTIONAL_FEATURES].filter((f) => f !== removed);
    const v = evaluateCapabilities(validCapabilities({ apiVersion, features }));
    const missingRequired = (REQUIRED_FEATURES as readonly string[]).filter((f) => f === removed);
    if (apiVersion < REQUIRED_API_VERSION || missingRequired.length > 0) {
      expect(v).toMatchObject({ available: false, reason: "subagents_extension_outdated" });
      if (v.available === false) expect([...v.missing].sort()).toEqual(missingRequired.sort()); // names exactly the missing features
    } else {
      expect(v.available).toBe(true);
      if (v.available) {
        expect(v.features).toHaveLength(features.length); // optional features recorded
        if (removed) expect(v.features).not.toContain(removed);
      }
    }
  });

  it("an absent optional `interrupt` leaves the mode available (urgent degrades)", () => {
    const v = evaluateCapabilities(validCapabilities({ features: [...REQUIRED_FEATURES] }));
    expect(v.available).toBe(true);
    if (v.available) expect(v.features).not.toContain("interrupt");
  });

  it("the verdict is never inferred from a package version string", () => {
    const v = evaluateCapabilities({ ...validCapabilities({ apiVersion: 0 }), version: "9.9.9", packageVersion: "0.9.0" });
    expect(v).toMatchObject({ available: false, reason: "subagents_extension_outdated" });
  });
});

describe("S7 malformed capability answers (EP)", () => {
  const ok = validCapabilities();
  const bad: Array<[string, unknown]> = [
    ["empty object", {}],
    ["apiVersion as a string", { ...ok, apiVersion: "1" }],
    ["apiVersion fractional", { ...ok, apiVersion: 1.5 }],
    ["features not an array", { ...ok, features: "spawn" }],
    ["features only unknown strings", { ...ok, features: ["x", "y"] }],
    ["limits missing", { apiVersion: 1, features: ok.features }],
    ["limits null", { ...ok, limits: null }],
    ["maxConcurrent 0", { ...ok, limits: { maxConcurrent: 0 } }],
    ["maxConcurrent -1", { ...ok, limits: { maxConcurrent: -1 } }],
    ["maxConcurrent NaN", { ...ok, limits: { maxConcurrent: Number.NaN } }],
    ["maxConcurrent 1.5", { ...ok, limits: { maxConcurrent: 1.5 } }],
    ["maxConcurrent '4'", { ...ok, limits: { maxConcurrent: "4" } }],
    ["maxConcurrent Infinity", { ...ok, limits: { maxConcurrent: Number.POSITIVE_INFINITY } }],
    ["maxConcurrent missing", { ...ok, limits: {} }],
    ["an array", [1, 2]],
    ["a string", "yes"],
    ["a number", 7],
  ];
  it.each(bad)("%s → unavailable subagents_extension_outdated, never available by default, never throws", (_name, answer) => {
    const v = evaluateCapabilities(answer);
    expect(v).toMatchObject({ available: false, reason: "subagents_extension_outdated" });
  });

  it("unknown feature strings are ignored; a valid answer with extra fields stays available; a __proto__ key is inert", () => {
    const poisoned = JSON.parse('{"apiVersion":1,"features":["spawn","steer","managed","loader","teleport"],"limits":{"maxConcurrent":2,"__proto__":{"x":1}},"extra":{"__proto__":{"y":1}}}');
    const v = evaluateCapabilities(poisoned);
    expect(v.available).toBe(true);
    if (v.available) {
      expect(v.features).toEqual(["spawn", "steer", "managed", "loader"]);
      expect(v.limits.maxConcurrent).toBe(2);
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("no answer is `missing`, not `outdated`", () => {
    expect(evaluateCapabilities(undefined)).toMatchObject({ reason: "subagents_extension_missing" });
    expect(evaluateCapabilities(null)).toMatchObject({ reason: "subagents_extension_missing" });
  });
});

describe("S8 availability reason no_context", () => {
  it("the first TeamCreate fails mode_unavailable (no_context); after the next trigger's re-probe returns ready, TeamCreate succeeds", async () => {
    const env = createTeamsEnv({ runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    const bus = createDoubleBus();
    const double = installSubagentsDouble(bus, { clock: env.clock, answer: { reason: "no_context" } });
    const toHello = (v: CapabilityVerdict): HelloShape => (v.available ? { available: true, apiVersion: v.apiVersion, features: v.features, maxConcurrent: v.limits.maxConcurrent } : { available: false, reason: v.reason, missing: v.missing });
    const hellos: Array<Promise<unknown>> = [];
    const prober = createCapabilityProber({ bus, clock: env.clock, report: (v) => void hellos.push(link.hello(toHello(v))) });
    expect(await prober.probe("session_start")).toMatchObject({ available: false, reason: "no_context" });
    await Promise.all(hellos);
    const refused = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    expect(refused).toMatchObject({ ok: false, error: "mode_unavailable" });
    expect(refused.message).toContain("no_context");
    double.setAnswer(validCapabilities()); // the extension has its context now
    prober.onEmptyReply(); // the next trigger
    await Promise.resolve();
    await Promise.all(hellos);
    expect((await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).ok).toBe(true);
  });

  it("the `no_context` verdict carries no install hint of an outdated package", () => {
    expect(evaluateCapabilities({ reason: "no_context" })).toMatchObject({ available: false, reason: "no_context", missing: [] });
  });
});
