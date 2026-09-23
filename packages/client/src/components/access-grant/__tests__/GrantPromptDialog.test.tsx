/**
 * S1/S2 grant dialog (change: add-access-grant-dialog, tasks 7.1, 7.2, 7.4,
 * 7.5; test-plan rows 10.61, 10.62, 10.62a, 10.63, 10.64, 10.65, 10.68, 10.70).
 */
import type {
  AccessPlaneId,
  GrantPromptCopy,
  GrantRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantPromptDialog } from "../GrantPromptDialog.js";

const NOW = 1_000_000;

const HELD = (store: string, ladder?: string[]): GrantPromptCopy => ({
  mode: "held",
  verdicts: ["allow-once", "allow-always", "deny"],
  store,
  ...(ladder ? { ladder: ladder.map((subject) => ({ subject })) } : {}),
});
const DEFERRED = (store: string): GrantPromptCopy => ({ mode: "deferred", verdicts: ["allow-always", "deny"], store });

function prompt(plane: AccessPlaneId, subject: string, copy: GrantPromptCopy): GrantRequestMessage {
  return { type: "grant_request", promptId: `p-${plane}`, plane, subject, expiresAt: NOW + 24_000, copy };
}

const PROMPTS = {
  filesystem: prompt("filesystem", "/Users/r/Documents/contracts", HELD("access-grants.json")),
  cwd: prompt("cwd", "/Users/r/Project/side", HELD("pinned directories")),
  network: prompt("network", "10.1.2.0/24", DEFERRED("config.trustedNetworks")),
  cors: prompt("cors", "https://app.example.com", DEFERRED("cors.allowedOrigins")),
};

function renderDialog(p: GrantRequestMessage, onAnswer = vi.fn(), queued = 0) {
  render(<GrantPromptDialog prompt={p} now={NOW} queued={queued} onAnswer={onAnswer} />);
  return { onAnswer, dialog: screen.getByTestId("grant-dialog") };
}

const verdictButtons = () =>
  ["grant-deny", "grant-allow-once", "grant-allow-always"]
    .map((id) => screen.queryByTestId(id))
    .filter((b): b is HTMLElement => b !== null);

afterEach(() => cleanup());

