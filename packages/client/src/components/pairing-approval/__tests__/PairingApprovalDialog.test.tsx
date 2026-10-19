/**
 * Pairing approval dialog (change: add-pairing-approval-dialog, test-plan
 * E8, E9, F3, F4, F14, X9, X13). Exemplar: access-grant/__tests__/GrantPromptDialog.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "../../../lib/pairing/paired-devices-api.js";
import type { ApprovePendingOutcome, PendingPairing, RefusalRemedies } from "../../../lib/pairing/pairing-approval-api.js";
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
    approve?: (code: string, label: string | undefined, tier?: Tier) => Promise<ApprovePendingOutcome>;
    queued?: number;
    deny?: () => Promise<RefusalRemedies | undefined>;
  } = {},
) {
  const onApprove = vi.fn(opts.approve ?? (async () => ({ ok: false as const, error: "mismatch" as const, attemptsLeft: 4 })));
  const cbs = {
    onDeny: vi.fn(opts.deny ?? (async () => undefined)),
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

const KNOCK: PendingPairing = {
  ...ENTRY,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  viaHost: "192.168.16.204:8000",
  remoteAddress: "192.168.16.31",
  provenance: "knock",
  requesterName: "Roberts-MacBook-Pro",
  unencrypted: true,
};

describe("PairingApprovalDialog", () => {
  it("F7: a 401 operator-credential refusal shows the `pi-dashboard open` hint", async () => {
    const { input } = renderDialog({ approve: async () => ({ ok: false as const, error: "operator credential required" }) });
    type(input, "12345678");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    const err = await screen.findByTestId("pairing-dialog-error");
    expect(err.textContent).toContain("pi-dashboard open");
  });

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
      // The auto-close timer is armed by a passive effect after the success
      // render commits: flush effects first, then advance past the delay.
      await act(async () => {});
      act(() => {
        vi.advanceTimersByTime(4000);
      });
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

  it("Approve and Deny are both disabled while an approval is in flight", async () => {
    let release: (o: ApprovePendingOutcome) => void = () => {};
    const { input } = renderDialog({ approve: () => new Promise((r) => (release = r)) });
    type(input, "12345678");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await waitFor(() => expect((screen.getByTestId("pairing-deny") as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId("pairing-approve") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release({ ok: false, error: "mismatch", attemptsLeft: 3 }));
    expect((screen.getByTestId("pairing-deny") as HTMLButtonElement).disabled).toBe(false);
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

  it("a device name over 64 UTF-8 bytes is refused locally, before any API call", () => {
    const { input, onApprove } = renderDialog();
    type(input, "12345678");
    fireEvent.change(screen.getByTestId("pairing-name-input"), { target: { value: "é".repeat(33) } });
    fireEvent.click(screen.getByTestId("pairing-approve"));
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByTestId("pairing-dialog-error").textContent).toContain("too long");
  });

  it("never displays a confirmation code and shows the queue count", () => {
    renderDialog({ queued: 1 });
    expect(screen.getByTestId("pairing-dialog-queued").textContent).toBe("+1 more waiting");
    expect(screen.getByTestId("pairing-dialog").textContent).not.toMatch(/\d{4} ?\d{4}/);
  });

  describe("knock provenance (E28, change: add-lan-knock-pairing)", () => {
    const okOutcome = async () =>
      ({ ok: true as const, device: { id: "d", label: "x", createdAt: "", lastSeen: null, source: "pairing" } }) as never;

    it("E28: title names the address; Address row leads; Says-it-is row; name prefilled from requesterName", () => {
      const { dialog } = renderDialog({ entry: KNOCK });
      expect(within(dialog).getByText("A device on 192.168.16.31 asks to connect")).toBeTruthy();
      const dl = screen.getByTestId("pairing-dialog-device");
      const first = dl.querySelector("dt");
      expect(first?.textContent).toBe("Address");
      const dd = first?.nextElementSibling as HTMLElement;
      expect(dd.textContent).toBe("192.168.16.31");
      expect(dd.className).toContain("font-mono");
      expect(dd.className).toContain("font-semibold");
      const says = screen.getByTestId("pairing-dialog-says");
      expect(says.textContent).toContain("Says it is");
      expect(says.textContent).toContain("Roberts-MacBook-Pro");
      expect(says.textContent).toContain("(name typed on that device, not verified)");
      expect((screen.getByTestId("pairing-name-input") as HTMLInputElement).value).toBe("Roberts-MacBook-Pro");
    });

    it("E28: no requesterName → no says row, name prefilled from the User-Agent", () => {
      renderDialog({ entry: { ...KNOCK, requesterName: undefined } });
      expect(screen.queryByTestId("pairing-dialog-says")).toBeNull();
      expect((screen.getByTestId("pairing-name-input") as HTMLInputElement).value).toBe("Chrome on macOS");
    });

    it("E28: unencrypted callout (icon + words) sits before the code field; absent when TLS", () => {
      const { input } = renderDialog({ entry: KNOCK });
      const callout = screen.getByTestId("pairing-dialog-unencrypted");
      expect(callout.textContent).toContain("Unencrypted on this network.");
      expect(callout.textContent).toContain("plain http");
      expect(callout.querySelector("svg")).not.toBeNull();
      expect(callout.className).toContain("--severity-warning");
      expect(callout.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      cleanup();
      renderDialog({ entry: { ...KNOCK, unencrypted: false } });
      expect(screen.queryByTestId("pairing-dialog-unencrypted")).toBeNull();
    });

    it("E28: tier group is a labelled radiogroup, Operate preselected, consequence follows the pick, approve sends tier", async () => {
      const { onApprove, input } = renderDialog({ entry: KNOCK, approve: okOutcome });
      const group = screen.getByTestId("pairing-dialog-tier");
      expect(group.tagName).toBe("FIELDSET");
      expect(within(group).getByText("Access for this device").tagName).toBe("LEGEND");
      const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
      expect(radios.map((r) => r.value)).toEqual(["observe", "control", "operate"]);
      expect(radios.find((r) => r.checked)?.value).toBe("operate");
      expect(within(group).getByLabelText(/Observe/)).toBeTruthy();
      const conseq = screen.getByTestId("pairing-dialog-consequence");
      expect(conseq.textContent).toContain("full control of the dashboard (operate)");

      fireEvent.click(within(group).getByLabelText(/Observe/));
      expect(conseq.textContent).toBe("Approving lets this browser watch the dashboard read-only (observe).");
      fireEvent.click(within(group).getByLabelText(/Control/));
      expect(conseq.textContent).toBe("Approving lets this browser drive sessions (control), but not restart or install.");
      fireEvent.click(within(group).getByLabelText(/Observe/));

      type(input, "12345678");
      fireEvent.click(screen.getByTestId("pairing-approve"));
      await waitFor(() => expect(onApprove).toHaveBeenCalled());
      expect(onApprove).toHaveBeenCalledWith("12345678", "Roberts-MacBook-Pro", "observe");
    });

    it("E28: knock approved with the default pick sends tier operate", async () => {
      const { onApprove, input } = renderDialog({ entry: KNOCK, approve: okOutcome });
      type(input, "12345678");
      fireEvent.click(screen.getByTestId("pairing-approve"));
      await waitFor(() => expect(onApprove).toHaveBeenCalled());
      expect(onApprove).toHaveBeenCalledWith("12345678", "Roberts-MacBook-Pro", "operate");
    });

    it("E28: requester name is inert text, never HTML", () => {
      renderDialog({ entry: { ...KNOCK, requesterName: "<b>boss</b>" } });
      const says = screen.getByTestId("pairing-dialog-says");
      expect(says.querySelector("b")).toBeNull();
      expect(says.textContent).toContain("<b>boss</b>");
    });

    it("E28: QR entry (and explicit qr) keeps today's presentation — old title, no tier group, onApprove gets no tier", async () => {
      for (const entry of [ENTRY, { ...ENTRY, provenance: "qr" as const }]) {
        const { onApprove, input, dialog } = renderDialog({ entry, approve: okOutcome });
        expect(within(dialog).getByText("A device wants to connect")).toBeTruthy();
        expect(screen.queryByTestId("pairing-dialog-tier")).toBeNull();
        expect(screen.queryByTestId("pairing-dialog-says")).toBeNull();
        expect(screen.queryByTestId("pairing-dialog-unencrypted")).toBeNull();
        expect(screen.getByTestId("pairing-dialog-device").querySelector("dt")?.textContent).toBe("Browser");
        expect(screen.getByTestId("pairing-dialog-consequence").textContent).toContain("(operate)");
        type(input, "12345678");
        fireEvent.click(screen.getByTestId("pairing-approve"));
        await waitFor(() => expect(onApprove).toHaveBeenCalled());
        expect(onApprove.mock.calls[0]).toHaveLength(2);
        cleanup();
      }
    });
  });
});

/**
 * Credential refusal → remedy rows, retry in place (change:
 * fix-pairing-approval-credential, test-plan E48–E53, E56, F1–F3).
 * `import.meta.env.DEV` is true under vitest, so production behaviour stubs it off.
 */
