/**
 * "Also trust this folder in pi" in every grant dialog (test-plan #F1): checked for
 * worktree-init / pin / Add Folder, unchecked for the access-grant prompt; each states
 * that extensions and MCP servers (including later additions) start with pi.
 * #F2 (mirror-dashboard-trust-live-remote): the "Trust until dashboard restarts" path
 * shows the same checkbox, checked iff `sources.worktreeInit`, and submits `piTrust`.
 * See change: mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote.
 */
import type { GrantRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitHook } from "../../../lib/git/git-api.js";
import { __resetInitBusForTests } from "../../../lib/git/worktree-init-bus.js";
import { initStore } from "../../../lib/git/worktree-init-store.js";
import { AddFoldersDialog } from "../../workspace/AddFoldersDialog.js";
import { PinDirectoryDialog } from "../../workspace/PinDirectoryDialog.js";
import { WorktreeInitButton } from "../../worktree/WorktreeInitButton.js";
import { GrantPromptDialog } from "../GrantPromptDialog.js";

const { fetchWorktreeInitStatus, runWorktreeInit } = vi.hoisted(() => ({
  fetchWorktreeInitStatus: vi.fn(),
  runWorktreeInit: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchWorktreeInitStatus, runWorktreeInit };
});

// Default settings: every config read fails closed to the shipped defaults.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  initStore.__resetForTests();
  __resetInitBusForTests();
});

const hook: WorktreeInitHook = { gate: "test ! -d node_modules", run: { type: "script", command: "npm ci" } };
const checkbox = (id: string) => screen.getByTestId(id) as HTMLInputElement;

function expectConsequence(id: string): void {
  const text = screen.getByTestId(`${id}-consequence`).textContent ?? "";
  expect(text).toMatch(/extension/i);
  expect(text).toMatch(/MCP/);
  expect(text).toMatch(/later/);
}

describe("#F1 per-entry pi-trust checkbox", () => {
  it("worktree-init dialog: checked by default and stored with 'Always trust'", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, untrusted: true, hook, hash: "h1" })
      .mockResolvedValueOnce({ ok: true, ran: true, durationMs: 1 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-pi-trust"));
    expect(checkbox("worktree-init-pi-trust").checked).toBe(true);
    expectConsequence("worktree-init-pi-trust");
    fireEvent.click(checkbox("worktree-init-pi-trust"));
    fireEvent.click(screen.getByTestId("worktree-init-trust-always"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0]).toMatchObject({ confirmHash: "h1", scope: "project", piTrust: false });
  });

  it("pin dialog: checked by default and reported with the path", async () => {
    const onPin = vi.fn();
    render(<PinDirectoryDialog showPiTrust onPin={onPin} onCancel={vi.fn()} />);
    expect(checkbox("pin-pi-trust").checked).toBe(true);
    expectConsequence("pin-pi-trust");
  });

  it("Add Folder dialog: checked by default", () => {
    render(<AddFoldersDialog workspaces={[]} onPin={vi.fn()} onCancel={vi.fn()} />);
    expect(checkbox("add-folders-pi-trust").checked).toBe(true);
    expectConsequence("add-folders-pi-trust");
  });

  it("access-grant prompt: unchecked by default and sent with 'Allow always'", () => {
    const prompt: GrantRequestMessage = {
      type: "grant_request",
      promptId: "p1",
      plane: "filesystem",
      subject: "/Users/r/Documents/contracts",
      expiresAt: Date.now() + 24_000,
      copy: { mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" },
    };
    const onAnswer = vi.fn();
    render(<GrantPromptDialog prompt={prompt} now={Date.now()} queued={0} onAnswer={onAnswer} />);
    expect(checkbox("grant-pi-trust").checked).toBe(false);
    expectConsequence("grant-pi-trust");
    fireEvent.click(checkbox("grant-pi-trust"));
    fireEvent.click(screen.getByTestId("grant-allow-always"));
    expect(onAnswer).toHaveBeenCalledWith("allow-always", "/Users/r/Documents/contracts", true);
  });
});

describe("#F2 session-scope path carries piTrust", () => {
  const stubConfig = (worktreeInit: boolean) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { piTrustMirror: { enabled: true, coverInteractive: false, liveQuery: true, sources: { worktreeInit, accessGrants: false } } },
        }),
      })),
    );

  async function openDialog() {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, untrusted: true, hook, hash: "h2" })
      .mockResolvedValueOnce({ ok: true, ran: true, durationMs: 1 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-pi-trust"));
  }

  it.each([
    [true, true],
    [false, false],
  ])("sources.worktreeInit=%s → checkbox checked=%s and 'Trust until dashboard restarts' sends it", async (configured, expected) => {
    stubConfig(configured);
    await openDialog();
    await waitFor(() => expect(checkbox("worktree-init-pi-trust").checked).toBe(expected));
    fireEvent.click(screen.getByTestId("worktree-init-trust-session"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0]).toMatchObject({ confirmHash: "h2", scope: "session", piTrust: expected });
  });

  it("an operator change to the checkbox is what the session path submits", async () => {
    stubConfig(true);
    await openDialog();
    await waitFor(() => expect(checkbox("worktree-init-pi-trust").checked).toBe(true));
    fireEvent.click(checkbox("worktree-init-pi-trust"));
    fireEvent.click(screen.getByTestId("worktree-init-trust-session"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0]).toMatchObject({ scope: "session", piTrust: false });
  });
});
