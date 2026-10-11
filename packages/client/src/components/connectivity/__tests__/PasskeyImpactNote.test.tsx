/**
 * See change: add-passkey-user-auth (passkey-user-auth › Primary switch warns
 * about orphaned passkeys — the `auth.redirectBaseUrl` edit, incl. clearing it).
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasskeyImpactNote } from "../PasskeyImpactNote.js";

const { credentialImpact } = vi.hoisted(() => ({ credentialImpact: vi.fn() }));
vi.mock("../../../lib/users/users-api.js", () => ({ credentialImpact }));

beforeEach(() => {
  credentialImpact.mockReset();
  credentialImpact.mockResolvedValue({ currentRpId: "dash.example.com", nextRpId: "host.ts.net", orphaned: 2, users: 1 });
});
afterEach(cleanup);

describe("PasskeyImpactNote", () => {
  it("a CLEARED redirect override still asks (fallback to the primary can orphan passkeys)", async () => {
    render(<PasskeyImpactNote query={{ redirectBaseUrl: "" }} testId="n" />);
    expect((await screen.findByTestId("n")).textContent).toContain("2 passkey");
    expect(credentialImpact).toHaveBeenCalledWith({ redirectBaseUrl: "" });
  });

  it("does not ask for a partial, non-URL redirect draft", async () => {
    // debounceMs 0 + flushed effects/timers: a request would have fired by now.
    vi.useFakeTimers();
    try {
      render(<PasskeyImpactNote query={{ redirectBaseUrl: "dash.exa" }} testId="n" />);
      await act(async () => {
        vi.runAllTimers();
      });
      expect(credentialImpact).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks by URL for a provider switch and stays silent when nothing is orphaned", async () => {
    credentialImpact.mockResolvedValue({ currentRpId: "a", nextRpId: "a", orphaned: 0, users: 0 });
    render(<PasskeyImpactNote query={{ url: "https://x.example" }} testId="n" />);
    await waitFor(() => expect(credentialImpact).toHaveBeenCalledWith({ url: "https://x.example" }));
    expect(screen.queryByTestId("n")).toBeNull();
  });
});
