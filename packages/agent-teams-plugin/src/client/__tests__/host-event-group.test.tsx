// @vitest-environment jsdom
/**
 * Accepted host behaviour (test-plan S88, design D5): a user who hides the host's
 * `other` custom-event group hides every mail card via the host gate, while the Team
 * view's message log still lists all mail. See change: add-agent-teams-ui.
 */
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMail } from "../../shared/mail-format.js";
import { MessageLog } from "../MessageLog.js";
import { hostRows, rowOf } from "./host-row.js";
import { mail, member, snap } from "./view-fixtures.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("hidden `other` event group (S88)", () => {
  const rows = [rowOf(formatMail({ kind: "message", sender: "bob", text: "one" })), rowOf(formatMail({ kind: "shutdown_request", sender: "lead", text: "two" }))].map((r, i) => ({ ...r, id: `r${i}` }));

  it("visible by default", () => {
    hostRows(rows);
    expect(screen.getAllByTestId("team-mail-card")).toHaveLength(2);
  });

  it("hiding `other` hides every mail card in chat; the Team view log still lists all mail", () => {
    const prefs = { ...DISPLAY_PRESETS.standard, customEventGroups: { ...DISPLAY_PRESETS.standard.customEventGroups, other: false } };
    hostRows(rows, { prefs });
    expect(screen.queryByTestId("team-mail-card")).toBeNull();
    expect(screen.queryByTestId("custom-entry-card")).toBeNull();
    cleanup();
    render(<MessageLog snap={snap({ members: [member("bob")], mail: [mail(1, { from: "bob", text: "one" }), mail(2, { from: "lead", to: "bob", kind: "shutdown_request", text: "two" })], mailTotal: 2 })} />);
    expect(screen.getAllByTestId("team-mail-row")).toHaveLength(2);
  });
});
