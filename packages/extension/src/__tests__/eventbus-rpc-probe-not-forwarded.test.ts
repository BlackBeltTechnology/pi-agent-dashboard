/**
 * RPC probes on the pi EventBus must never reach the dashboard event store.
 *
 * A probe is `emit("flow:list-flows", probe)` followed by a read of
 * `probe.flows`: the emitter hands a mutable object to a handler and reads the
 * answer back. Forwarded, it showed up as a `rawEvent` chat row. The old emit
 * wrapper forwarded every emission; forwarding is now ONE `pi.events.on`
 * subscription per DECLARED channel (`registerEventBusForwarding`), so a probe
 * is only forwarded if someone maps its channel. This suite pins that:
 *  - behaviour: probes round-trip through the bus and are never sent;
 *  - source guards: nobody re-wraps `emit`, adds an `extraMaps` argument, or
 *    widens `EVENT_BUS_MAP` in `bridge.ts`. Each guard is a pure function run
 *    against the real source AND an inline mutant, so it cannot pass vacuously.
 *
 * @structural-pin bridge.ts cannot be instantiated in a test, so the source guards pin its text: EVENT_BUS_MAP shape, the registerEventBusForwarding call arity and the absence of an emit rebinding.
 *
 * See change: skip-rpc-probes-in-event-forwarder.
 */
import { describe, expect, it } from "vitest";
import { forwardedBusChannels, registerEventBusForwarding } from "../flow-event-wiring.js";
import { type BridgeSourceFile, readBridgeSource } from "./helpers/bridge-source.js";
import { makeDeps, makeHost } from "./helpers/event-bus-host.js";

/** Every known request/response probe channel on the bus. */
const RPC_PROBE_CHANNELS = [
  "flow:list-flows",
  "flow:get-agents",
  "flow:get-available-models",
  "model:resolve",
  "role:resolve-model",
  "roles:get-all",
  "roles:set",
  "roles:remove",
  "roles:preset-load",
  "roles:preset-save",
  "roles:preset-delete",
  "ui:list-modules",
  // pi-flows agent-extension announce (payload carries a function).
  "flow:register-agent-extension",
] as const;

/** Source text with `//` and block comments removed; string literals are kept intact. */
function stripComments(src: string): string {
  return src.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, str: string | undefined) => str ?? "",
  );
}

/** `EVENT_BUS_MAP` in `bridge.ts` must be exactly `{ ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP }`. */
function assertEventBusMapPinned(src: string): void {
  const m = /const EVENT_BUS_MAP\s*:\s*Record<string,\s*string>\s*=\s*\{([^}]*)\}/.exec(stripComments(src));
  if (!m) throw new Error("EVENT_BUS_MAP literal not found in bridge.ts");
  const body = m[1].replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
  if (body !== "...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP") {
    throw new Error(`EVENT_BUS_MAP must be exactly { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP }, found { ${body} }`);
  }
}

/** Index of the closing quote of the string literal opened at `i`. */
function endOfString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  for (; j < src.length && src[j] !== quote; j++) if (src[j] === "\\") j++;
  return j;
}

const isQuote = (c: string) => c === '"' || c === "'" || c === "`";
const OPENERS = "([{";
const CLOSERS = ")]}";

/** Index of the `)` closing the call whose `(` is at `open`, skipping string literals. */
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (isQuote(c)) i = endOfString(src, i);
    else if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c) && --depth === 0) return i;
  }
  throw new Error("unbalanced call");
}

/** Top-level, non-empty argument texts of a call's inner source (string-literal aware). */
function topLevelArgs(inner: string): string[] {
  const args: string[] = [""];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (isQuote(c)) {
      const end = endOfString(inner, i);
      args[args.length - 1] += inner.slice(i, end + 1);
      i = end;
    } else if (c === "," && depth === 0) {
      args.push("");
    } else {
      if (OPENERS.includes(c)) depth++;
      else if (CLOSERS.includes(c)) depth--;
      args[args.length - 1] += c;
    }
  }
  return args.filter((a) => a.trim() !== "");
}

/** Top-level argument count of each `registerEventBusForwarding(` call (balanced-paren scan). */
function countForwardingCallArgs(src: string): number[] {
  const counts: number[] = [];
  const re = /\bregisterEventBusForwarding\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    counts.push(topLevelArgs(src.slice(open + 1, closingParen(src, open))).length);
  }
  return counts;
}

