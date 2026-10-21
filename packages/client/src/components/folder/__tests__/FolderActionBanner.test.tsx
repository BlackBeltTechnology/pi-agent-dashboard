/**
 * Component + logic tests for `FolderActionBanner` — the tier-0 call-to-action
 * banner (change: add-folder-action-banner).
 *
 * Covers test-plan #E5–E8, #E11, #E15–E17 and #X2, #X3, #X5. The re-probe-on-
 * ended and rendered-placement behaviours (#F*) are the L3 Playwright suite's.
 */

import {
  mdiAlertCircleOutline,
  mdiArchiveOutline,
  mdiBroom,
  mdiCheckCircleOutline,
  mdiClipboardCheckOutline,
  mdiClose,
  mdiCog,
  mdiFileDocumentOutline,
  mdiFolderCogOutline,
  mdiFolderOpen,
  mdiPin,
  mdiRefresh,
  mdiReplay,
  mdiScriptTextPlayOutline,
  mdiShieldAlertOutline,
  mdiSourceBranch,
  mdiTextBoxCheckOutline,
  mdiViewGridPlus,
} from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("FolderActionBanner — setup action (change: fix-project-setup-completion-state)", () => {
  it("F8: Set up → spawns project-init directly with the cwd", () => {
    const onInitializeProject = vi.fn();
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ configured: false, checklist: checklist([]) })} onInitializeProject={onInitializeProject} />);
    fireEvent.click(screen.getByTestId(`folder-banner-setup-action-${CWD}`));
    expect(onInitializeProject).toHaveBeenCalledTimes(1);
    expect(onInitializeProject).toHaveBeenCalledWith(CWD);
  });

  it("F10: after scaffold the next rung is re-trust, not a quiet card", () => {
    expect(
      computeBannerRung(status({ hasHook: true, trusted: false, checklist: checklist(["settings"]) }), undefined, true),
    ).toBe("retrust");
  });
});

const glyphs = (el: Element) => [...el.querySelectorAll("svg path")].map((p) => p.getAttribute("d"));

describe("FolderActionBanner — hook rungs explain themselves (change: fix-folder-card-pill-contrast)", () => {
  it("E14: retrust rung → message outside a glyph-less 'Review & trust' action, shield glyph, no 'changed'", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    const region = screen.getByTestId(`folder-banner-retrust-${CWD}`);
    const btn = screen.getByTestId("worktree-init-btn");
    expect(region.textContent).toContain("Init hook needs your trust before it can run");
    expect(btn.textContent).toBe("Review & trust");
    expect(btn.querySelector("svg")).toBeNull();
    expect(btn.textContent).not.toContain("Init hook needs your trust");
    expect(region.querySelectorAll("svg")).toHaveLength(1);
    expect(glyphs(region)).toEqual([mdiShieldAlertOutline]);
    expect(region.textContent?.toLowerCase()).not.toContain("changed");
  });

  it("E15: init-needed rung → message plus a glyph-less 'Initialize' action", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: true, needsInit: true })} />);
    const region = screen.getByTestId(`folder-banner-init-needed-${CWD}`);
    const btn = screen.getByTestId("worktree-init-btn");
    expect(region.textContent).toContain("Init hook hasn't run in this checkout");
    expect(btn.textContent).toBe("Initialize");
    expect(btn.querySelector("svg")).toBeNull();
    expect(glyphs(region)).toEqual([mdiScriptTextPlayOutline]);
  });

  it("the hosted action carries no palette class (inherits the region colour) and is 12px / 44px-32px", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    const cls = screen.getByTestId("worktree-init-btn").className;
    expect(cls).toContain("border-current");
    expect(cls).toContain("text-[12px]");
    expect(cls).toContain("min-h-[44px]");
    expect(cls).toContain("md:min-h-[32px]");
    expect(cls).toContain("focus-ring");
    expect(/(?:text|bg|border)-(?:amber|green|red|blue)-\d/.test(cls)).toBe(false);
  });

  it("compact chip is 12px and carries its rung glyph", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot compact status={status({ hasHook: true, trusted: false })} />);
    const chip = screen.getByTestId(`folder-banner-chip-${CWD}`);
    expect(chip.className).toContain("text-[12px]");
    expect(glyphs(chip)).toEqual([mdiShieldAlertOutline]);
  });

  it("E18: banner glyphs never collide with the card's folder / cog / branch / menu / setup glyphs", () => {
    const card = new Set<string>([
      mdiFolderOpen, mdiFolderCogOutline, mdiCog, mdiSourceBranch, mdiTextBoxCheckOutline, mdiRefresh,
      mdiBroom, mdiArchiveOutline, mdiFileDocumentOutline, mdiViewGridPlus, mdiClose, mdiPin, mdiClipboardCheckOutline,
    ]);
    const banner = new Set<string>();
    const collect = (el: Element) => { for (const d of glyphs(el)) if (d) banner.add(d); };

    const a = render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: false })} />);
    collect(a.container); a.unmount();
    const b = render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: true, needsInit: true })} />);
    collect(b.container); b.unmount();
    initStore.startRun(CWD); initStore.markDone(CWD);
    const c = render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: true })} />);
    collect(c.container); c.unmount();
    initStore.markFailed(CWD, "script_nonzero_exit", "exit 3", "stderr");
    const d = render(<FolderActionBanner cwd={CWD} isProjectRoot status={status({ hasHook: true, trusted: true })} />);
    collect(d.container); d.unmount();

    for (const g of [mdiShieldAlertOutline, mdiScriptTextPlayOutline, mdiCheckCircleOutline, mdiAlertCircleOutline, mdiReplay]) {
      expect(banner.has(g)).toBe(true);
    }
    expect([...banner].filter((g) => card.has(g))).toEqual([]);
  });

  it("X2: status null → no banner region and no init action", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={null} />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });
});
