/**
 * YOLO on the session surface when the sidebar header is NOT rendered
 * (change: add-access-grant-dialog, task 8b.7; test-plan row 10.71 / #F5).
 * Mobile layout: SessionHeader renders alone, no SessionList, no pill.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { installFakeYoloServer, scopedSession, view } from "../access-grant/__tests__/yolo-test-server.js";
import { SessionHeader } from "../session/SessionHeader.js";

let mobile = true;
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));

const NOW = Date.now();
const session = (cwd: string) =>
  ({ id: "s1", status: "idle", cwd, startedAt: NOW - 60_000 }) as DashboardSession;

beforeEach(() => {
  const server = installFakeYoloServer({ now: NOW, session: scopedSession(NOW, "/repo") });
  yoloStatus.publish(view(server).yolo);
});
afterEach(() => cleanup());

describe("SessionHeader YOLO indicator", () => {
  it.each([true, false])("mobile=%s: in-scope session shows active YOLO + remaining time, no sidebar present", (m) => {
    mobile = m;
    render(<SessionHeader session={session("/repo/pkg")} state={createInitialState()} mobileActions={{}} />);
    expect(screen.queryByTestId("header-app-bar")).toBeNull();
    expect(screen.queryByTestId("yolo-pill")).toBeNull();
    expect(screen.getByTestId("yolo-session-indicator").textContent).toMatch(/YOLO.*\d+:\d\d left/);
  });

  it("an out-of-scope session shows no indicator", () => {
    mobile = true;
    render(<SessionHeader session={session("/repo-secrets")} state={createInitialState()} mobileActions={{}} />);
    expect(screen.queryByTestId("yolo-session-indicator")).toBeNull();
  });
});
