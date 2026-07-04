/**
 * Resources surface activation toggle + one-click reload.
 * See change: folder-resource-activation-toggle.
 */

import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiResourcesView } from "../PiResourcesView.js";

afterEach(() => cleanup());

const mockData: PiResourcesResult = {
  local: {
    extensions: [],
    skills: [{ name: "loc-skill", filePath: "/p/.pi/skills/loc-skill.md", type: "skill", enabled: true }],
    prompts: [],
  },
  global: {
    extensions: [],
    skills: [{ name: "glob-skill", filePath: "/g/.pi/agent/skills/glob-skill.md", type: "skill", enabled: true }],
    prompts: [],
  },
  packages: [],
};

const toggleCalls: any[] = [];
const reloadCalls: any[] = [];

beforeEach(() => {
  toggleCalls.length = 0;
  reloadCalls.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/api/resources/toggle")) {
      toggleCalls.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { affectedSessions: ["s1"] } }) } as any);
    }
    if (u.includes("/api/resources/reload")) {
      reloadCalls.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { reloaded: 1 } }) } as any);
    }
    if (u.includes("/api/pi-resources")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockData }) } as any);
    }
    // Installed-packages + anything else: benign empty.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: [] }) } as any);
  });
});

afterEach(() => vi.restoreAllMocks());

async function openSkillsIn(sectionTestId: string) {
  const section = await screen.findByTestId(sectionTestId);
  fireEvent.click(section.querySelector("button")!); // expand scope
  const skillsBtn = Array.from(section.querySelectorAll("button")).find((b) => /^Skills/i.test(b.textContent?.trim() ?? ""));
  if (skillsBtn) fireEvent.click(skillsBtn);
  return section;
}

describe("PiResourcesView — activation toggle", () => {
  it("toggles a local skill row: POSTs scope=local and flips row state", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const section = await openSkillsIn("scope-local");
    const toggle = within(section).getByTestId("resource-activation-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggleCalls[0]).toMatchObject({
      scope: "local",
      cwd: "/p",
      type: "skill",
      filePath: "/p/.pi/skills/loc-skill.md",
      enabled: false,
    });
    // Optimistic flip.
    await waitFor(() => expect(within(section).getByTestId("resource-activation-toggle").getAttribute("aria-checked")).toBe("false"));
  });

  it("toggles a global skill row with scope=global (no cwd)", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const section = await openSkillsIn("scope-global");
    const toggle = within(section).getByTestId("resource-activation-toggle");
    fireEvent.click(toggle);
    expect(toggleCalls[0]).toMatchObject({ scope: "global", type: "skill", enabled: false });
    expect(toggleCalls[0].cwd).toBeUndefined();
  });

  it("shows a one-click reload button after a toggle and hides it after reload", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const section = await openSkillsIn("scope-local");
    fireEvent.click(within(section).getByTestId("resource-activation-toggle"));

    const reloadBtn = await screen.findByTestId("resource-reload-button");
    expect(reloadBtn.textContent).toContain("Reload 1 session");

    fireEvent.click(reloadBtn);
    expect(reloadCalls[0]).toMatchObject({ scope: "local", cwd: "/p" });
    await waitFor(() => expect(screen.queryByTestId("resource-reload-banner")).toBeNull());
  });
});
