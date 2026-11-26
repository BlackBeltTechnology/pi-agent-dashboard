// @vitest-environment jsdom
/**
 * The `data-testid` contract of change 5 (test-plan S121, task 8.4): ids exist, carry
 * the member status in `data-status`, and do not depend on i18n text.
 * See change: add-agent-teams-ui.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Mounted, mountView } from "./team-view-harness.js";
import { member, snap } from "./view-fixtures.js";

let m: Mounted | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  m?.unmount();
  m = undefined;
  cleanup();
  vi.useRealTimers();
});

const STATUSES = ["spawning", "idle", "busy", "shutdown_pending", "disconnected", "gone", "failed"] as const;

describe("test-id contract (S121)", () => {
  it("team-member-open-subagent, team-member-status (+ data-status), team-header-mode, team-header-parallel", async () => {
    m = await mountView(snap({ mode: "worktree", members: STATUSES.map((s) => member(`m-${s}`, s, { sessionId: `S-${s}` })) }));
    expect(screen.getAllByTestId("team-member-open-subagent")).toHaveLength(STATUSES.length);
    const statuses = screen.getAllByTestId("team-member-status").map((n) => n.getAttribute("data-status"));
    expect(statuses).toEqual([...STATUSES]);
    expect(screen.getByTestId("team-header-mode")).toBeTruthy();
    expect(screen.getByTestId("team-header-parallel")).toBeTruthy();
  });

  it("the ids do not depend on the language", async () => {
    const run = async (language: string) => {
      const mounted = await mountView(snap({ members: [member("a", "busy", { sessionId: "S-a" })] }), {}, "S-lead", language);
      const out = {
        id: screen.getAllByTestId("team-member-status").map((n) => n.getAttribute("data-status")),
        parallel: screen.getByTestId("team-header-parallel").textContent,
        mode: screen.getByTestId("team-header-mode").textContent,
      };
      mounted.unmount();
      cleanup();
      return out;
    };
    const en = await run("en");
    const hu = await run("hu");
    const zh = await run("zh-CN");
    expect(hu.id).toEqual(en.id);
    expect(zh.id).toEqual(en.id);
    expect(hu.parallel).not.toBe(en.parallel); // translated text differs; ids do not
    expect(zh.mode).not.toBe(en.mode);
  });
});
