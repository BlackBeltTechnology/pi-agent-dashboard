/**
 * Pairing approval dialog (change: add-pairing-approval-dialog, test-plan
 * E8, E9, F3, F4, F14, X9, X13). Exemplar: access-grant/__tests__/GrantPromptDialog.test.tsx.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovePendingOutcome, PendingPairing } from "../../../lib/pairing/pairing-api.js";
import { PairingApprovalDialog } from "../PairingApprovalDialog.js";

const NOW = 1_000_000;

const ENTRY: PendingPairing = {
  pendingId: "11111111-2222-4333-8444-555555555555",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  viaHost: "dash.example.io",
  remoteAddress: "203.0.113.24",
  createdAt: NOW - 5_000,
  expiresAt: NOW + 55_000,
  attemptsLeft: 5,
};

function renderDialog(
  opts: {
    entry?: PendingPairing;
    approve?: (code: string, label: string | undefined) => Promise<ApprovePendingOutcome>;
    queued?: number;
  } = {},
) {
  const onApprove = vi.fn(opts.approve ?? (async () => ({ ok: false as const, error: "mismatch" as const, attemptsLeft: 4 })));
  const cbs = {
    onDeny: vi.fn(async () => {}),
    onDismiss: vi.fn(),
    onDone: vi.fn(),
    onHandledElsewhere: vi.fn(),
  };
  render(
    <PairingApprovalDialog
      entry={opts.entry ?? ENTRY}
      now={NOW}
      queued={opts.queued ?? 0}
      onApprove={onApprove}
      {...cbs}
    />,
  );
  const input = screen.getByTestId("pairing-code-input") as HTMLInputElement;
  return { onApprove, ...cbs, input, dialog: screen.getByTestId("pairing-dialog") };
}

const type = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } });

afterEach(() => cleanup());

describe("PairingApprovalDialog", () => {
  it("E8: 7 digits → no API call, 'Enter all 8 digits' at the field; Approve was enabled", () => {
    const { input, onApprove } = renderDialog();
    type(input, "1234567");
    const approve = screen.getByTestId("pairing-approve") as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByTestId("pairing-code-error").textContent).toContain("Enter all 8 digits");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("E9: non-digits stripped, max 8, grouped 4+4; submitted confirmCode is bare digits", async () => {
    const { input, onApprove } = renderDialog();
    type(input, "12a34 567-89");
    expect(input.value).toBe("1234 5678");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await waitFor(() => expect(onApprove).toHaveBeenCalled());
    expect(onApprove.mock.calls[0][0]).toBe("12345678");
  });

  it("F3: mismatch keeps the value, marks the field invalid with text + icon, states attempts left", async () => {
    const { input } = renderDialog({
      approve: async () => ({ ok: false, error: "mismatch", attemptsLeft: 4 }),
    });
    type(input, "11111111");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    const err = await screen.findByTestId("pairing-code-error");
    expect(err.textContent).toContain("4 attempts left");
    expect(err.querySelector("svg")).not.toBeNull();
    expect(input.value).toBe("1111 1111");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("F4: locked_out → blocked state with only Close", async () => {
    const { input } = renderDialog({ approve: async () => ({ ok: false, error: "locked_out" }) });
    type(input, "11111111");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await screen.findByTestId("pairing-dialog-locked");
    expect(screen.queryByTestId("pairing-approve")).toBeNull();
    expect(screen.queryByTestId("pairing-deny")).toBeNull();
    expect(screen.getByTestId("pairing-dialog-done")).toBeTruthy();
  });

  it("F4: expired → expired state with only Close", async () => {
    const { input } = renderDialog({ approve: async () => ({ ok: false, error: "expired" }) });
    type(input, "11111111");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await screen.findByTestId("pairing-dialog-expired");
    expect(screen.queryByTestId("pairing-approve")).toBeNull();
    expect(screen.queryByTestId("pairing-deny")).toBeNull();
    expect(screen.getByTestId("pairing-dialog-done")).toBeTruthy();
  });

  it("F4: no_pending → reports handled elsewhere", async () => {
    const { input, onHandledElsewhere } = renderDialog({ approve: async () => ({ ok: false, error: "no_pending" }) });
    type(input, "11111111");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await waitFor(() => expect(onHandledElsewhere).toHaveBeenCalledTimes(1));
  });

  it("success shows the paired name, then auto-closes via onDone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { input, onDone } = renderDialog({
        approve: async (_c, label) => ({
          ok: true,
          device: { id: "d1", label: label ?? "x", source: "pairing", tier: "operate", createdAt: 0, lastSeen: 0 } as never,
        }),
      });
      type(input, "12345678");
      fireEvent.change(screen.getByTestId("pairing-name-input"), { target: { value: "QA phone" } });
      fireEvent.click(screen.getByTestId("pairing-approve"));
      const ok = await screen.findByTestId("pairing-dialog-success");
      expect(ok.textContent).toContain("QA phone");
      vi.advanceTimersByTime(4000);
      expect(onDone).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("F14: dialog semantics, initial focus on the code field, numeric input with a visible label", async () => {
    const { dialog, input } = renderDialog();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("A device wants to connect");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("off");
    const label = dialog.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe("Code shown on the device");
  });

  it("X9: untrusted metadata renders as inert text; a forwarded address is labelled 'reported by proxy'", () => {
    const { dialog } = renderDialog({
      entry: {
        ...ENTRY,
        userAgent: "<img src=x onerror=alert(1)>",
        viaHost: "<b>x</b>",
        forwardedFor: "198.51.100.7",
      },
    });
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("b")).toBeNull();
    expect(within(dialog).getByTestId("pairing-dialog-via").textContent).toBe("<b>x</b>");
    const from = within(dialog).getByTestId("pairing-dialog-from").textContent ?? "";
    expect(from).toContain("198.51.100.7");
    expect(from).toContain("reported by proxy");
  });

  it("X13: transport failure keeps the dialog + code, shows the retry error, re-enables Approve", async () => {
    const { input } = renderDialog({
      approve: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    type(input, "12345678");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    const err = await screen.findByTestId("pairing-dialog-error");
    expect(err.textContent).toBe("Couldn't reach the dashboard. Try again.");
    expect(screen.getByTestId("pairing-dialog")).toBeTruthy();
    expect(input.value).toBe("1234 5678");
    expect((screen.getByTestId("pairing-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("never displays a confirmation code and shows the queue count", () => {
    renderDialog({ queued: 1 });
    expect(screen.getByTestId("pairing-dialog-queued").textContent).toBe("+1 more waiting");
    expect(screen.getByTestId("pairing-dialog").textContent).not.toMatch(/\d{4} ?\d{4}/);
  });
});
