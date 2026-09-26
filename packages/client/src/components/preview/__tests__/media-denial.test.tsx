/**
 * Multi-request viewers (video, audio): probe discipline and the zero-byte case
 * (change: surface-denial-remedy-in-previews, design D2; test-plan #E36, #E37).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { AudioPreview } from "../AudioPreview.js";
import { VideoPreview } from "../VideoPreview.js";

const target = { kind: "file" as const, cwd: "/p", path: "clip.mp4" };
type Call = { range: string | null; grant: string | null };
let calls: Call[];
let answers: Response[];

beforeEach(() => {
  calls = [];
  answers = [];
  setGrantChannel("cap-live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ range: h.get("Range"), grant: h.get("X-Pi-Grant-Channel") });
      return answers.shift() ?? new Response("", { status: 500 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearGrantChannel();
});

const refusal = (promptOutcome = "ineligible") =>
  new Response(JSON.stringify({ success: false, error: "x", denialId: "d", subject: "/d", promptOutcome }), {
    status: 403,
  });

describe("#E36 media probe discipline", () => {
  it("one opted-out probe per load attempt; one eligible probe per ask; none after the retry", async () => {
    answers.push(refusal());
    const { container } = render(<VideoPreview target={target} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    // (a) first error: exactly one probe, one byte, opted out.
    fireEvent.error(video);
    // (b) the same attempt failing again does not re-arm the probe.
    fireEvent.error(video);
    await screen.findByRole("button", { name: "Ask for access" });
    expect(calls).toEqual([{ range: "bytes=0-0", grant: "" }]);
    // The one-time-answer warning is shown BEFORE the click.
    expect(screen.getByText(/admits only a check/)).toBeTruthy();

    // (c) ask → one eligible probe (the global wrapper is not installed here, so
    // "eligible" = no opt-out header) → 206 → the element remounts.
    answers.push(new Response("x", { status: 206 }));
    fireEvent.click(screen.getByRole("button", { name: "Ask for access" }));
    await waitFor(() => expect(container.querySelector("video")).toBeTruthy());
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ range: "bytes=0-0", grant: null });
    const remounted = container.querySelector("video") as HTMLVideoElement;
    expect(remounted).not.toBe(video);
    // The retried stream fails again: NO probe; the client-side message; no control.
    act(() => void fireEvent.error(remounted));
    await screen.findByText(/admitted only the check/);
    expect(calls).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("#E37 a zero-byte file is not a refusal", () => {
  it("a 416 probe shows the ordinary load error, no access wording, no control", async () => {
    answers.push(new Response("", { status: 416 }));
    const { container } = render(<AudioPreview target={{ ...target, path: "empty.mp3" }} />);
    fireEvent.error(container.querySelector("audio") as HTMLAudioElement);
    const notice = await screen.findByTestId("denial-notice");
    expect(notice.getAttribute("data-outcome")).toBe("error");
    expect(notice.textContent).not.toMatch(/access|grant|prompt/i);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
