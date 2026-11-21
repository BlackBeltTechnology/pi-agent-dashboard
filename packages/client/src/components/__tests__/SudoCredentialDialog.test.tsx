/**
 * Sudo credential modal + host. See change: add-sudo-credential-prompt
 * (tasks 4.5 client half, 5.1–5.8; test-plan #S50 #S51 #S52 #S53 #S54 #S56 #S57 #S17 #S85).
 */
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSudoCredentialBus,
  dismissSudoCredentialRequest,
  setSudoCredentialCache,
  setSudoCredentialRequest,
} from "../../lib/state/sudo-credential-bus.js";
import { SudoCredentialDialog, SudoCredentialHost } from "../SudoCredentialDialog.js";

type Sent = { type: string; [k: string]: unknown };

const req = (callId: string, extra: Record<string, unknown> = {}) => ({
  sessionId: "s1",
  callId,
  commands: ["sudo apt-get update"],
  prompt: "[sudo] password for robson:",
  ...extra,
});

function makeSend(verdict: { status: "handed" } | { status: "rejected"; reason: "no_socket" } = { status: "handed" }) {
  const sent: Sent[] = [];
  const send = vi.fn((m: Sent) => {
    sent.push(m);
    return verdict;
  });
  return { send, sent };
}

const field = () => screen.getByTestId("sudo-credential-password") as HTMLInputElement;
const typePassword = (v: string) => fireEvent.change(field(), { target: { value: v } });
const enter = () => fireEvent.keyDown(field(), { key: "Enter" });
const escape = () => fireEvent.keyDown(document, { key: "Escape" });

beforeEach(() => {
  __resetEscapeStack();
  __resetSudoCredentialBus();
});
afterEach(() => {
  cleanup();
  __resetEscapeStack();
});

describe("SudoCredentialDialog — masked field (S50)", () => {
  it("masks the input, never persists the password, and leaves no DOM trace after unmount", () => {
    const { send } = makeSend();
    const P = "hunter2-secret";
    const { unmount } = render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={() => {}} />);
    const input = field();
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    typePassword(P);
    enter();
    const leaks = () =>
      JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href + document.cookie;
    expect(leaks()).not.toContain(P);
    unmount();
    expect(document.body.innerHTML).not.toContain(P);
    expect(leaks()).not.toContain(P);
  });
});

describe("SudoCredentialDialog — ack on render (S51)", () => {
  it("sends exactly one sudo_credential_shown per callId under StrictMode and re-renders", () => {
    const { send, sent } = makeSend();
    const ui = (rq: ReturnType<typeof req>) => (
      <StrictMode>
        <SudoCredentialDialog request={rq} send={send as never} onDone={() => {}} />
      </StrictMode>
    );
    const { rerender } = render(ui(req("C1")));
    for (let i = 0; i < 5; i++) rerender(ui(req("C1")));
    const shown = sent.filter((m) => m.type === "sudo_credential_shown");
    expect(shown).toEqual([{ type: "sudo_credential_shown", sessionId: "s1", callId: "C1" }]);
    expect(shown.some((m) => m.callId === "OTHER")).toBe(false);
  });
});

describe("SudoCredentialDialog — submit/Cancel semantics (S52)", () => {
  it("Enter twice sends one _response; Esc after submit sends no _cancel", () => {
    const { send, sent } = makeSend();
    render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={() => {}} />);
    typePassword("pw");
    enter();
    enter();
    escape();
    expect(sent.filter((m) => m.type === "sudo_credential_response")).toEqual([
      { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "pw" },
    ]);
    expect(sent.filter((m) => m.type === "sudo_credential_cancel")).toHaveLength(0);
  });

  it("Esc before submit sends exactly one _cancel; the Cancel button is equivalent", () => {
    const a = makeSend();
    render(<SudoCredentialDialog request={req("C1")} send={a.send as never} onDone={() => {}} />);
    escape();
    escape();
    expect(a.sent.filter((m) => m.type === "sudo_credential_cancel")).toEqual([
      { type: "sudo_credential_cancel", sessionId: "s1", callId: "C1" },
    ]);
    cleanup();
    const b = makeSend();
    render(<SudoCredentialDialog request={req("C2")} send={b.send as never} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId("sudo-credential-cancel"));
    expect(b.sent.filter((m) => m.type === "sudo_credential_cancel")).toEqual([
      { type: "sudo_credential_cancel", sessionId: "s1", callId: "C2" },
    ]);
  });

  it("a backdrop click does NOT cancel (Cancel is sticky for in-flight tool calls)", () => {
    const { send, sent } = makeSend();
    render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId("sudo-credential-dialog-overlay"));
    expect(sent.filter((m) => m.type === "sudo_credential_cancel")).toHaveLength(0);
  });

  it("closes (onDone) once the response is handed off, and clears the password from the DOM", () => {
    const { send } = makeSend();
    const onDone = vi.fn();
    render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={onDone} />);
    typePassword("pw");
    enter();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("");
  });

  it("a rejected send shows 'connection lost, retry', keeps the dialog open and allows a retry", () => {
    const rejected = makeSend({ status: "rejected", reason: "no_socket" });
    const onDone = vi.fn();
    render(<SudoCredentialDialog request={req("C1")} send={rejected.send as never} onDone={onDone} />);
    typePassword("pw");
    enter();
    expect(screen.getByRole("alert").textContent).toMatch(/connection lost/i);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("sudo-credential-dialog")).toBeTruthy();
    enter(); // retry is allowed because nothing was handed off
    expect(rejected.sent.filter((m) => m.type === "sudo_credential_response")).toHaveLength(2);
  });
});

