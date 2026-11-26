// @vitest-environment jsdom
/**
 * Lazy mail card behaviour inside the REAL `CustomEntryRow` (test-plan S84 chunk
 * delay, S86 renderer failure): the host's generic card shows the body first, swaps
 * to the team card with no duplicate row and no blank frame; a throwing card lands
 * on the host fallback and leaves other rows alone.
 * See change: add-agent-teams-ui.
 */
import { lazyClaim } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMail } from "../../shared/mail-format.js";
import { hostRows, rowOf, teamRegistry } from "./host-row.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MAIL = formatMail({ kind: "message", sender: "bob", text: "hello from bob" });

describe("S84 — lazy chunk delayed 7 s", () => {
  it("the host generic card shows the body first, then swaps to the team card: one row, never blank", async () => {
    const real = await import("../MailEntryCard.js");
    const load = () => new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve(real as never), 7000));
    const Lazy = lazyClaim(load, "MailEntryCard");
    const view = hostRows([rowOf(MAIL)], { registry: teamRegistry(Lazy as never) });
    const frames: string[] = [];
    const snapshot = () => frames.push(view.container.textContent ?? "");

    snapshot();
    expect(screen.getByTestId("custom-entry-card").textContent).toContain("hello from bob"); // body visible while the chunk loads
    expect(screen.queryByTestId("team-mail-card")).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(6999)));
    snapshot();
    expect(screen.getByTestId("custom-entry-card")).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    snapshot();

    expect(screen.getByTestId("team-mail-card")).toBeTruthy();
    expect(screen.queryByTestId("custom-entry-card")).toBeNull(); // swapped, not duplicated
    expect(screen.getAllByRole("group")).toHaveLength(1);
    for (const f of frames) expect(f.trim()).not.toBe(""); // no blank frame
  });
});

describe("S86 — renderer failure", () => {
  it("a card that throws on a poisoned body lands on the host generic card; other rows are unaffected", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const POISON = formatMail({ kind: "message", sender: "bob", text: "POISON" });
    const Real = vi.fn();
    function Poisoned(props: { body: string } & Record<string, unknown>): ReactElement {
      if (props.body.includes("POISON")) throw new Error("card crash");
      Real();
      return <div data-testid="ok-card">ok</div>;
    }
    const rows = [rowOf(POISON), rowOf(MAIL)].map((r, i) => ({ ...r, id: `r${i}` }));
    hostRows(rows, { registry: teamRegistry(Poisoned as never) });
    const generic = screen.getAllByTestId("custom-entry-card");
    expect(generic).toHaveLength(1);
    expect(within(generic[0] as HTMLElement).getByText(/POISON/)).toBeTruthy();
    expect(screen.getByTestId("ok-card")).toBeTruthy();
  });
});