describe("credential refusal remedies", () => {
  const CODE = "24681357";
  const REFUSED = {
    ok: false as const,
    error: "operator credential required",
    reason: "no-credential",
    remedies: ["authorize-browser", "approve-on-host"],
  };
  const clipboard = { writeText: vi.fn(async (_t: string) => {}) };

  function atOrigin(origin: string) {
    const u = new URL(origin);
    vi.stubGlobal("location", {
      origin,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: "/",
      search: "",
      hash: "",
      href: `${origin}/`,
    });
  }

  beforeEach(() => {
    vi.stubEnv("DEV", false);
    atOrigin("http://localhost:8000");
    clipboard.writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function refuse(outcome: ApprovePendingOutcome | (() => Promise<ApprovePendingOutcome>) = REFUSED) {
    const r = renderDialog({ approve: typeof outcome === "function" ? outcome : async () => outcome });
    type(r.input, CODE);
    fireEvent.click(screen.getByTestId("pairing-approve"));
    const alert = await screen.findByTestId("pairing-dialog-remedies");
    return { ...r, alert };
  }
  const rows = () => screen.queryAllByTestId("pairing-remedy-row").map((r) => r.getAttribute("data-remedy"));
  const commandOf = (remedy: string) =>
    document.querySelector(`[data-testid="pairing-remedy-row"][data-remedy="${remedy}"] code`)?.textContent;

  it("E48: authorize-browser command carries a non-default origin; the flag is omitted for the launcher default", async () => {
    atOrigin("http://127.0.0.1:8000");
    await refuse();
    expect(commandOf("authorize-browser")).toBe("pi-dashboard open --url http://127.0.0.1:8000");
    cleanup();
    atOrigin("http://localhost:8000");
    await refuse();
    expect(commandOf("authorize-browser")).toBe("pi-dashboard open");
  });

  it("E49: a development build renders only the approve-on-host row", async () => {
    vi.stubEnv("DEV", true);
    await refuse();
    expect(rows()).toEqual(["approve-on-host"]);
    expect(screen.getByTestId("pairing-dialog").textContent).not.toContain("pi-dashboard open");
  });

  it("E50: approve-on-host names the request; no copyable string or clipboard write contains the typed code", async () => {
    const { alert } = await refuse();
    expect(commandOf("approve-on-host")).toBe(`pi-dashboard pair approve ${ENTRY.pendingId}`);
    for (const btn of within(alert).getAllByRole("button")) fireEvent.click(btn);
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(2));
    expect(clipboard.writeText.mock.calls.map((c) => c[0])).toEqual([
      "pi-dashboard open",
      `pi-dashboard pair approve ${ENTRY.pendingId}`,
    ]);
    for (const [text] of clipboard.writeText.mock.calls) expect(text).not.toContain(CODE);
    expect(alert.textContent).not.toContain(CODE);
    expect(screen.getByTestId("pairing-dialog").textContent).not.toContain(CODE);
  });

  it("E51: unknown remedy values are ignored; order received is kept", async () => {
    await refuse({ ...REFUSED, remedies: ["future-thing", "approve-on-host"] });
    expect(rows()).toEqual(["approve-on-host"]);
    cleanup();
    await refuse({ ...REFUSED, remedies: ["sign-in", "future-thing", "authorize-browser", "sign-in"] });
    expect(rows()).toEqual(["sign-in", "authorize-browser"]);
  });

  it("sign-in row links to the login page", async () => {
    await refuse({ ...REFUSED, remedies: ["approve-on-host", "sign-in"] });
    const link = screen.getByTestId("pairing-remedy-signin") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("E52: a legacy body (no reason/remedies) keeps the sentence and renders no rows", async () => {
    const { input } = renderDialog({ approve: async () => ({ ok: false as const, error: "operator credential required" }) });
    type(input, CODE);
    fireEvent.click(screen.getByTestId("pairing-approve"));
    const err = await screen.findByTestId("pairing-dialog-error");
    expect(err.textContent).toContain("Approval needs an operator credential");
    expect(screen.queryByTestId("pairing-dialog-remedies")).toBeNull();
    expect(rows()).toEqual([]);
  });

  it("E53: device-credential with no remedies renders no rows and no pi-dashboard command text", async () => {
    await refuse({ ...REFUSED, reason: "device-credential", remedies: [] });
    expect(rows()).toEqual([]);
    expect(screen.queryByTestId("pairing-dialog-error")).toBeNull();
    expect(screen.getByTestId("pairing-dialog").textContent).not.toContain("pi-dashboard");
    expect(screen.getByTestId("pairing-dialog-remedies").textContent?.length).toBeGreaterThan(0);
  });

  it("with remedies the single 'needs an operator credential' sentence is not shown", async () => {
    await refuse();
    expect(screen.getByTestId("pairing-dialog").textContent).not.toContain("needs an operator credential");
    expect(screen.queryByTestId("pairing-dialog-error")).toBeNull();
  });

  it("E56: container is role=alert, commands are selectable text, every copy button has an accessible name", async () => {
    const { alert } = await refuse({ ...REFUSED, remedies: ["authorize-browser", "approve-on-host", "sign-in"] });
    expect(alert.getAttribute("role")).toBe("alert");
    const codes = alert.querySelectorAll("code");
    expect(codes).toHaveLength(2);
    for (const c of codes) {
      expect(c.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(c.querySelector("button, input")).toBeNull();
    }
    const buttons = within(alert).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label") ?? "");
    for (const n of names) expect(n.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(2);
  });

  it("F1+F2: after a refusal the typed code, name and tier stay, the countdown keeps ticking, Approve stays enabled and nothing retries on focus/visibilitychange", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onApprove = vi.fn(async () => REFUSED as ApprovePendingOutcome);
    let now = NOW;
    const props = { entry: KNOCK, queued: 0, onApprove, onDeny: vi.fn(async () => undefined), onDismiss: vi.fn(), onDone: vi.fn(), onHandledElsewhere: vi.fn() };
    const view = render(<PairingApprovalDialog {...props} now={now} />);
    expect(screen.getByTestId("pairing-dialog-expires").textContent).toContain("0:55");
    type(screen.getByTestId("pairing-code-input") as HTMLInputElement, CODE);
    fireEvent.change(screen.getByTestId("pairing-name-input"), { target: { value: "Phone" } });
    fireEvent.click(within(screen.getByTestId("pairing-dialog-tier")).getByLabelText(/Control/));
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await screen.findByTestId("pairing-dialog-remedies");
    expect(onApprove).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    now += 30_000;
    view.rerender(<PairingApprovalDialog {...props} now={now} />);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("pairing-code-input") as HTMLInputElement).value).toBe("2468 1357");
    expect((screen.getByTestId("pairing-name-input") as HTMLInputElement).value).toBe("Phone");
    expect((within(screen.getByTestId("pairing-dialog-tier")).getByLabelText(/Control/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("pairing-dialog-expires").textContent).toContain("0:25");
    expect((screen.getByTestId("pairing-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F3: Approve again after the credential is obtained submits the same code/name/tier and shows the paired state", async () => {
    const outcomes: ApprovePendingOutcome[] = [
      REFUSED,
      { ok: true, device: { id: "d", label: "Phone", createdAt: "", lastSeen: null, source: "pairing" } as never },
    ];
    const onApprove = vi.fn(async () => outcomes.shift() as ApprovePendingOutcome);
    render(
      <PairingApprovalDialog
        entry={KNOCK}
        now={NOW}
        queued={0}
        onApprove={onApprove}
        onDeny={async () => undefined}
        onDismiss={vi.fn()}
        onDone={vi.fn()}
        onHandledElsewhere={vi.fn()}
      />,
    );
    type(screen.getByTestId("pairing-code-input") as HTMLInputElement, CODE);
    fireEvent.change(screen.getByTestId("pairing-name-input"), { target: { value: "Phone" } });
    fireEvent.click(within(screen.getByTestId("pairing-dialog-tier")).getByLabelText(/Control/));
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await screen.findByTestId("pairing-dialog-remedies");
    fireEvent.click(screen.getByTestId("pairing-approve"));
    await screen.findByTestId("pairing-dialog-success");
    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(onApprove.mock.calls[1]).toEqual([CODE, "Phone", "control"]);
    expect(screen.queryByTestId("pairing-dialog-remedies")).toBeNull();
  });

  it("a refused Deny renders the same rows, keeps the dialog open and Deny enabled", async () => {
    const { onDeny } = renderDialog({ deny: async () => ({ reason: "no-credential", remedies: ["authorize-browser", "approve-on-host"] }) });
    fireEvent.click(screen.getByTestId("pairing-deny"));
    await screen.findByTestId("pairing-dialog-remedies");
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual(["authorize-browser", "approve-on-host"]);
    expect((screen.getByTestId("pairing-deny") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("pairing-dialog")).toBeTruthy();
  });

  it("a refused Deny from an older server (no remedies) keeps the legacy sentence", async () => {
    renderDialog({ deny: async () => ({}) });
    fireEvent.click(screen.getByTestId("pairing-deny"));
    const err = await screen.findByTestId("pairing-dialog-error");
    expect(err.textContent).toContain("Approval needs an operator credential");
    expect(screen.queryByTestId("pairing-dialog-remedies")).toBeNull();
  });
});
