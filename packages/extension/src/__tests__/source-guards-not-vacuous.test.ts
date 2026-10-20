/**
 * The source-scanning guards that used to read `bridge.ts` must still find what they scan for,
 * in the module that now holds it (test-plan E8).
 *
 * A guard whose scan target no longer contains its pattern passes by default. Each row names a
 * guard test, the module it must now read, and a needle that must be present there; the guard's
 * own text must name that module, so a guard left pointing at `bridge.ts` is caught here.
 *
 * See change: test-trust-audit (design D3).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type BridgeSourceFile, readBridgeSource } from "./helpers/bridge-source.js";

const TESTS = import.meta.dirname;

/** [guard test file, module it reads now, needle that must live there, optional text the guard must contain]. */
const GUARDS: Array<[string, BridgeSourceFile, string, string?]> = [
  // Scans the whole bridge-handlers directory rather than one file.
  ["bridge-agent-settled-contract.test.ts", "bridge-handlers/forwarders.ts", "agent_settled", "bridge-handlers"],
  ["bridge-coalesced-chat-order.test.ts", "bridge-handlers/forwarders.ts", 'if (eventType === "message_start") {'],
  ["bridge-coalesced-chat-order.test.ts", "bridge-handlers/lifecycle.ts", "coalescer.clear();"],
  ["bridge-coalesced-chat-order.test.ts", "bridge.ts", "onReconnect: safe(() => {"],
  ["bridge-name-provenance.test.ts", "bridge-handlers/dispatch.ts", "applyAutoNameRestore(msg as any, autoNamer, pi.getSessionName())"],
  ["bridge-name-provenance.test.ts", "bridge-handlers/lifecycle.ts", "autoNamer = undefined;\n  namerState = undefined;\n  shared.namerState = undefined;"],
  ["bridge-polling.test.ts", "bridge-handlers/forwarders.ts", "scheduleModelRecheckOnSelect(setRegisteredTimeout, sendModelUpdateIfChanged)"],
  ["bridge-polling.test.ts", "bridge-handlers/dispatch.ts", "routeGitInfoRefresh(msg, { prStatus: prStatus, gitTracker: polling.gitTracker })"],
  ["bridge-polling.test.ts", "bridge-handlers/lifecycle.ts", "polling.replaceProcessScan(scheduler)"],
  ["command-handler.test.ts", "bridge.ts", "sessionPrompt: async (text, delivery, promptId) => {"],
  ["command-path-mapping.test.ts", "bridge-handlers/lifecycle.ts", "filterHiddenCommands("],
  ["eventbus-rpc-probe-not-forwarded.test.ts", "bridge.ts", "registerEventBusForwarding("],
  ["eventbus-rpc-probe-not-forwarded.test.ts", "bridge.ts", "const EVENT_BUS_MAP"],
  ["multiselect-dashboard-routing.test.ts", "bridge-handlers/ui-prompt-patch.ts", "(ctx.ui as any).multiselect ="],
  ["pi-version-tracker.test.ts", "bridge-handlers/forwarders.ts", "const passThroughEventTypes"],
  ["plugin-event-forwarding.test.ts", "bridge.ts", "pluginForwardRegistry.flush()"],
  ["session-register-carries-pid.test.ts", "bridge-handlers/lifecycle.ts", 'type: "session_register"'],
  ["terminal-reload.test.ts", "bridge-handlers/lifecycle.ts", "consumePendingReloadOnSessionStart("],
  ["usage-drain.test.ts", "bridge-handlers/lifecycle.ts", "usageDrain.baseline(ctx.sessionManager)"],
  ["usage-drain.test.ts", "bridge-handlers/forwarders.ts", "const enrichedEventTypes = ["],
];

describe("retargeted source guards are not vacuous (E8)", () => {
  it.each(GUARDS)("%s scans %s, which contains its needle", (guard, target, needle, marker) => {
    expect(readBridgeSource(target), `${target} should contain ${JSON.stringify(needle)}`).toContain(needle);
    const guardText = readFileSync(resolve(TESTS, guard), "utf8");
    expect(guardText, `${guard} should read ${target}`).toContain(marker ?? target.replace(/^bridge-handlers\//, "").replace(/\.ts$/, ""));
  });

  it("no guard in the table still reads bridge.ts for code that moved", () => {
    const MOVED_READERS = ["bridge-agent-settled-contract", "bridge-polling", "usage-drain", "terminal-reload", "session-register-carries-pid"];
    for (const name of MOVED_READERS) {
      const text = readFileSync(resolve(TESTS, `${name}.test.ts`), "utf8");
      expect(text, `${name} must not read the entry point for moved handlers`).not.toMatch(/readFileSync\([^)]*["']bridge\.ts["']/);
    }
  });
});
