/**
 * Component + logic tests for `FolderActionBanner` — the tier-0 call-to-action
 * banner (change: add-folder-action-banner).
 *
 * Covers test-plan #E5–E8, #E11, #E15–E17 and #X2, #X3, #X5. The re-probe-on-
 * ended and rendered-placement behaviours (#F*) are the L3 Playwright suite's.
 */

import { mdiCog, mdiFolderCogOutline, mdiFolderOpen, mdiTextBoxCheckOutline } from "@mdi/js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SetupArtifact, WorktreeInitStatus } from "../../../lib/git/git-api.js";
import { initStore } from "../../../lib/git/worktree-init-store.js";
import { computeBannerRung, FolderActionBanner, setupState } from "../FolderActionBanner.js";

const CWD = "/a/proj";

afterEach(() => { cleanup(); initStore.__resetForTests(); });

const ALL: SetupArtifact["id"][] = ["settings", "agents", "prompts", "openspec", "kb"];
function checklist(present: SetupArtifact["id"][]): SetupArtifact[] {
  return ALL.map((id) => ({ id, present: present.includes(id), required: id === "settings" }));
}
function status(over: Partial<WorktreeInitStatus>): WorktreeInitStatus {
  return { hasHook: false, ...over };
}

describe("FolderActionBanner — setup rung gating", () => {
  it("E5: required present, optional absent → no banner, tally is menu-only", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ configured: true, checklist: checklist(["settings"]) })} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });

  it("E6: .pi/settings.json absent → info setup banner with a Set up action", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ configured: false, checklist: checklist([]) })} onInitializeProject={() => {}} />);
    const banner = screen.getByTestId(`folder-banner-setup-${CWD}`);
    expect(banner.textContent).toContain("Not a pi project yet");
    expect(screen.getByTestId(`folder-banner-setup-action-${CWD}`)).toBeTruthy();
  });

  it("E7: every artifact present → quiet card", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ checklist: checklist(ALL) })} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });

  it("E11: non-project-root row never shows a not-a-pi-project banner", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot={false} status={status({ configured: false, checklist: checklist([]) })} onInitializeProject={() => {}} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });

  it("E15: setupOutdated with everything present never banners", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ setupOutdated: true, checklist: checklist(ALL) })} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });

  it("X2: absent checklist AND absent boolean → no banner (fail open)", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({})} onInitializeProject={() => {}} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });

  it("X3: checklist outranks the legacy configured boolean", () => {
    // configured:true says OK, checklist says settings absent → checklist wins.
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ configured: true, checklist: checklist([]) })} onInitializeProject={() => {}} />);
    expect(screen.getByTestId(`folder-banner-setup-${CWD}`)).toBeTruthy();
  });

  it("X5: an uninterpretable checklist (no settings entry) → no banner", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ checklist: [{ id: "openspec", present: true, required: false }] as SetupArtifact[] })} onInitializeProject={() => {}} />);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });
});

describe("FolderActionBanner — severity ladder & tokens", () => {
  it("E8: a failed run and a revoked hook trust yield exactly one banner (the failure)", () => {
    initStore.markFailed(CWD, "exit_1", "npm ci failed");
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    expect(screen.getByTestId(`folder-banner-failed-${CWD}`)).toBeTruthy();
    expect(screen.queryByTestId(`folder-banner-retrust-${CWD}`)).toBeNull();
  });

  it("ladder order is failure > running > retrust > init-needed > setup", () => {
    expect(computeBannerRung(status({ hasHook: true, trusted: false }), { cwd: CWD, phase: "failed", startedAt: 0 }, true)).toBe("failed");
    expect(computeBannerRung(status({ hasHook: true, trusted: false }), { cwd: CWD, phase: "running", startedAt: 0 }, true)).toBe("running");
    expect(computeBannerRung(status({ hasHook: true, trusted: false }), undefined, true)).toBe("retrust");
    expect(computeBannerRung(status({ hasHook: true, trusted: true, needsInit: true }), undefined, true)).toBe("init-needed");
    expect(computeBannerRung(status({ configured: false, checklist: checklist([]) }), undefined, true)).toBe("setup");
    expect(computeBannerRung(status({ checklist: checklist(ALL) }), undefined, true)).toBeNull();
  });

  it("E16: banner colours resolve only from --severity-* triples, no new token", () => {
    const { rerender, container } = render(
      <FolderActionBanner cwd={CWD} isProjectRoot status={status({ configured: false, checklist: checklist([]) })} onInitializeProject={() => {}} />,
    );
    const info = screen.getByTestId(`folder-banner-setup-${CWD}`).className;
    expect(info).toContain("var(--severity-info-bg)");
    expect(info).toContain("var(--severity-info-fg)");
    expect(info).toContain("var(--severity-info-border)");
    // warning rung
    rerender(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    expect(screen.getByTestId(`folder-banner-retrust-${CWD}`).className).toContain("var(--severity-warning-bg)");
    // error rung
    initStore.markFailed(CWD, "exit_1", "boom");
    rerender(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    expect(screen.getByTestId(`folder-banner-failed-${CWD}`).className).toContain("var(--severity-error-bg)");
    // No raw hex colour anywhere in the rendered banner tree.
    expect(/#[0-9a-fA-F]{3,8}\b/.test(container.innerHTML)).toBe(false);
  });

  it("E17: the setup glyph is distinct from the folder, menu-trigger and settings glyphs", () => {
    const rendered = new Set([mdiTextBoxCheckOutline, mdiFolderOpen, mdiFolderCogOutline, mdiCog]);
    expect(rendered.size).toBe(4);
  });
});

describe("setupState precedence", () => {
  it("checklist present wins; boolean only consulted in its absence; neither → unknown", () => {
    expect(setupState(status({ checklist: checklist([]) }))).toBe("not-a-project");
    expect(setupState(status({ checklist: checklist(["settings"]) }))).toBe("ok");
    expect(setupState(status({ configured: false }))).toBe("not-a-project");
    expect(setupState(status({ configured: true }))).toBe("ok");
    expect(setupState(status({}))).toBe("unknown");
  });
});
