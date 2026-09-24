/**
 * YOLO activation entry points + Access page card (change:
 * add-access-grant-dialog, tasks 8b.7 surface 3, 8b.7a, 8b.7b, 8b.8; test-plan
 * rows 10.54 (UI half), 10.60, 10.73, 10.74).
 */
import type { GrantRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { yoloStatus } from "../../../lib/access-grants/yolo-status.js";
import { AccessPromptsSection } from "../../settings/AccessPromptsSection.js";
import { GrantPromptDialog } from "../GrantPromptDialog.js";
import { DirectoryYoloAction } from "../YoloActivation.js";
import { type FakeYoloServer, installFakeYoloServer, scopedSession, view } from "./yolo-test-server.js";

let server: FakeYoloServer;
const NOW = Date.now();

beforeEach(() => {
  server = installFakeYoloServer({
    now: NOW,
    roots: {
      "/repo/app": ["/repo/app", "/repo"],
      "/repo/lib": ["/repo/lib", "/repo"],
      "/repo/app/secret.txt": ["/repo/app/secret.txt", "/repo/app", "/repo"],
    },
  });
  yoloStatus.publish(view(server).yolo);
});

afterEach(() => cleanup());

const posts = () => server.calls.filter((c) => c.url === "/api/access/yolo" && c.method === "POST");
const radio = (el: HTMLElement) => el.querySelector("input") as HTMLInputElement;

async function openAccessPage(selectedCwd = "/repo/app") {
  render(<AccessPromptsSection selectedCwd={selectedCwd} />);
  return screen.findByTestId("yolo-access-card");
}

describe("Access page card", () => {
  it("renders exactly the shipped duration set, shortest pre-selected (10.60)", async () => {
    const card = await openAccessPage();
    const durations = within(card).getByTestId("yolo-durations");
    const inputs = within(durations).getAllByRole("radio") as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["15", "30", "60"]);
    expect(inputs.map((i) => i.checked)).toEqual([true, false, false]);
    expect(durations.textContent).not.toMatch(/until i stop|forever|unlimited/i);
  });

  it("offers the session-cwd ladder, narrowest pre-selected; unscoped offered, distinct, never pre-selected", async () => {
    const card = await openAccessPage();
    const options = await within(card).findAllByTestId("yolo-root-option");
    expect(options.map((o) => radio(o).value)).toEqual(["/repo/app", "/repo"]);
    expect(radio(options[0]).checked).toBe(true);
    const unscoped = within(card).getByTestId("yolo-unscoped-option");
    expect(radio(unscoped).checked).toBe(false);
    // Warning, never error (ui-plan S6); distinct by weight and border.
    expect(unscoped.className).toContain("severity-warning");
    expect(unscoped.className).not.toContain("severity-error");
    expect(unscoped.className).toContain("font-bold");
    expect(within(card).queryByRole("textbox")).toBeNull();
    expect(server.calls.some((c) => c.url === "/api/access/yolo/roots?base=%2Frepo%2Fapp")).toBe(true);
  });

  it("activates scoped with the chosen duration + root, then names planes, every root, time and End now", async () => {
    const card = await openAccessPage();
    await within(card).findAllByTestId("yolo-root-option");
    fireEvent.click(within(card).getByLabelText("30 min"));
    fireEvent.click(within(card).getByTestId("yolo-activate"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toEqual({ durationMinutes: 30, base: "/repo/app", root: "/repo/app" });

    const active = await within(card).findByTestId("yolo-access-active");
    expect(active.dataset.scope).toBe("scoped");
    expect(within(active).getByTestId("yolo-access-planes").textContent).toMatch(/filesystem.*working directory/);
    expect(within(active).getAllByTestId("yolo-access-root").map((r) => r.textContent)).toEqual([
      expect.stringContaining("/repo/app"),
    ]);
    expect(within(active).getByTestId("yolo-access-remaining").textContent).toMatch(/(29:\d\d|30:00) left/);
    expect(within(active).queryByRole("button", { name: /dismiss|close|hide/i })).toBeNull();

    fireEvent.click(within(active).getByTestId("yolo-end"));
    await waitFor(() => expect(within(card).queryByTestId("yolo-access-active")).toBeNull());
    expect(server.calls.some((c) => c.url === "/api/access/yolo" && c.method === "DELETE")).toBe(true);
  });

  it("the explicit unscoped choice posts unscoped and renders distinctly", async () => {
    const card = await openAccessPage();
    await within(card).findAllByTestId("yolo-root-option");
    fireEvent.click(radio(within(card).getByTestId("yolo-unscoped-option")));
    fireEvent.click(within(card).getByTestId("yolo-activate"));
    await waitFor(() => expect(posts()[0]?.body).toEqual({ durationMinutes: 15, unscoped: true }));
    const active = await within(card).findByTestId("yolo-access-active");
    expect(active.dataset.scope).toBe("unscoped");
    expect(within(active).getByTestId("yolo-access-unscoped")).toBeTruthy();
  });

  it("an environment session says it lasts until the server stops", async () => {
    server.session = { ...scopedSession(NOW, "/srv"), source: "env", expiresAt: null };
    yoloStatus.publish(view(server).yolo);
    const card = await openAccessPage();
    const active = await within(card).findByTestId("yolo-access-active");
    expect(within(active).getByTestId("yolo-access-remaining").textContent).toBe("until the server stops");
  });
});

describe("report mode: controls inert with the reason, never hidden (10.54 UI half)", () => {
  beforeEach(() => {
    server.available = false;
    yoloStatus.publish(view(server).yolo);
  });

  it("Access card: durations, roots and Activate are rendered but disabled, with the reason", async () => {
    const card = await openAccessPage();
    await within(card).findAllByTestId("yolo-root-option");
    expect((within(card).getByTestId("yolo-durations") as HTMLFieldSetElement).disabled).toBe(true);
    expect((within(card).getByTestId("yolo-roots") as HTMLFieldSetElement).disabled).toBe(true);
    expect((within(card).getByTestId("yolo-activate") as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByTestId("yolo-unavailable-reason").textContent).toMatch(/host-gate mode is report/);
    expect(posts()).toHaveLength(0);
    expect(within(card).queryByTestId("yolo-access-active")).toBeNull();
  });

  it("grant dialog + directory page: the offer is inert with the reason", () => {
    render(<DirectoryYoloAction cwd="/repo/app" />);
    const dir = screen.getByTestId("directory-yolo");
    expect((within(dir).getByTestId("directory-yolo-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dir).getByTestId("yolo-unavailable-reason")).toBeTruthy();
    cleanup();

    render(<GrantPromptDialog prompt={fsPrompt()} now={NOW} queued={0} onAnswer={vi.fn()} />);
    const offer = screen.getByTestId("grant-dialog-yolo");
    expect((within(offer).getByTestId("grant-dialog-yolo-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(within(offer).getByTestId("yolo-unavailable-reason")).toBeTruthy();
  });
});

function fsPrompt(): GrantRequestMessage {
  return {
    type: "grant_request",
    promptId: "p1",
    plane: "filesystem",
    subject: "/repo/app/secret.txt",
    expiresAt: NOW + 24_000,
    copy: {
      mode: "held",
      verdicts: ["allow-once", "allow-always", "deny"],
      store: "access-grants.json",
      ladder: [{ subject: "/repo/app" }, { subject: "/repo" }],
    },
  };
}

describe("grant dialog inline offer (8b.7a, 10.74)", () => {
  it("uses that denial's ladder, is not a verdict, and the denial still requires an explicit verdict", async () => {
    const onAnswer = vi.fn();
    render(<GrantPromptDialog prompt={fsPrompt()} now={NOW} queued={0} onAnswer={onAnswer} />);
    const dialog = screen.getByTestId("grant-dialog");
    const toggle = within(dialog).getByTestId("grant-dialog-yolo-toggle");
    // Not a fourth verdict: the verdict set is unchanged and the offer is not among them.
    const verdicts = ["grant-deny", "grant-allow-once", "grant-allow-always"].map((id) => within(dialog).getByTestId(id));
    expect(verdicts).not.toContain(toggle);
    expect(verdicts[0].parentElement?.contains(toggle)).toBe(false);

    fireEvent.click(toggle);
    const options = await within(dialog).findAllByTestId("yolo-root-option");
    expect(options.map((o) => radio(o).value)).toEqual(["/repo/app/secret.txt", "/repo/app", "/repo"]);
    expect(within(dialog).queryByTestId("yolo-unscoped-option")).toBeNull();
    expect(server.calls.some((c) => c.url.endsWith(`base=${encodeURIComponent("/repo/app/secret.txt")}`))).toBe(true);

    fireEvent.click(radio(options[1]));
    fireEvent.click(within(dialog).getByTestId("yolo-activate"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toMatchObject({ base: "/repo/app/secret.txt", root: "/repo/app" });

    // The dialog stays up, no verdict was sent, and it says an answer is still needed.
    expect(await within(dialog).findByTestId("yolo-activation-result")).toHaveProperty(
      "textContent",
      expect.stringMatching(/still needs your answer/),
    );
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByTestId("grant-dialog")).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId("grant-allow-once"));
    expect(onAnswer).toHaveBeenCalledWith("allow-once", "/repo/app/secret.txt");
  });

  it("is not offered on planes YOLO cannot reach", () => {
    render(
      <GrantPromptDialog
        prompt={{ ...fsPrompt(), plane: "network", subject: "10.0.0.0/8", copy: { mode: "deferred", verdicts: ["allow-always", "deny"], store: "config.trustedNetworks" } }}
        now={NOW}
        queued={0}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("grant-dialog-yolo")).toBeNull();
  });
});

describe("one shared session (8b.7a, 8b.7b, 10.73)", () => {
  it("directory page pre-selects its own folder; the Access page then shows that same session", async () => {
    render(<DirectoryYoloAction cwd="/repo/app" />);
    fireEvent.click(screen.getByTestId("directory-yolo-toggle"));
    const options = await screen.findAllByTestId("yolo-root-option");
    expect(radio(options[0]).value).toBe("/repo/app");
    expect(radio(options[0]).checked).toBe(true);
    expect(screen.queryByTestId("yolo-unscoped-option")).toBeNull();
    fireEvent.click(screen.getByTestId("yolo-activate"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    cleanup();

    const card = await openAccessPage("/elsewhere");
    const active = await within(card).findAllByTestId("yolo-access-active");
    expect(active).toHaveLength(1);
    expect(within(active[0]).getAllByTestId("yolo-access-root").map((r) => r.textContent)).toEqual([
      expect.stringContaining("/repo/app"),
    ]);
  });

  it("a new base resets the root choice (no stale root from the previous folder)", async () => {
    const { rerender } = render(<DirectoryYoloAction cwd="/repo/app" />);
    fireEvent.click(screen.getByTestId("directory-yolo-toggle"));
    const first = await screen.findAllByTestId("yolo-root-option");
    // Make the choice explicit (clicking the pre-checked radio fires no change).
    fireEvent.click(radio(first[1]));
    fireEvent.click(radio(first[0]));
    expect(radio(first[0]).checked).toBe(true);
    rerender(<DirectoryYoloAction cwd="/repo/lib" />);
    await waitFor(() => expect(radio(screen.getAllByTestId("yolo-root-option")[0]).value).toBe("/repo/lib"));
    expect(radio(screen.getAllByTestId("yolo-root-option")[0]).checked).toBe(true);
  });

  it("a second surface ADDS its root, says the timer is unchanged, and never starts a second session", async () => {
    server.session = scopedSession(NOW, "/repo/app");
    const expiresAt = server.session.expiresAt;
    yoloStatus.publish(view(server).yolo);

    render(<DirectoryYoloAction cwd="/repo/lib" />);
    fireEvent.click(screen.getByTestId("directory-yolo-toggle"));
    const form = await screen.findByTestId("yolo-activation");
    expect(form.dataset.mode).toBe("add");
    expect(within(form).queryByTestId("yolo-durations")).toBeNull();
    expect(within(form).getByTestId("yolo-add-note").textContent).toMatch(/timer is unchanged/);
    await within(form).findAllByTestId("yolo-root-option");
    fireEvent.click(within(form).getByTestId("yolo-add-root"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(await within(form).findByTestId("yolo-activation-result")).toHaveProperty(
      "textContent",
      expect.stringMatching(/timer is unchanged/),
    );
    cleanup();

    const card = await openAccessPage();
    const active = await within(card).findAllByTestId("yolo-access-active");
    expect(active).toHaveLength(1);
    expect(within(active[0]).getAllByTestId("yolo-access-root")).toHaveLength(2);
    expect(yoloStatus.getSnapshot()?.session?.expiresAt).toBe(expiresAt);
  });
});

describe("auto-answers in the verdict list (8b.8)", () => {
  it("stay listed after the session ends, distinguished and labelled no human answered", async () => {
    server.session = null;
    server.verdicts = [
      { answeredBy: "yolo", plane: "filesystem", subject: "/repo/app/a.txt", outcome: "auto-allowed", at: NOW - 10 },
      {
        answeredBy: "operator",
        promptId: "v1",
        plane: "filesystem",
        subject: "/repo/b.txt",
        outcome: "allow-once",
        at: NOW - 20,
      },
    ];
    yoloStatus.publish(view(server).yolo);
    render(<AccessPromptsSection />);
    const rows = await screen.findAllByTestId("access-verdict-row");
    const [yolo, operator] = rows;
    expect(screen.queryByTestId("yolo-access-active")).toBeNull();
    expect(yolo.dataset.answeredBy).toBe("yolo");
    expect(within(yolo).getByTestId("access-verdict-yolo-badge")).toBeTruthy();
    expect(yolo.textContent).toMatch(/no human answered/);
    expect(operator.dataset.answeredBy).toBe("operator");
    expect(within(operator).queryByTestId("access-verdict-yolo-badge")).toBeNull();
    expect(operator.textContent).not.toMatch(/no human answered/);
  });
});
