/**
 * The session header carries no YOLO signal any more (change:
 * fix-yolo-indicator-overflow D1; test-plan #E18). The remaining time lives on
 * the composer strip.
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

describe("SessionHeader has no YOLO indicator", () => {
  it.each([true, false])("mobile=%s: in-scope session under live YOLO renders no YOLO element or text", (m) => {
    mobile = m;
    const { container } = render(
      <SessionHeader session={session("/repo/pkg")} state={createInitialState()} mobileActions={{}} />,
    );
    expect(screen.queryByTestId("yolo-session-indicator")).toBeNull();
    expect(screen.queryByTestId("yolo-pill")).toBeNull();
    expect(screen.queryByTestId("yolo-composer-strip")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/YOLO/);
  });
});
