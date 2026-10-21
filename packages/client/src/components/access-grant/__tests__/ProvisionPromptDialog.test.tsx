/**
 * Provisioning dialog (change: add-access-provisioning, tasks 3.2, 3.3, 3.6, 3.7;
 * test-plan rows E24, E25, F6 hand-off wiring).
 */
import type {
  ProvisionLineClassification,
  ProvisionRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvisionPromptDialog } from "../ProvisionPromptDialog.js";

// Lazy hand-off target: a stub that records the props it was opened with.
const raProps = vi.fn();
vi.mock("../../remote-access/RemoteAccessDialog.js", () => ({
  RemoteAccessDialog: (props: { onClose: () => void; initialRun?: unknown }) => {
    raProps(props);
    return (
      <div data-testid="ra-dialog-stub">
        <button type="button" data-testid="ra-close" onClick={props.onClose}>
          close
        </button>
      </div>
    );
  },
}));

const NOW = 1_000_000;
const CLASSES: ProvisionLineClassification[] = [
  "grantable",
  "in-root",
  "covered",
  "forbidden",
  "sensitive",
  "missing",
  "invalid",
];

function makeRequest(over: Partial<ProvisionRequestMessage> = {}): ProvisionRequestMessage {
  return {
    type: "provision_request",
    requestId: "r1",
    projectRoot: "/w/app",
    lines: CLASSES.map((c, i) => ({
      lineId: `l${i}`,
      path: `/w/${c}`,
      why: `because ${c}`,
      classification: c,
    })),
    remote: ["lan"],
    expiresAt: NOW + 9 * 60_000,
    ...over,
  };
}

function open(request = makeRequest(), onAnswer = vi.fn(), queued = 0) {
  render(<ProvisionPromptDialog request={request} now={NOW} queued={queued} onAnswer={onAnswer} />);
  return { onAnswer, dialog: screen.getByTestId("provision-dialog") };
}

beforeEach(() => {
  raProps.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProvisionPromptDialog line controls (E24)", () => {
  it("offers an approve control only on grantable lines, none checked", () => {
    const { dialog } = open();
    const boxes = within(dialog).getAllByRole("checkbox", { name: /^Approve / });
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute("aria-label")).toBe("Approve /w/grantable");
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("provision-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(CLASSES.filter((c) => c !== "grantable"))("shows reason text and no control on a %s line", (cls) => {
    const { dialog } = open();
    const line = within(dialog)
      .getAllByTestId("provision-line")
      .find((el) => el.getAttribute("data-class") === cls) as HTMLElement;
    expect(line.querySelector("input[type=checkbox]")).toBeNull();
    expect(within(line).getByTestId("provision-line-class").textContent?.length).toBeGreaterThan(8);
    expect(within(line).getByTestId("provision-line-reason").textContent).toContain(`because ${cls}`);
  });

  it("shows 'no reason given' for an absent reason and marks a 200-char cut", () => {
    const cut = `${"x".repeat(200)}…`;
    const { dialog } = open(
      makeRequest({
        lines: [
          { lineId: "a", path: "/w/a", why: "no reason given", classification: "grantable" },
          { lineId: "b", path: "/w/b", why: cut, classification: "grantable" },
        ],
        remote: [],
      }),
    );
    const [a, b] = within(dialog).getAllByTestId("provision-line");
    expect(within(a).getByTestId("provision-line-reason").textContent).toContain("no reason given");
    expect(within(b).getByTestId("provision-line-cut")).toBeTruthy();
  });

  it("renders reason markup as literal text", () => {
    const why = "<script>alert(1)</script>";
    const { dialog } = open(
      makeRequest({ lines: [{ lineId: "a", path: "/w/a", why, classification: "grantable" }], remote: [] }),
    );
    expect(within(dialog).getByTestId("provision-line-reason").textContent).toContain(why);
    expect(dialog.querySelector("script")).toBeNull();
  });

  it("names the remote task and offers 'Open Remote access' for the lan goal", () => {
    const { dialog } = open();
    const goal = within(dialog).getByTestId("provision-goal");
    expect(goal.getAttribute("data-goal")).toBe("lan");
    expect(goal.textContent).toContain("Allow devices on my network");
    expect(within(goal).getByRole("button", { name: /Open Remote access/ })).toBeTruthy();
  });

  it("names the task for each goal", () => {
    const { dialog } = open(makeRequest({ lines: [], remote: ["internet", "device"] }));
    const text = within(dialog).getByTestId("provision-goals").textContent;
    expect(text).toContain("Share over the internet");
    expect(text).toContain("Let a phone or laptop in");
  });
});

