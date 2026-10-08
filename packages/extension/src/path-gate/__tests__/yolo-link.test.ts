import { describe, expect, it } from "vitest";
import { createYoloLink } from "../yolo-link.js";

const make = () => {
  const frames: any[] = [];
  const link = createYoloLink({ send: (m) => (frames.push(m), true), sessionId: () => "S1", newId: () => "r1", timeoutMs: 20 });
  return { link, frames };
};

describe("yolo link (change: yolo-covers-agent-path-gate)", () => {
  it("#E37 supported only when features contains path-yolo", () => {
    const { link } = make();
    expect(link.supported()).toBe(false);
    link.handleIdentity({ features: "path-yolo" });
    expect(link.supported()).toBe(false);
    link.handleIdentity({ features: ["path-yolo"] });
    expect(link.supported()).toBe(true);
    link.handleIdentity({});
    expect(link.supported()).toBe(false);
  });

  it("sends a bound frame and resolves on the matching result", async () => {
    const { link, frames } = make();
    link.handleIdentity({ features: ["path-yolo"] });
    const p = link.ask({ path: "/o/a", access: "w", tool: "write" });
    expect(frames[0]).toEqual({ type: "path_yolo_request", requestId: "r1", sessionId: "S1", path: "/o/a", access: "w", tool: "write" });
    link.handleResult({ requestId: "r1", verdict: "auto-allow" });
    expect(await p).toBe("auto-allow");
  });

  it("#X4 reset declines the pending ask, drops support and stops sending", async () => {
    const { link, frames } = make();
    link.handleIdentity({ features: ["path-yolo"] });
    const p = link.ask({ path: "/o/a", access: "r", tool: "read" });
    link.reset();
    expect(await p).toBe("decline");
    expect(link.supported()).toBe(false);
    frames.length = 0;
    expect(await link.ask({ path: "/o/a", access: "r", tool: "read" })).toBe("decline");
    expect(frames).toHaveLength(0);
  });

  it("an unknown verdict or timeout declines", async () => {
    const { link } = make();
    link.handleIdentity({ features: ["path-yolo"] });
    const p = link.ask({ path: "/o/a", access: "r", tool: "read" });
    link.handleResult({ requestId: "r1", verdict: "weird" });
    expect(await p).toBe("decline");
    expect(await link.ask({ path: "/o/a", access: "r", tool: "read" })).toBe("decline"); // timeout
  });
});
