/**
 * Server handlers for the agent path gate's YOLO frames.
 * See change: yolo-covers-agent-path-gate — test-plan #E19–#E25.
 */
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createAgentConfirmRegistry } from "../agent-confirm-registry.js";
import { handlePathGateRefusal, handlePathYoloRequest, type YoloAgentVerdict } from "../agent-yolo.js";

function setup(verdict?: YoloAgentVerdict | "undef") {
  const registry = createAgentConfirmRegistry({ now: () => 1000 });
  const logs: string[] = [];
  const decide = vi.fn((_p: string): YoloAgentVerdict => (verdict === "undef" ? null : (verdict ?? null)));
  const recordRefusal = vi.fn();
  const deps = {
    decideAgentPath: verdict === "undef" ? undefined : decide,
    registry,
    recordRefusal,
    log: (l: string) => logs.push(l),
  };
  return { registry, logs, decide, recordRefusal, deps };
}
const yreq = (over: Record<string, unknown> = {}) =>
  ({ type: "path_yolo_request", requestId: "r1", sessionId: "A", path: "/o/x.txt", access: "w", tool: "write", ...over }) as never;
const rmsg = (over: Record<string, unknown> = {}) =>
  ({ type: "path_gate_refusal", sessionId: "A", promptId: "P", path: "/o/dir/a.txt", subject: "/o/dir", ...over }) as never;

describe("handlePathYoloRequest", () => {
  it("#E19 a body sessionId that is not the connection's declines without asking", () => {
    const { deps, decide } = setup("auto-allow");
    expect(handlePathYoloRequest("A", yreq({ sessionId: "B" }), deps).verdict).toBe("decline");
    expect(decide).not.toHaveBeenCalled();
  });

  it("#E20 malformed input declines and the log has no control characters", () => {
    const { deps, logs } = setup("auto-allow");
    for (const bad of [{ requestId: undefined }, { path: 42 }, { path: "rel/x\nFORGED" }]) {
      expect(handlePathYoloRequest("A", yreq(bad), deps).verdict).toBe("decline");
    }
    // eslint-disable-next-line no-control-regex
    expect(logs.every((l) => !/[\u0000-\u001f]/.test(l))).toBe(true);
  });

  it("#E21 maps controller verdicts; an unwired controller declines", () => {
    expect(handlePathYoloRequest("A", yreq(), setup("auto-allow").deps).verdict).toBe("auto-allow");
    expect(handlePathYoloRequest("A", yreq(), setup("refused-by-prior-refusal").deps).verdict).toBe("refused");
    expect(handlePathYoloRequest("A", yreq(), setup(null).deps).verdict).toBe("decline");
    expect(handlePathYoloRequest("A", yreq(), setup("undef").deps).verdict).toBe("decline");
  });
});

describe("handlePathGateRefusal", () => {
  const observe = (s: ReturnType<typeof setup>, path = "/o/dir/a.txt", subject = "/o/dir") =>
    s.registry.observe("A", "P", { path, subject }, "select");

  it("#E22 records the re-derived subject once for an observed select prompt", () => {
    const s = setup();
    observe(s);
    handlePathGateRefusal("A", rmsg(), s.deps);
    expect(s.recordRefusal).toHaveBeenCalledTimes(1);
    expect(s.recordRefusal).toHaveBeenCalledWith("agent-path", "/o/dir");
  });

  it("#E23 unobserved, replayed and session-mismatched reports record nothing extra", () => {
    const s = setup();
    handlePathGateRefusal("A", rmsg({ promptId: "nope" }), s.deps);
    expect(s.recordRefusal).not.toHaveBeenCalled();
    observe(s);
    handlePathGateRefusal("A", rmsg(), s.deps);
    handlePathGateRefusal("A", rmsg(), s.deps);
    expect(s.recordRefusal).toHaveBeenCalledTimes(1);
    const s2 = setup();
    observe(s2);
    handlePathGateRefusal("A", rmsg({ sessionId: "B" }), s2.deps);
    expect(s2.recordRefusal).not.toHaveBeenCalled();
  });

  it("#E24 a claimed subject that is an ancestor of the observed one is refused", () => {
    const s = setup();
    observe(s);
    handlePathGateRefusal("A", rmsg({ subject: "/o" }), s.deps);
    expect(s.recordRefusal).not.toHaveBeenCalled();
    expect(s.logs.some((l) => l.includes("cause=subject mismatch"))).toBe(true);
  });

  it("#E25 an ungrantable subject (the home) is still remembered", () => {
    const s = setup();
    const home = os.homedir();
    const file = `${home}/notes.txt`;
    observe(s, file, home);
    handlePathGateRefusal("A", rmsg({ path: file, subject: home }), s.deps);
    expect(s.recordRefusal).toHaveBeenCalledWith("agent-path", expect.any(String));
  });
});