describe("GrantPromptDialog", () => {
  // 7.1 — plane-specific copy, subject as monospace headline, store named.
  it.each([
    ["filesystem", "Allow file access?", "filesystem"],
    ["cwd", "Allow this working directory?", "working directory"],
    ["network", "Allow this network?", "network"],
    ["cors", "Allow this origin?", "CORS origin"],
  ] as const)("renders %s copy: title, plane, subject headline, and store", (plane, title, planeLabel) => {
    const p = PROMPTS[plane];
    const { dialog } = renderDialog(p);
    expect(within(dialog).getByRole("heading", { name: title })).toBeTruthy();
    expect(within(dialog).getByTestId("grant-dialog-plane").textContent).toContain(planeLabel);
    const subject = within(dialog).getByTestId("grant-dialog-subject");
    expect(subject.textContent).toBe(p.subject);
    expect(subject.className).toContain("font-mono");
    expect(within(dialog).getByTestId("grant-dialog-consequence").textContent).toContain(p.copy.store);
  });

  // 10.61 / 10.62a (E42/E56) — nothing pre-selected, focus-defaulted or emphasised.
  it("focus-defaults, pre-selects and emphasises no answer", () => {
    renderDialog(PROMPTS.filesystem);
    const buttons = verdictButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons).not.toContain(document.activeElement);
    for (const b of buttons) {
      expect(b.getAttribute("aria-pressed")).toBeNull();
      expect(b.className).not.toContain("accent-primary");
    }
    const once = screen.getByTestId("grant-allow-once");
    const always = screen.getByTestId("grant-allow-always");
    expect(always.className).toBe(once.className);
  });

  it("orders Deny, Allow once, Allow always and states dismissal denies", () => {
    renderDialog(PROMPTS.filesystem);
    expect(verdictButtons().map((b) => b.dataset.testid)).toEqual([
      "grant-deny",
      "grant-allow-once",
      "grant-allow-always",
    ]);
    const [deny, once, always] = verdictButtons();
    expect(deny.compareDocumentPosition(once) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(once.compareDocumentPosition(always) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("grant-dialog-dismiss-note").textContent).toMatch(/Dismissing denies/);
  });

  // 7.2 — held pill with a live countdown.
  it("shows the held 'request waiting' pill with the time left", () => {
    renderDialog(PROMPTS.filesystem);
    expect(screen.getByTestId("grant-dialog-waiting").textContent).toMatch(/Request waiting.*24s left/);
    expect(screen.queryByTestId("grant-dialog-deferred")).toBeNull();
  });

  // 7.2 / 10.62 / 10.70 (E43/F4) — deferred: no allow-once in the DOM, later-attempt copy, no countdown.
  it.each(["network", "cors"] as const)("a deferred %s prompt omits allow-once and states it applies later", (plane) => {
    renderDialog(PROMPTS[plane]);
    expect(screen.queryByTestId("grant-allow-once")).toBeNull();
    expect(screen.queryByText("Allow once")).toBeNull();
    expect(verdictButtons().map((b) => b.dataset.testid)).toEqual(["grant-deny", "grant-allow-always"]);
    expect(screen.getByTestId("grant-dialog-deferred").textContent).toMatch(/next attempt/);
    expect(screen.getByTestId("grant-dialog").textContent).toMatch(/applies to the next attempt/i);
    expect(screen.queryByTestId("grant-dialog-waiting")).toBeNull();
    expect(screen.getByTestId("grant-dialog").textContent).not.toMatch(/\d+s left/);
  });

  // 10.68 (F2) — every dismissal path answers deny for the denied subject.
  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["close button", () => fireEvent.click(screen.getByTestId("grant-dialog-close"))],
    ["backdrop", () => fireEvent.click(screen.getByTestId("grant-dialog-overlay"))],
  ])("dismissal via %s answers deny", (_label, dismiss) => {
    const { onAnswer } = renderDialog(PROMPTS.filesystem);
    dismiss();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("deny", PROMPTS.filesystem.subject);
  });

  it("answers each verdict for the denied subject when no ladder is offered", () => {
    const onAnswer = vi.fn();
    renderDialog(PROMPTS.cwd, onAnswer);
    fireEvent.click(screen.getByTestId("grant-allow-once"));
    fireEvent.click(screen.getByTestId("grant-allow-always"));
    fireEvent.click(screen.getByTestId("grant-deny"));
    expect(onAnswer.mock.calls).toEqual([
      ["allow-once", "/Users/r/Project/side"],
      ["allow-always", "/Users/r/Project/side"],
      ["deny", "/Users/r/Project/side"],
    ]);
  });

  it("shows how many other prompts are waiting", () => {
    renderDialog(PROMPTS.filesystem, vi.fn(), 2);
    expect(screen.getByTestId("grant-dialog-queued").textContent).toMatch(/2 more/);
  });

  describe("ancestor ladder (7.5)", () => {
    const laddered = prompt(
      "filesystem",
      "/Users/r/Documents/contracts/2026-q1",
      HELD("access-grants.json", ["/Users/r/Documents/contracts", "/Users/r/Documents"]),
    );

    // 10.63 (E44) — denied subject + exactly the carried rungs; narrowest preselected; no free text.
    it("offers exactly the carried rungs with the denied subject preselected", () => {
      renderDialog(laddered);
      const radios = screen.getAllByRole("radio") as HTMLInputElement[];
      expect(radios.map((r) => r.value)).toEqual([
        "/Users/r/Documents/contracts/2026-q1",
        "/Users/r/Documents/contracts",
        "/Users/r/Documents",
      ]);
      expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByTestId("grant-dialog-selected").textContent).toContain(laddered.subject);
    });

    it("tracks the selected rung beside the answer controls and in the verdict", () => {
      const { onAnswer } = renderDialog(laddered);
      fireEvent.click(screen.getAllByRole("radio")[2]);
      expect(screen.getByTestId("grant-dialog-selected").textContent).toContain("/Users/r/Documents");
      expect(screen.getByTestId("grant-dialog-consequence").textContent).toContain("/Users/r/Documents");
      fireEvent.click(screen.getByTestId("grant-allow-always"));
      expect(onAnswer).toHaveBeenCalledWith("allow-always", "/Users/r/Documents");
    });

    it("keeps a deny on the denied subject even when a wider rung is selected", () => {
      const { onAnswer } = renderDialog(laddered);
      fireEvent.click(screen.getAllByRole("radio")[1]);
      fireEvent.click(screen.getByTestId("grant-deny"));
      expect(onAnswer).toHaveBeenCalledWith("deny", laddered.subject);
    });

    it("renders a carried boundary note under the last rung", () => {
      const withBoundary = {
        ...laddered,
        copy: {
          ...laddered.copy,
          ladder: [{ subject: "/repo/pkg" }, { subject: "/repo", boundary: "Highest rung is the checkout root." }],
        },
      } as GrantRequestMessage;
      renderDialog(withBoundary);
      expect(screen.getByTestId("grant-dialog-ladder").textContent).toContain("Highest rung is the checkout root.");
    });

    // 10.64 (E45) — no ancestors, no ladder control at all.
    it("renders no ladder control when the denial carries none", () => {
      renderDialog(PROMPTS.cwd);
      expect(screen.queryByTestId("grant-dialog-ladder")).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });
  });

  // 7.4 / 10.65 (E46) — a markup-bearing origin renders as inert text.
  it("renders a markup-bearing CORS origin as text, creating no element", () => {
    const hostile = "https://<img src=x onerror=alert(1)>.example.com";
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderDialog(prompt("cors", hostile, DEFERRED("cors.allowedOrigins")));
    expect(screen.getByTestId("grant-dialog-subject").textContent).toBe(hostile);
    expect(document.querySelector("img")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