/** Hits where code reassigns / redefines an `emit` function (the historical wrapper form). */
function findEmitRebinding(src: string): string[] {
  const code = stripComments(src);
  const patterns = [
    /(?:\.\s*emit|\[\s*["'`]emit["'`]\s*\])\s*=(?![=>])/g,
    /Object\.defineProperty\(\s*[^,]*\bevents\b[^,]*,\s*["'`]emit["'`]/g,
    /Object\.assign\(\s*[^,]*\bevents\b[^,]*,\s*\{[^}]*\bemit\b\s*:/g,
  ];
  return patterns.flatMap((re) => code.match(re) ?? []);
}

describe("RPC probes are not forwarded (static set)", () => {
  it("E1: no probe channel is a forwarded channel; real channels still are", () => {
    const channels = forwardedBusChannels();
    for (const probe of RPC_PROBE_CHANNELS) expect(channels, probe).not.toContain(probe);
    expect(channels).toContain("flow:complete");
    expect(channels).toContain("subagents:completed");
  });
});

describe("RPC probes are not forwarded (two-facade bus)", () => {
  it("E2: the flows plugin bridge's flow-list probe (a foreign facade) is answered but not forwarded", () => {
    // The dashboard bridge no longer probes pi-flows; the flows plugin bridge
    // does (`packages/flows-plugin/src/bridge/flow-probe.ts`), from its own
    // facade, and pi-flows answers it. See change: flows-dock-chip-and-panel-actions.
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    host.foreignEvents.on("flow:list-flows", (d) => {
      (d as { flows?: unknown }).flows = [{ name: "x" }];
    });

    const probe: { flows?: unknown } = {};
    host.foreignEvents.emit("flow:list-flows", probe);
    host.foreignEvents.emit("flow:complete", { status: "success" });

    expect(probe.flows).toEqual([{ name: "x" }]);
    expect(sent.map((s) => s.channel)).toEqual(["flow:complete"]);
  });

  it("E3: a probe emitted by a foreign facade is answered but not forwarded", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    host.bridgeEvents.on("roles:get-all", (d) => {
      (d as { roles?: unknown }).roles = { fast: "a/b" };
    });

    const probe: { roles?: unknown } = {};
    host.foreignEvents.emit("roles:get-all", probe);

    expect(probe.roles).toEqual({ fast: "a/b" });
    expect(sent).toHaveLength(0);
  });

  it("E4: every known probe channel is answered and never forwarded, from either facade", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    for (const channel of RPC_PROBE_CHANNELS) {
      host.foreignEvents.on(channel, (d) => {
        (d as { filled?: string }).filled = channel;
      });
    }

    for (const facade of [host.foreignEvents, host.bridgeEvents]) {
      for (const channel of RPC_PROBE_CHANNELS) {
        const probe: { filled?: string } = {};
        facade.emit(channel, probe);
        expect(probe.filled, channel).toBe(channel);
      }
    }
    expect(sent).toHaveLength(0);
  });

  it("E5: only the mapped flow:* channels are forwarded", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.foreignEvents.emit("flow:run", { flowName: "f" });
    host.foreignEvents.emit("flow:agent-error", { agentName: "a" });

    expect(sent.map((s) => s.channel)).toEqual(["flow:agent-error"]);
  });

  it("X1: an async probe handler fills after a flush and is still not forwarded", async () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    // The host's `on` handler type returns void, so the async fill is scheduled on the microtask queue, not awaited.
    host.foreignEvents.on("model:resolve", (d) => {
      queueMicrotask(() => {
        (d as { auth?: unknown }).auth = { ok: true };
      });
    });

    const probe: { auth?: unknown } = {};
    host.foreignEvents.emit("model:resolve", probe);
    expect(sent).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));

    expect(probe.auth).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });
});

describe("source guards over bridge code", () => {
  const BRIDGE_FILES: BridgeSourceFile[] = [
    "bridge.ts",
    "bridge-handlers/lifecycle.ts",
    "bridge-handlers/dispatch.ts",
    "bridge-handlers/forwarders.ts",
    "bridge-handlers/ui-prompt-patch.ts",
    "bridge-handlers/instance.ts",
  ];

  it("E6: EVENT_BUS_MAP is exactly the flow + subagent maps", () => {
    const src = readBridgeSource("bridge.ts");
    expect(() => assertEventBusMapPinned(src)).not.toThrow();

    const mutant = src.replace(
      /(const EVENT_BUS_MAP\s*:\s*Record<string,\s*string>\s*=\s*\{)/,
      '$1 "roles:get-all": "x",',
    );
    expect(mutant).not.toBe(src);
    expect(() => assertEventBusMapPinned(mutant)).toThrow(/EVENT_BUS_MAP/);
  });

  it("E7: registerEventBusForwarding is called once with two arguments (no extraMaps)", () => {
    const src = stripComments(readBridgeSource("bridge.ts"));
    expect(countForwardingCallArgs(src)).toEqual([2]);

    const open = src.search(/\bregisterEventBusForwarding\(/) + "registerEventBusForwarding".length;
    const close = closingParen(src, open);
    const mutant = `${src.slice(0, close).replace(/,?\s*$/, "")}, [{ "flow:list-flows": "x" }]${src.slice(close)}`;
    expect(countForwardingCallArgs(mutant)).toEqual([3]);
  });

  it("E8: nothing in bridge code rebinds `emit`", () => {
    for (const file of BRIDGE_FILES) {
      expect(findEmitRebinding(readBridgeSource(file)), file).toEqual([]);
    }

    const mutants = [
      "pi.events.emit = (c, d) => {};",
      "pi.events!.emit = f;",
      'pi.events["emit"] = f;',
      'Object.defineProperty(pi.events, "emit", {});',
      "Object.assign(pi.events, { emit: f });",
    ];
    for (const m of mutants) expect(findEmitRebinding(m).length, m).toBeGreaterThanOrEqual(1);

    const clean = ['pi.events.emit("x", y);', "const same = a.emit === b;", "// pi.events.emit = old"];
    for (const c of clean) expect(findEmitRebinding(c), c).toEqual([]);
  });
});
