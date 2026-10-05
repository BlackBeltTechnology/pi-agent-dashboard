import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  countNeedsYou,
  countStatusCapsule,
  deriveStatusShape,
  getCardPulseClass,
  isChatRoutedAskUser,
} from "../session-status-visuals.js";

const s = (over: Partial<DashboardSession>): DashboardSession => ({ id: "x", status: "streaming", ...over }) as DashboardSession;

describe("awaitingFileAccess counts as needs-you without touching currentTool (#F5)", () => {
  const gated = s({ id: "A", currentTool: "read", awaitingFileAccess: true });

  it("is blocked-on-you even with an in-flight tool and never widget-bar-excluded", () => {
    expect(isChatRoutedAskUser(gated, true)).toBe(true);
    expect(deriveStatusShape(gated)).toBe("needs-you");
    expect(getCardPulseClass(gated)).toBe("card-input-stripes");
    expect(gated.currentTool).toBe("read");
  });

  it("rolls up in the folder counts", () => {
    expect(countNeedsYou([gated, s({ id: "B" })])).toBe(1);
    const caps = countStatusCapsule([gated, s({ id: "B", currentTool: "bash" })]);
    expect(caps.needsYou).toBe(1);
    expect(caps.firstIds.needsYou).toBe("A");
  });

  it("stops counting once settled (flag false), tool display unchanged", () => {
    const settled = { ...gated, awaitingFileAccess: false };
    expect(isChatRoutedAskUser(settled)).toBe(false);
    expect(countNeedsYou([settled])).toBe(0);
  });

  it("an ended session never needs you; an errored one stays in the error bucket", () => {
    expect(isChatRoutedAskUser({ ...gated, status: "ended" })).toBe(false);
    expect(countStatusCapsule([gated], { errorSessionIds: new Set(["A"]) }).error).toBe(1);
  });
});
