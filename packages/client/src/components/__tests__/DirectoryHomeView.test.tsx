/**
 * Tests for DirectoryHomeView — the bare `/folder/:encodedCwd` pre-session pane.
 * Covers: spawn-mode adapter + defaults/tags (E18), empty prompt (E20), starter
 * cards (E16/E17/F18), run-location chip (E19), in-flight/double-send/failure
 * re-enable (F7/F8/F9), worktree flow (F10/F11), first-visit Split (F17), content.
 * See changes: add-directory-home-page, redesign-directory-home-split.
 */
import type { CommandInfo, ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { folderPaneId } from "../../lib/layout/folder-pane-id.js";
import { scopedSession } from "../access-grant/__tests__/yolo-test-server.js";
import { DirectoryHomeView } from "../folder/DirectoryHomeView.js";
import { FolderSplitProvider } from "../folder/FolderSplitProvider.js";

// The heavy editor pane and the git-backed dialog are out of scope here.
vi.mock("../editor-pane/EditorPane.js", () => ({ EditorPane: () => <div data-testid="editor-pane-stub" /> }));
vi.mock("../worktree/WorktreeSpawnDialog.js", () => ({
  WorktreeSpawnDialog: (p: {
    cwd: string;
    onSpawnStart?: (c: string) => void;
    onSpawnAbort?: (c: string) => void;
    onSpawn: (path: string, opts?: { gitWorktreeBase?: string }) => void;
  }) => (
    <div data-testid="wt-dialog">
      <button type="button" data-testid="wt-start" onClick={() => p.onSpawnStart?.(p.cwd)} />
      <button type="button" data-testid="wt-spawn" onClick={() => p.onSpawn("/wt", { gitWorktreeBase: "develop" })} />
      <button type="button" data-testid="wt-abort" onClick={() => p.onSpawnAbort?.(p.cwd)} />
    </div>
  ),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  // ModelSelector probes /api/roles on open; keep it inert.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers(), json: async () => ({}) }));
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Wrap({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

type Props = React.ComponentProps<typeof DirectoryHomeView>;

function renderView(overrides: Partial<Props> = {}) {
  const onSpawnSession = vi.fn<NonNullable<Props["onSpawnSession"]>>().mockReturnValue("req-1");
  const props: Props = { cwd: "/a", onSpawnSession, ...overrides };
  const utils = render(
    <Wrap>
      <DirectoryHomeView {...props} />
    </Wrap>,
  );
  return { onSpawnSession: (overrides.onSpawnSession ?? onSpawnSession) as ReturnType<typeof vi.fn>, props, ...utils };
}

const typePrompt = (text: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
const send = () => fireEvent.click(screen.getByTestId("send-button"));
const draft = () => (screen.getByRole("textbox") as HTMLTextAreaElement).value;

const skill = (n: string, scope: "folder" | "global" = "global", description?: string): CommandInfo =>
  ({ name: `skill:${n}`, source: "skill", scope, ...(description ? { description } : {}) }) as CommandInfo;
const prompt = (n: string): CommandInfo => ({ name: n, source: "prompt", scope: "folder" }) as CommandInfo;

describe("spawn-mode adapter", () => {
  it("send calls handleSpawnSession(cwd, undefined, { initialPrompt }) — 2nd arg is undefined", () => {
    const { onSpawnSession } = renderView({ cwd: "/a" });
    typePrompt("do X");
    send();
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    expect(onSpawnSession).toHaveBeenCalledWith("/a", undefined, { initialPrompt: "do X" });
    expect(onSpawnSession.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("E20: empty / whitespace-only prompt never spawns", () => {
    const { onSpawnSession } = renderView();
    typePrompt("   \n\t");
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(true);
    send();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSpawnSession).not.toHaveBeenCalled();
  });
});

describe("E18: model / thinking defaults", () => {
  it("(a) default model + thinking: sent explicitly, both chips tagged default", () => {
    const { onSpawnSession } = renderView({ defaultModel: "anthropic/claude-opus-5-5", defaultThinkingLevel: "medium" });
    expect(screen.getByTestId("model-tag").textContent).toBe("default");
    expect(screen.getByTestId("thinking-tag").textContent).toBe("default");
    typePrompt("hi");
    send();
    expect(onSpawnSession).toHaveBeenCalledWith("/a", undefined, {
      initialPrompt: "hi",
      model: "anthropic/claude-opus-5-5",
      thinkingLevel: "medium",
    });
  });

  it("(b) default model without thinking default: model only", () => {
    const { onSpawnSession } = renderView({ defaultModel: "anthropic/claude-opus-5-5" });
    typePrompt("hi");
    send();
    const opts = onSpawnSession.mock.calls[0]?.[2];
    expect(opts).toEqual({ initialPrompt: "hi", model: "anthropic/claude-opus-5-5" });
    expect(opts).not.toHaveProperty("thinkingLevel");
  });

  it("(c) no defaults: chip reads pi default and neither field is sent", () => {
    const { onSpawnSession } = renderView();
    expect(screen.getByTestId("model-selector-button").textContent).toContain("pi default");
    typePrompt("hi");
    send();
    const opts = onSpawnSession.mock.calls[0]?.[2];
    expect(opts).not.toHaveProperty("model");
    expect(opts).not.toHaveProperty("thinkingLevel");
  });

  it("(d) catalogue unavailable but a default model is configured: chip shows it and it is sent", () => {
    const { onSpawnSession } = renderView({ defaultModel: "anthropic/claude-opus-5-5", models: [] });
    expect(screen.getByTestId("model-selector-button").textContent).toContain("anthropic/claude-opus-5-5");
    typePrompt("hi");
    send();
    expect(onSpawnSession.mock.calls[0]?.[2]).toMatchObject({ model: "anthropic/claude-opus-5-5" });
  });

  it("a picked model replaces the default (and loses the default tag)", () => {
    const models: ModelInfo[] = [
      { provider: "anthropic", id: "claude-opus-5-5" },
      { provider: "deepseek", id: "deepseek-flash" },
    ];
    const { onSpawnSession } = renderView({ defaultModel: "anthropic/claude-opus-5-5", models });
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const row = screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("deepseek-flash"));
    fireEvent.click(row as HTMLElement);
    expect(screen.queryByTestId("model-tag")).toBeNull();
    typePrompt("hi");
    send();
    expect(onSpawnSession.mock.calls[0]?.[2]).toMatchObject({ model: "deepseek/deepseek-flash" });
  });
});

describe("E19: run-location chip", () => {
  it("is shown only for a git folder", () => {
    renderView({ folderGitMap: new Map([["/a", "/a"]]) });
    expect(screen.getByTestId("run-location")).toBeTruthy();
    cleanup();
    renderView({ folderGitMap: new Map([["/a", null]]) });
    expect(screen.queryByTestId("run-location")).toBeNull();
    cleanup();
    renderView({ folderGitMap: new Map() });
    expect(screen.queryByTestId("run-location")).toBeNull();
  });
});

describe("starter cards", () => {
  const commands = [
    skill("xlsx", "global", "Spreadsheets"),
    skill("document-organizer", "folder"),
    skill("doc-summarizer", "global", "Summarize"),
    prompt("weekly-review"),
  ];

  it("E16: 0/1/6/9 commands → 0/1/6/6 cards, folder skills → prompts → global skills", () => {
    renderView({ commands: [] });
    expect(screen.queryAllByTestId(/^starter-card-/)).toHaveLength(0);
    cleanup();
    renderView({ commands: [skill("one")] });
    expect(screen.queryAllByTestId(/^starter-card-/)).toHaveLength(1);
    cleanup();
    renderView({ commands: Array.from({ length: 6 }, (_, i) => skill(`s${i}`)) });
    expect(screen.queryAllByTestId(/^starter-card-/)).toHaveLength(6);
    cleanup();
    renderView({ commands: Array.from({ length: 9 }, (_, i) => skill(`s${i}`)) });
    expect(screen.queryAllByTestId(/^starter-card-/)).toHaveLength(6);
    cleanup();
    renderView({ commands });
    expect(screen.getAllByTestId(/^starter-card-/).map((c) => c.getAttribute("data-testid"))).toEqual([
      "starter-card-skill:document-organizer",
      "starter-card-weekly-review",
      "starter-card-skill:xlsx",
      "starter-card-skill:doc-summarizer",
    ]);
  });

  it("builtin / extension commands are never starters", () => {
    renderView({ commands: [{ name: "compact", source: "builtin" }, { name: "ext", source: "extension" }] as CommandInfo[] });
    expect(screen.queryAllByTestId(/^starter-card-/)).toHaveLength(0);
  });

  it("E17: card inserts the invocation per the draft table, caret at end, never sends", () => {
    const table: Array<[string, string]> = [
      ["", "/skill:doc-summarizer "],
      ["summarize 2025", "/skill:doc-summarizer summarize 2025"],
      ["/skill:xlsx clean", "/skill:doc-summarizer clean"],
      ["/", "/skill:doc-summarizer "],
    ];
    for (const [before, after] of table) {
      const { onSpawnSession, unmount } = renderView({ commands });
      if (before) typePrompt(before);
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      fireEvent.click(screen.getByTestId("starter-card-skill:doc-summarizer"));
      expect(draft(), before).toBe(after);
      const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(ta.selectionStart).toBe(after.length);
      expect(document.activeElement).toBe(ta);
      expect(onSpawnSession).not.toHaveBeenCalled();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("F18: a card click still lands after a rerender with fresh props (no stale closure)", () => {
    const first = [skill("one", "folder")];
    const { rerender, props } = renderView({ commands: first });
    const next = [skill("two", "folder")];
    rerender(
      <Wrap>
        <DirectoryHomeView {...props} commands={next} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId("starter-card-skill:two"));
    expect(draft()).toBe("/skill:two ");
  });
});

describe("spawn lifecycle", () => {
  it("F7: Enter ×2 + click Start in one tick is exactly one spawn", () => {
    const { onSpawnSession } = renderView();
    typePrompt("go");
    const ta = screen.getByRole("textbox");
    fireEvent.keyDown(ta, { key: "Enter" });
    fireEvent.keyDown(ta, { key: "Enter" });
    send();
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("F8: a failure for THIS request re-enables Start and restores the draft; another id does not", () => {
    const { props, rerender } = renderView();
    typePrompt("keep me");
    send();
    expect(draft()).toBe("");
    const rerenderWith = (failedSpawn: Props["failedSpawn"]) =>
      rerender(
        <Wrap>
          <DirectoryHomeView {...props} failedSpawn={failedSpawn} />
        </Wrap>,
      );
    rerenderWith({ requestId: "other", seq: 1 });
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    rerenderWith({ requestId: "req-1", seq: 2 });
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", false);
    expect(draft()).toBe("keep me");
    typePrompt("keep me");
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F9: the page itself never navigates", () => {
    const { hook, history } = memoryLocation({ path: "/start", record: true });
    const onSpawnSession = vi.fn().mockReturnValue("req-1");
    render(
      <Router hook={hook}>
        <DirectoryHomeView cwd="/a" onSpawnSession={onSpawnSession} />
      </Router>,
    );
    typePrompt("x");
    send();
    expect(history).toEqual(["/start"]);
  });

  it("F10: worktree flow issues exactly one spawn for the worktree path with prompt and model", () => {
    const onWorktreeSpawnStart = vi.fn();
    const onWorktreeSpawned = vi.fn();
    const { onSpawnSession } = renderView({
      folderGitMap: new Map([["/a", "/a"]]),
      defaultModel: "anthropic/m",
      onWorktreeSpawnStart,
      onWorktreeSpawned,
    });
    typePrompt("x");
    fireEvent.change(screen.getByTestId("run-location"), { target: { value: "worktree" } });
    fireEvent.click(screen.getByTestId("wt-start"));
    fireEvent.click(screen.getByTestId("wt-spawn"));
    expect(onWorktreeSpawnStart).toHaveBeenCalledWith("/a");
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    expect(onSpawnSession).toHaveBeenCalledWith("/wt", undefined, {
      initialPrompt: "x",
      model: "anthropic/m",
      placeholderCwd: "/a",
      gitWorktreeBase: "develop",
    });
    expect(onWorktreeSpawned).toHaveBeenCalledWith("/wt");
  });

  it("F11: aborted worktree dialog re-enables Start, keeps the draft, spawns nothing", () => {
    const onWorktreeSpawnAbort = vi.fn();
    const { onSpawnSession } = renderView({ folderGitMap: new Map([["/a", "/a"]]), onWorktreeSpawnAbort });
    typePrompt("x");
    fireEvent.change(screen.getByTestId("run-location"), { target: { value: "worktree" } });
    fireEvent.click(screen.getByTestId("wt-start"));
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("wt-abort"));
    expect(onWorktreeSpawnAbort).toHaveBeenCalledWith("/a");
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", false);
    expect(draft()).toBe("x");
    expect(onSpawnSession).not.toHaveBeenCalled();
  });
});

describe("content", () => {
  it("renders header, starters region and prompt — and no session list or quick actions", () => {
    renderView({ cwd: "/home/u/proj", commands: [skill("one", "folder")] });
    expect(screen.getByTestId("directory-home-header").textContent).toBe("proj");
    expect(screen.getByTestId("directory-home-prompt")).toBeTruthy();
    expect(screen.queryByTestId("directory-home-session-list")).toBeNull();
    expect(screen.queryByTestId("directory-home-open-terminals")).toBeNull();
    expect(screen.queryByTestId("directory-home-open-editor")).toBeNull();
    expect(screen.queryByTestId("directory-home-open-settings")).toBeNull();
    // No onboarding LandingPage surface leaks into the folder home.
    expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
  });

  it("F5-unit: the header gear opens the folder settings", () => {
    const onOpenSettings = vi.fn();
    renderView({ cwd: "/a", onOpenSettings });
    fireEvent.click(screen.getByTestId("directory-home-settings"));
    expect(onOpenSettings).toHaveBeenCalledWith("/a");
  });

  it("an empty folder focuses the prompt", () => {
    renderView({ sessionCount: 0 });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("a cwd that is neither pinned nor a workspace member still renders (no eligibility guard)", () => {
    renderView({ cwd: "/loose" });
    expect(screen.getByTestId("directory-home-prompt")).toBeTruthy();
    expect(screen.queryByTestId("directory-home-not-pinned")).toBeNull();
  });

  it("the `/` popover marks a scan-origin list as from disk", () => {
    renderView({ commands: [skill("xlsx")], commandsOrigin: "scan" });
    typePrompt("/");
    expect(screen.getByTestId("command-dropdown-origin").textContent).toMatch(/from disk/);
  });
});

describe("folder split host (F17)", () => {
  it("first visit with nothing stored opens in Split; both panes render, with the layout switch", () => {
    render(
      <Wrap>
        <FolderSplitProvider cwd="/a">
          <DirectoryHomeView cwd="/a" onSpawnSession={vi.fn()} />
        </FolderSplitProvider>
      </Wrap>,
    );
    expect(screen.getByTestId("split-chat-pane")).toBeTruthy();
    expect(screen.getByTestId("split-editor-pane")).toBeTruthy();
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toMatch(/Split/);
  });

  it("a stored layout wins over the Split default", () => {
    localStorage.setItem(
      `pi-dashboard:split:${folderPaneId("/a")}`,
      JSON.stringify({ mode: "full", ratio: 0.5, orientation: "h" }),
    );
    render(
      <Wrap>
        <FolderSplitProvider cwd="/a">
          <DirectoryHomeView cwd="/a" onSpawnSession={vi.fn()} />
        </FolderSplitProvider>
      </Wrap>,
    );
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toMatch(/Editor/);
    // Chat pane stays mounted (hidden), so the draft survives a mode round-trip.
    expect(screen.getByTestId("split-chat-pane").className).toContain("hidden");
    act(() => {});
  });
});

describe("composer dock footer (F15)", () => {
  afterEach(() => {
    yoloStatus.publish({ available: true, durationsMinutes: [15], session: null });
  });

  it("YOLO active for the folder: a dock with only the footer sits directly above the composer card", () => {
    yoloStatus.publish({ available: true, durationsMinutes: [15], session: scopedSession(Date.now(), "/a") });
    renderView({ cwd: "/a" });
    const dock = screen.getByTestId("composer-dock");
    expect(dock.getAttribute("data-footer-only")).toBe("true");
    expect(dock.querySelector('[data-testid="composer-dock-scroll"]')).toBeNull();
    expect(dock.querySelector('[data-testid="yolo-composer-strip"]')).not.toBeNull();
    expect(dock.nextElementSibling).toBe(screen.getByTestId("composer-root"));
  });

  it("no YOLO for the folder: no dock renders", () => {
    renderView({ cwd: "/a" });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });
});