describe("SudoCredentialDialog — empty / over-long password (S85)", () => {
  it("empty and 1025 chars send no frame and show an inline message; 1024 sends one", () => {
    const { send, sent } = makeSend();
    render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={() => {}} />);
    const responses = () => sent.filter((m) => m.type === "sudo_credential_response");
    enter();
    expect(responses()).toHaveLength(0);
    expect(screen.getByRole("alert")).toBeTruthy();
    typePassword("x".repeat(1025));
    enter();
    expect(responses()).toHaveLength(0);
    expect(screen.getByRole("alert")).toBeTruthy();
    typePassword("x".repeat(1024));
    enter();
    expect(responses()).toHaveLength(1);
  });
});

describe("SudoCredentialDialog — focus trap + a11y (S53)", () => {
  it("is a labelled modal dialog, focuses the password field, traps Tab and restores focus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { send } = makeSend();
    const { unmount } = render(<SudoCredentialDialog request={req("C1")} send={send as never} onDone={() => {}} />);
    const dialog = screen.getByTestId("sudo-credential-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId && document.getElementById(labelId)?.textContent).toBeTruthy();
    const region = screen.getByTestId("sudo-credential-commands");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toBeTruthy();
    expect(document.activeElement).toBe(field());

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    );
    expect(focusables.length).toBeGreaterThanOrEqual(3);
    const last = focusables[focusables.length - 1]!;
    const first = focusables[0]!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("SudoCredentialHost — no state leak between prompts (S54)", () => {
  it("a dismissed C1 half-typed password never reaches the C2 dialog", () => {
    const { send, sent } = makeSend();
    render(<SudoCredentialHost send={send as never} />);
    act(() => setSudoCredentialRequest(req("C1")));
    typePassword("P1-half");
    act(() => {
      dismissSudoCredentialRequest("s1", "C1");
      setSudoCredentialRequest(req("C2"));
    });
    expect(field().value).toBe("");
    expect(document.body.innerHTML).not.toContain("P1-half");
    enter();
    expect(sent.filter((m) => m.type === "sudo_credential_response")).toHaveLength(0);
    expect(sent.some((m) => m.callId === "C1" && m.type !== "sudo_credential_shown")).toBe(false);
  });
});

describe("SudoCredentialHost — Forget chip (S56)", () => {
  it("is driven only by pushed _cache frames and sends one _forget on click", () => {
    const { send, sent } = makeSend();
    render(<SudoCredentialHost send={send as never} />);
    expect(screen.queryByTestId("sudo-credential-forget")).toBeNull();
    act(() => setSudoCredentialCache("s1", Date.now() - 10_000)); // already past: browser clock is not consulted
    const chip = screen.getByTestId("sudo-credential-forget");
    fireEvent.click(chip);
    expect(sent.filter((m) => m.type === "sudo_credential_forget")).toEqual([
      { type: "sudo_credential_forget", sessionId: "s1" },
    ]);
    act(() => setSudoCredentialCache("s1", null));
    expect(screen.queryByTestId("sudo-credential-forget")).toBeNull();
  });
});

describe("SudoCredentialDialog — command rendering (S17, S57)", () => {
  it("renders hostile command text inertly and verbatim", () => {
    const { send } = makeSend();
    const cmd = `echo '<img src=x onerror=window.__x=1>'; sudo -p "x" true`;
    render(<SudoCredentialDialog request={req("C1", { commands: [cmd] })} send={send as never} onDone={() => {}} />);
    expect(document.querySelector("[data-testid=sudo-credential-dialog] img")).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    const region = screen.getByTestId("sudo-credential-commands");
    expect(region.textContent).toContain(cmd);
    expect(region.className).toMatch(/overflow-auto/);
  });

  it("lists every command in full and labels the command-supplied prompt text with its truncation marker intact", () => {
    const { send } = makeSend();
    const long = Array.from({ length: 200 }, (_, i) => `line-${i} ${"x".repeat(20)}`).join("\n");
    const prompt = `${"a".repeat(250)}… [1 more chars] ${"b".repeat(250)}`;
    render(
      <SudoCredentialDialog
        request={req("C1", { commands: ["sudo true", long, "sudo -k"], prompt, promptTruncated: 1 })}
        send={send as never}
        onDone={() => {}}
      />,
    );
    const region = screen.getByTestId("sudo-credential-commands");
    expect(region.textContent).toContain("sudo true");
    expect(region.textContent).toContain(long);
    expect(region.textContent).toContain("sudo -k");
    const group = screen.getByRole("group", { name: /text supplied by the command/i });
    expect(within(group).getByTestId("sudo-credential-prompt-text").textContent).toBe(prompt);
  });

  it("shows bidi/control characters as visible escapes", () => {
    const { send } = makeSend();
    render(<SudoCredentialDialog request={req("C1", { commands: ["sudo \u202Etrue"] })} send={send as never} onDone={() => {}} />);
    const text = screen.getByTestId("sudo-credential-commands").textContent ?? "";
    expect(text).not.toContain("\u202E");
    expect(text).toContain("\\u202E");
  });
});
