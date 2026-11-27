// @vitest-environment jsdom
/**
 * StartTeamDialog (7.1; test-plan #F1-#F3 at unit level, #F8 no raw key): template
 * list states, hook-confirmation step with the shown hash, exactly one POST in
 * flight, error + retry, Esc / ✕ semantics, commands rendered as literal text.
 * See change: add-agent-teams-templates-hooks.
 */
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "../../shared/protocol.js";
import { StartTeamDialog } from "../StartTeamDialog.js";
import { START_TABLES } from "../start-i18n.js";

const resp = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as Response;
const tpl = (name: string, over: Partial<TemplateSummary> = {}): TemplateSummary => ({ name, source: "user", trusted: true, valid: true, errors: [], warnings: [], ...over });
const HOOK_CMD = `<img src=x onerror=alert(1)>; echo "&amp;"`;
const LISTING = {
  templates: [
    tpl("review-pr", { description: "Review a pull request", members: [{ name: "a" }, { name: "b" }], hasHooks: true }),
    tpl("broken", { valid: false, errors: [{ code: "field_invalid", message: "lead.model is not a string" }] }),
    tpl("from-repo", { source: "project", trusted: false }),
    tpl("second"),
  ],
  warnings: [],
};

let fetchMock: ReturnType<typeof vi.fn>;
type Handler = (url: string, init?: RequestInit) => Promise<Response>;
const install = (post: Handler) => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST" ? post(url, init) : resp(LISTING)));
  vi.stubGlobal("fetch", fetchMock);
};
const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