describe("ProvisionPromptDialog copy and focus (E25)", () => {
  it("states the reach, the claim wording and the consent-not-protection line", () => {
    const { dialog } = open();
    expect(within(dialog).getByTestId("provision-consequence").textContent).toContain(
      "readable and writable by every session on this machine",
    );
    const claim = within(dialog).getByTestId("provision-claim");
    expect(claim.textContent).toContain("requested for");
    expect(claim.textContent).toContain("/w/app");
    expect(claim.textContent).toContain("requester's claim");
    expect(within(dialog).getByTestId("provision-consent").textContent).toContain("consent");
    expect(within(dialog).getByTestId("provision-consent").textContent).toContain("does not protect");
  });

  it("is a labelled modal dialog and focuses the built-in close, not an answer", () => {
    const { dialog } = open();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Allow folders for this project?");
    expect(document.activeElement).toBe(screen.getByTestId("provision-dialog-close"));
    for (const id of ["provision-approve", "provision-reject-all"]) {
      expect(document.activeElement).not.toBe(screen.getByTestId(id));
    }
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("gives both footer answers the same neutral style (none emphasised)", () => {
    open();
    const cls = (id: string) => screen.getByTestId(id).className;
    expect(cls("provision-approve")).not.toContain("bg-[var(--accent-solid)]");
    expect(cls("provision-reject-all")).not.toContain("bg-[var(--accent-solid)]");
  });

  it("uses the remote-only title and a Dismiss button when there are no folders", () => {
    const { dialog } = open(makeRequest({ lines: [], remote: ["lan"] }));
    expect(dialog.getAttribute("aria-label")).toBe("Open Remote access for this project?");
    expect(screen.queryByTestId("provision-approve")).toBeNull();
    expect(screen.getByTestId("provision-reject-all").textContent).toBe("Dismiss");
  });

  it("shows the queued count", () => {
    open(makeRequest(), vi.fn(), 2);
    expect(screen.getByTestId("provision-queued").textContent).toContain("2");
  });
});

describe("ProvisionPromptDialog answers (3.2)", () => {
  const grantable = () =>
    makeRequest({
      lines: [
        { lineId: "a", path: "/w/a", why: "x", classification: "grantable" },
        { lineId: "b", path: "/w/b", why: "x", classification: "grantable", projectRoot: true },
        { lineId: "c", path: "/w/c", why: "x", classification: "grantable" },
        { lineId: "d", path: "/w/d", why: "x", classification: "covered" },
      ],
      remote: [],
    });

  it("approves only the ticked lines, enabling the button and counting them", () => {
    const { onAnswer } = open(grantable());
    fireEvent.click(screen.getByLabelText("Approve /w/a"));
    expect(screen.getByTestId("provision-selected-count").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("provision-approve"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith([
      { lineId: "a", verdict: "approve" },
      { lineId: "b", verdict: "reject" },
      { lineId: "c", verdict: "reject" },
      { lineId: "d", verdict: "reject" },
    ]);
  });

  it("carries the pi-trust choice (default unchecked) only for an approved project-root line", () => {
    const { onAnswer } = open(grantable());
    expect(screen.getAllByTestId(/^provision-pi-trust-/).filter((e) => e.tagName === "INPUT")).toHaveLength(1);
    const trust = screen.getByTestId("provision-pi-trust-b") as HTMLInputElement;
    expect(trust.checked).toBe(false);
    fireEvent.click(trust);
    fireEvent.click(screen.getByLabelText("Approve /w/b"));
    fireEvent.click(screen.getByTestId("provision-approve"));
    expect(onAnswer.mock.calls[0][0]).toContainEqual({ lineId: "b", verdict: "approve", piTrust: true });
  });

  it("a trust choice on an unticked line is not sent", () => {
    const { onAnswer } = open(grantable());
    fireEvent.click(screen.getByTestId("provision-pi-trust-b"));
    fireEvent.click(screen.getByLabelText("Approve /w/a"));
    fireEvent.click(screen.getByTestId("provision-approve"));
    const b = onAnswer.mock.calls[0][0].find((l: { lineId: string }) => l.lineId === "b");
    expect(b).toEqual({ lineId: "b", verdict: "reject" });
  });

  it("an approved project-root line with the box untouched sends the explicit piTrust:false", () => {
    const { onAnswer } = open(grantable());
    fireEvent.click(screen.getByLabelText("Approve /w/b"));
    fireEvent.click(screen.getByTestId("provision-approve"));
    expect(onAnswer.mock.calls[0][0]).toContainEqual({ lineId: "b", verdict: "approve", piTrust: false });
  });

  it("Select all ticks every grantable line (never the others) and can be cleared", () => {
    open(grantable());
    const all = screen.getByTestId("provision-select-all");
    fireEvent.click(all);
    expect(screen.getByTestId("provision-selected-count").textContent).toContain("3");
    expect(all.textContent).toContain("Clear");
    fireEvent.click(all);
    expect(screen.getByTestId("provision-selected-count").textContent).toContain("0");
  });

  it("Reject all sends every line rejected", () => {
    const { onAnswer } = open(grantable());
    fireEvent.click(screen.getByLabelText("Approve /w/a"));
    fireEvent.click(screen.getByTestId("provision-reject-all"));
    expect(onAnswer).toHaveBeenCalledWith([
      { lineId: "a", verdict: "reject" },
      { lineId: "b", verdict: "reject" },
      { lineId: "c", verdict: "reject" },
      { lineId: "d", verdict: "reject" },
    ]);
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["the close button", () => fireEvent.click(screen.getByTestId("provision-dialog-close"))],
    ["the backdrop", () => fireEvent.click(screen.getByTestId("provision-dialog-overlay"))],
  ])("dismissing via %s rejects every line", (_name, dismiss) => {
    const { onAnswer } = open(grantable());
    fireEvent.click(screen.getByLabelText("Approve /w/a"));
    dismiss();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0].every((l: { verdict: string }) => l.verdict === "reject")).toBe(true);
  });
});

describe("ProvisionPromptDialog remote hand-off (3.3)", () => {
  it("opens RemoteAccessDialog on its landing (no initialRun) and marks the goal handed off", async () => {
    const { onAnswer } = open(makeRequest({ lines: [], remote: ["lan"] }));
    fireEvent.click(screen.getByRole("button", { name: /Open Remote access/ }));
    await screen.findByTestId("ra-dialog-stub");
    const props = raProps.mock.calls[0][0];
    expect(props.initialRun ?? null).toBeNull();
    expect(screen.getByTestId("provision-goal-opened").textContent).toContain("Remote access opened");
    // Opening the wizard answers nothing.
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ra-close"));
    await waitFor(() => expect(screen.queryByTestId("ra-dialog-stub")).toBeNull());
    expect(screen.getByTestId("provision-dialog")).toBeTruthy();
  });
});
