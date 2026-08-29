/**
 * FolderOpenSpecSection — readiness-driven variants (add-openspec-init-affordances).
 *
 * The retired gate (`initialized || pending`) made the two states a user must
 * act on (ABSENT, BROKEN) the two states with no affordance. These scenarios
 * pin the one-line pill variants: the ABSENT offer (+dismiss), the reason-keyed
 * recovery actions, the cli-failed no-action rule, and the config-write /
 * init / update wiring behind them.
 *
 * Specs: openspec/changes/add-openspec-init-affordances/specs/
 *   openspec-folder-section (state-specific recovery action),
 *   folder-actions-menu (dismiss → opt-out).
 */

import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";

const CWD = "/project/foo";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.startsWith("/api/config")) {
        return new Response(
          JSON.stringify({ success: true, data: { openspec: { enabled: true, optOutDirectories: ["/other"], offerInitialization: true } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function data(over: Partial<OpenSpecData>): OpenSpecData {
  return { initialized: true, changes: [], ...over };
}

function lastCall(): { url: string; method: string; body: Record<string, any> } {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  const init = (last[1] ?? {}) as RequestInit;
  return {
    url: String(last[0]),
    method: init.method ?? "GET",
    body: init.body ? JSON.parse(init.body as string) : {},
  };
}

describe("FolderOpenSpecSection — ABSENT offer", () => {
  it("renders a not-set-up pill with Initialize + dismiss and NO count or board link", () => {
    render(
      <FolderOpenSpecSection cwd={CWD} data={data({ initialized: false, readiness: { state: "ABSENT" } })} />,
    );
    expect(screen.getByTestId("folder-openspec-initialize")).toBeTruthy();
    expect(screen.getByTestId("folder-openspec-dismiss")).toBeTruthy();
    expect(screen.queryByTestId("folder-openspec-count")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-open-board")).toBeNull();
  });

  it("renders nothing for ABSENT when offerInitialization is false (fleet switch)", () => {
    const { container } = render(
      <FolderOpenSpecSection
        cwd={CWD}
        offerInitialization={false}
        data={data({ initialized: false, readiness: { state: "ABSENT" } })}
      />,
    );
    expect(container.querySelector("[data-testid^='folder-openspec']")).toBeNull();
  });

  it("Initialize posts /api/openspec/init without a confirm flag (nothing to overwrite)", async () => {
    render(
      <FolderOpenSpecSection cwd={CWD} data={data({ initialized: false, readiness: { state: "ABSENT" } })} />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-initialize"));
    await waitFor(() => expect(lastCall().url).toBe("/api/openspec/init"));
    expect(lastCall().method).toBe("POST");
    expect(lastCall().body).toEqual({ cwd: CWD });
  });

  it("dismiss opts the cwd out via PUT /api/config (cwd ADDED to optOutDirectories)", async () => {
    render(
      <FolderOpenSpecSection cwd={CWD} data={data({ initialized: false, readiness: { state: "ABSENT" } })} />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-dismiss"));
    await waitFor(() => expect(lastCall().url).toBe("/api/config"));
    expect(lastCall().method).toBe("PUT");
    expect(lastCall().body).toEqual({ openspec: { optOutDirectories: ["/other", CWD] } });
  });
});

describe("FolderOpenSpecSection — BROKEN variants", () => {
  it("cli-failed renders NO Repair/Initialize and shows the error label — and no dead focusable control", () => {
    const { container } = render(
      <FolderOpenSpecSection
        cwd={CWD}
        data={data({ initialized: false, readiness: { state: "BROKEN", reason: "cli-failed" } })}
      />,
    );
    expect(screen.getByText("OpenSpec command failed")).toBeTruthy();
    expect(screen.queryByTestId("folder-openspec-repair")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-initialize")).toBeNull();
    // D7: nothing focusable-but-inert inside the section.
    const section = container.querySelector("[data-testid^='folder-openspec']");
    expect(section?.querySelectorAll("button, [role='button'], [tabindex]:not([tabindex='-1'])").length).toBe(0);
  });

  it("missing-changes-dir Repair opens a confirm naming the directory; dismissing sends NO request", async () => {
    render(
      <FolderOpenSpecSection
        cwd={CWD}
        data={data({ initialized: false, readiness: { state: "BROKEN", reason: "missing-changes-dir" } })}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-repair"));
    expect(screen.getByTestId("openspec-repair-confirm")).toBeTruthy();
    expect(screen.getByTestId("openspec-repair-confirm").textContent).toContain(CWD);
    fireEvent.click(screen.getByTestId("openspec-repair-cancel"));
    expect(screen.queryByTestId("openspec-repair-confirm")).toBeNull();
    for (const call of (fetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain("/api/openspec/init");
    }
  });

  it("confirming Repair posts /api/openspec/init with confirm:true", async () => {
    render(
      <FolderOpenSpecSection
        cwd={CWD}
        data={data({ initialized: false, readiness: { state: "BROKEN", reason: "missing-changes-dir" } })}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-repair"));
    fireEvent.click(screen.getByTestId("openspec-repair-confirm-action"));
    await waitFor(() => expect(lastCall().url).toBe("/api/openspec/init"));
    expect(lastCall().body).toEqual({ cwd: CWD, confirm: true });
  });
});

describe("FolderOpenSpecSection — STALE variants", () => {
  it("missing-skills renders an Update control posting /api/openspec/update", async () => {
    render(
      <FolderOpenSpecSection
        cwd={CWD}
        data={data({ readiness: { state: "STALE", reason: "missing-skills" } })}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-update"));
    await waitFor(() => expect(lastCall().url).toBe("/api/openspec/update"));
    expect(lastCall().method).toBe("POST");
    expect(lastCall().body).toEqual({ cwd: CWD });
  });

  it("profile-stale renders the same Update control", () => {
    render(
      <FolderOpenSpecSection
        cwd={CWD}
        data={data({ readiness: { state: "STALE", reason: "profile-stale" } })}
      />,
    );
    expect(screen.getByTestId("folder-openspec-update")).toBeTruthy();
  });
});

describe("FolderOpenSpecSection — suppressed states", () => {
  it("GLOBAL_OFF renders nothing", () => {
    const { container } = render(
      <FolderOpenSpecSection cwd={CWD} data={data({ readiness: { state: "GLOBAL_OFF" } })} />,
    );
    expect(container.querySelector("[data-testid^='folder-openspec']")).toBeNull();
  });

  it("OPTED_OUT renders nothing", () => {
    const { container } = render(
      <FolderOpenSpecSection cwd={CWD} data={data({ readiness: { state: "OPTED_OUT" } })} />,
    );
    expect(container.querySelector("[data-testid^='folder-openspec']")).toBeNull();
  });
});

describe("FolderOpenSpecSection — failure surfacing", () => {
  it("an init failure surfaces the CLI stderr through onToast(error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, error: "openspec init exited with code 1", stderr: "boom: no such template" }),
          { status: 500 },
        ),
      ),
    );
    const onToast = vi.fn();
    render(
      <FolderOpenSpecSection
        cwd={CWD}
        onToast={onToast}
        data={data({ initialized: false, readiness: { state: "ABSENT" } })}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-initialize"));
    await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));
    expect(onToast.mock.calls[0][0]).toContain("boom: no such template");
    expect(onToast.mock.calls[0][1]).toBe("error");
  });

  it("an init refusal (openspec/ already present) opens the overwrite confirm naming the directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, error: `refusing to overwrite existing OpenSpec files in ${CWD} without confirmation` }),
          { status: 400 },
        ),
      ),
    );
    render(
      <FolderOpenSpecSection cwd={CWD} data={data({ initialized: false, readiness: { state: "ABSENT" } })} />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-initialize"));
    await waitFor(() => expect(screen.getByTestId("openspec-init-over-confirm")).toBeTruthy());
    expect(screen.getByTestId("openspec-init-over-confirm").textContent).toContain(CWD);
  });
});
