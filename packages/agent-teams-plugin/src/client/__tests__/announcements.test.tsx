// @vitest-environment jsdom
/**
 * The polite live region (test-plan S91) inside the real Team view: the
 * `aria-live="polite"` node exists before the first change, the first snapshot is
 * the baseline, at most one summary per 4 s, never message text, task titles or the
 * team name; peer-authored payloads stay literal (S61). See change: add-agent-teams-ui.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, type Mounted, mountView } from "./team-view-harness.js";
import { mail, member, snap, task } from "./view-fixtures.js";

let m: Mounted | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  m?.unmount();
  m = undefined;
  cleanup();
  vi.useRealTimers();
});

const region = () => screen.getByTestId("team-live-region");
const SECRET = "SECRET-7f3a";
const base = (rev: number, over: Parameters<typeof snap>[0] = {}) =>
  snap({ rev, name: `${SECRET} team`, members: [member("alice", "idle")], tasks: [task("3", "in_progress", { title: `${SECRET} title`, owner: "alice" })], mail: [mail(1, { text: `${SECRET} mail text` })], ...over });

describe("live region (S91)", () => {
  it("exists in the DOM before the first change, in every state, polite and atomic", async () => {
    m = await mountView(undefined);
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().getAttribute("aria-atomic")).toBe("true");
    expect(region().textContent).toBe("");
    m.unmount();
    cleanup();
    m = await mountView(base(1));
    expect(region().textContent).toBe(""); // baseline announces nothing
  });

  it("announces a change with ids and statuses only — never message text, titles or the team name", async () => {
    m = await mountView(base(1));
    m.server.snapshot = base(2, { members: [member("alice", "busy")], tasks: [task("3", "completed", { title: `${SECRET} title` })] });
    m.store.signalReconnect();
    await flush(600);
    expect(region().textContent).toBe("alice is now working. Task 3 completed");
    expect(region().textContent).not.toContain(SECRET);
  });

  it("at most one announcement per 4 s under a burst of changes", async () => {
    m = await mountView(base(1));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(region().textContent ?? ""));
    observer.observe(region(), { childList: true, characterData: true, subtree: true });
    const flip = ["busy", "idle", "busy", "idle", "busy", "idle", "busy", "idle", "busy", "idle"] as const;
    for (let i = 0; i < flip.length; i++) {
      (m as Mounted).server.snapshot = base(2 + i, { members: [member("alice", flip[i] as "busy" | "idle")] });
      (m as Mounted).store.signalReconnect();
      await flush(200); // 10 changes in 2 s
    }
    await flush(1000);
    await new Promise<void>((r) => queueMicrotask(r));
    expect(seen.length).toBeLessThanOrEqual(1); // within the first 4 s: the leading summary only
    await flush(3000);
    await new Promise<void>((r) => queueMicrotask(r));
    expect(seen.length).toBeLessThanOrEqual(2); // + the trailing flush at 4 s
    for (const text of seen) expect(text).not.toContain(SECRET);
    observer.disconnect();
  });

  it("team closed is announced once", async () => {
    m = await mountView(base(1));
    m.server.snapshot = base(2, { status: "closed" });
    m.store.signalReconnect();
    await flush(600);
    expect(region().textContent).toBe("Team closed");
  });
});

describe("peer-authored payloads stay literal across the whole view (S61)", () => {
  it("team name, member name/role/model/cwd, task, mail and degraded strings render as text; announcements carry ids only", async () => {
    const evil = "<img src=x onerror=alert(1)> **bold** [x](javascript:alert(1)) https://evil.example/ &lt;b&gt;";
    const s = (rev: number, status: "idle" | "busy") =>
      snap({
        rev,
        name: evil,
        members: [member("alice", status, { role: evil, model: evil, cwd: evil, degraded: evil, sessionId: "S-a" })],
        tasks: [task("1", "pending", { title: evil, description: evil, result: evil, owner: evil })],
        mail: [mail(1, { text: evil, from: evil, to: evil })],
      });
    m = await mountView(s(1, "idle"));
    m.server.snapshot = s(2, "busy");
    m.store.signalReconnect();
    await flush(600);
    const root = screen.getByTestId("team-root");
    expect(root.textContent).toContain(evil);
    expect(root.querySelector("img,script,b,strong,em")).toBeNull();
    expect(root.querySelector('a[href^="javascript"],a[href^="http"]')).toBeNull();
    expect(region().textContent).toBe("alice is now working");
  });
});