beforeEach(() => install(async () => resp({ teamId: "t_1" })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(props: Partial<Parameters<typeof StartTeamDialog>[0]> = {}, language = "en") {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(
    <PluginContextProvider connectionStatus="connected" language={language}>
      <StartTeamDialog cwd="/repo/a" onClose={onClose} onStarted={onStarted} {...props} />
    </PluginContextProvider>,
  );
  return { onClose, onStarted };
}
const pick = async (name = "review-pr") => fireEvent.click(await screen.findByTestId(`start-template-${name}`));
const goal = (text = "ship it") => fireEvent.change(screen.getByTestId("start-goal"), { target: { value: text } });
const start = () => fireEvent.click(screen.getByTestId("start-submit"));

describe("template list", () => {
  it("shows source, hooks and member badges; invalid and untrusted are disabled with an accessible reason", async () => {
    mount();
    await screen.findByTestId("start-template-list");
    expect((screen.getByTestId("start-template-review-pr") as HTMLInputElement).disabled).toBe(false);
    const broken = screen.getByTestId("start-template-broken") as HTMLInputElement;
    const repo = screen.getByTestId("start-template-from-repo") as HTMLInputElement;
    expect(broken.disabled).toBe(true);
    expect(repo.disabled).toBe(true);
    expect(document.getElementById(broken.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Invalid template — lead.model is not a string");
    expect(document.getElementById(repo.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Untrusted project — trust it to use this template");
    const dialog = screen.getByTestId("start-team-dialog");
    for (const text of ["User", "Project", "Runs hook commands", "2 teammates", "Review a pull request"]) expect(dialog.textContent, text).toContain(text);
  });

  it("a disabled template cannot be chosen", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("start-template-broken"));
    goal();
    start();
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toContain("Choose a template.");
    expect(posts()).toHaveLength(0);
  });

  it("a single startable template is preselected; with several the user must choose", async () => {
    install(async () => resp({}));
    fetchMock.mockImplementation(async () => resp({ templates: [tpl("only")], warnings: [] }));
    mount();
    expect(((await screen.findByTestId("start-template-only")) as HTMLInputElement).checked).toBe(true);
    cleanup();
    fetchMock.mockImplementation(async () => resp({ templates: [tpl("a"), tpl("b")], warnings: [] }));
    mount();
    expect(((await screen.findByTestId("start-template-a")) as HTMLInputElement).checked).toBe(false);
  });

  it("shows the empty and failed states; Retry reloads", async () => {
    fetchMock.mockImplementation(async () => resp({ error: "x" }, 500));
    mount();
    await screen.findByTestId("start-templates-error");
    fetchMock.mockImplementation(async () => resp(LISTING));
    fireEvent.click(screen.getByTestId("start-templates-retry"));
    await screen.findByTestId("start-template-list");
    cleanup();
    fetchMock.mockImplementation(async () => resp({ templates: [], warnings: [] }));
    mount();
    expect(await screen.findByText("No team templates found for this folder.")).toBeTruthy();
  });
});

describe("start + errors (F3)", () => {
  it("validates goal and template before any POST", async () => {
    mount();
    await screen.findByTestId("start-template-list");
    start();
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toEqual(["Choose a template.", "Enter a goal."]);
    await pick();
    goal("x".repeat(4001));
    start();
    await screen.findByText("The goal is longer than 4000 characters.");
    expect(posts()).toHaveLength(0);
  });

  it("a double click posts once and disables the controls while in flight; Esc and ✕ are ignored meanwhile", async () => {
    let release: (r: Response) => void = () => undefined;
    install(() => new Promise<Response>((r) => (release = r)));
    const { onClose, onStarted } = mount();
    await pick();
    goal();
    const submit = screen.getByTestId("start-submit") as HTMLButtonElement;
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(posts()).toHaveLength(1);
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("start-team-dialog-close"));
    fireEvent.click(screen.getByTestId("start-team-dialog-overlay"));
    expect(onClose).not.toHaveBeenCalled();
    release(resp({ teamId: "t_9" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onStarted).toHaveBeenCalledWith("t_9");
  });

  it("Esc, ✕ and the backdrop cancel without a POST when idle", async () => {
    const { onClose } = mount();
    await screen.findByTestId("start-template-list");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("start-team-dialog-close"));
    fireEvent.click(screen.getByTestId("start-team-dialog-overlay"));
    fireEvent.click(screen.getByTestId("start-cancel"));
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(posts()).toHaveLength(0);
  });

  it.each([
    [403, { error: "forbidden" }, "You are not allowed to start a team here."],
    [409, { error: "team_cap_reached" }, "Too many teams are active. Close one first."],
    [400, { error: "project_untrusted" }, "This project is not trusted, so its templates cannot be used."],
    [500, { error: "internal_error" }, "The team could not be started."],
  ])("status %i → error text, the dialog stays and Start can be retried", async (status, body, text) => {
    install(async () => resp(body, status));
    const { onClose } = mount();
    await pick();
    goal();
    start();
    expect((await screen.findByTestId("start-error")).textContent).toBe(text);
    expect((screen.getByTestId("start-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => resp({ teamId: "t_2" }));
    start();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(posts()).toHaveLength(2);
  });

  it("a network failure shows the connection error and can be retried", async () => {
    install(async () => {
      throw new TypeError("offline");
    });
    mount();
    await pick();
    goal();
    start();
    expect((await screen.findByTestId("start-error")).textContent).toBe("The server could not be reached. Check the connection and try again.");
  });

  it("trims the goal and sends only template, goal and cwd on the first attempt", async () => {
    mount();
    await pick();
    goal("  do it  ");
    start();
    await waitFor(() => expect(posts()).toEqual([{ template: "review-pr", goal: "do it", cwd: "/repo/a" }]));
  });
});

describe("hook confirmation (F2, S15)", () => {
  const untrusted = (hash = "h1", commands: Array<{ event: string; command: string; timeoutMs?: number }> = [{ event: "TaskCompleted", command: HOOK_CMD, timeoutMs: 5000 }]) => resp({ error: "hooks_untrusted", details: { hash, commands } }, 409);

  it("lists the exact commands as literal text; Allow retries with the shown hash", async () => {
    let n = 0;
    install(async () => (n++ === 0 ? untrusted() : resp({ teamId: "t_1" })));
    const { onClose } = mount();
    await pick();
    goal();
    start();
    const step = await screen.findByTestId("start-hooks-step");
    const commands = within(step).getAllByTestId("start-hook-command");
    expect(commands.map((c) => c.textContent)).toEqual([HOOK_CMD]);
    expect(commands[0]?.querySelector("img")).toBeNull();
    expect(step.textContent).toContain("When a task is completed");
    expect(step.textContent).toContain("Timeout 5000 ms");
    expect(screen.getByTestId("start-hooks-fingerprint").textContent).toBe("Fingerprint h1");
    expect(document.activeElement).toBe(screen.getByTestId("start-hooks-deny"));
    fireEvent.click(screen.getByTestId("start-hooks-allow"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(posts()).toEqual([
      { template: "review-pr", goal: "ship it", cwd: "/repo/a" },
      { template: "review-pr", goal: "ship it", cwd: "/repo/a", trustHooks: "h1" },
    ]);
  });

  it("Do not allow sends nothing and returns to the form", async () => {
    install(async () => untrusted());
    mount();
    await pick();
    goal();
    start();
    fireEvent.click(await screen.findByTestId("start-hooks-deny"));
    expect(await screen.findByTestId("start-form")).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it("hash_mismatch on the confirmation returns to the form with the changed notice and no team", async () => {
    let n = 0;
    install(async () => (n++ === 0 ? untrusted() : resp({ error: "hash_mismatch" }, 409)));
    const { onClose } = mount();
    await pick();
    goal();
    start();
    fireEvent.click(await screen.findByTestId("start-hooks-allow"));
    expect((await screen.findByTestId("start-error")).textContent).toBe("The hook commands changed since you reviewed them. Review them again.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("start-form")).toBeTruthy();
  });

  it("a different hash after the confirmation re-opens the step with the changed notice and the new commands", async () => {
    let n = 0;
    install(async () => (n++ === 0 ? untrusted("h1") : untrusted("h2", [{ event: "TaskCreated", command: "make lint" }])));
    mount();
    await pick();
    goal();
    start();
    fireEvent.click(await screen.findByTestId("start-hooks-allow"));
    await screen.findByTestId("start-hooks-changed");
    expect(screen.getByTestId("start-hooks-fingerprint").textContent).toBe("Fingerprint h2");
    expect(screen.getAllByTestId("start-hook-command").map((c) => c.textContent)).toEqual(["make lint"]);
  });

  it("malformed hooks_untrusted details fall back to the generic error (never an empty confirmation)", async () => {
    install(async () => resp({ error: "hooks_untrusted", details: { hash: 5 } }, 409));
    mount();
    await pick();
    goal();
    start();
    expect((await screen.findByTestId("start-error")).textContent).toBe("The team could not be started.");
    expect(screen.queryByTestId("start-hooks-step")).toBeNull();
  });
});

describe("F8 — no raw key rendered", () => {
  it.each(["en", "zh-CN", "hu", "fr"])("every visible string is translated in %s", async (language) => {
    let n = 0;
    install(async () => (n++ === 0 ? resp({ error: "hooks_untrusted", details: { hash: "h", commands: [{ event: "TeammateIdle", command: "x", timeoutMs: 1 }] } }, 409) : resp({ error: "team_cap_reached" }, 409)));
    mount({ folderLabel: "F" }, language);
    await screen.findByTestId("start-template-list");
    start(); // validation errors
    await screen.findAllByRole("alert");
    const noRawKey = () => {
      const text = screen.getByTestId("start-team-dialog").textContent ?? "";
      for (const key of Object.keys(START_TABLES.en)) expect(text, key).not.toContain(key);
    };
    noRawKey();
    await pick();
    goal();
    start();
    await screen.findByTestId("start-hooks-step");
    noRawKey();
    fireEvent.click(screen.getByTestId("start-hooks-allow"));
    await screen.findByTestId("start-error");
    noRawKey();
  });
});
