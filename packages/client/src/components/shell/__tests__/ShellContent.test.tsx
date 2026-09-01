/**
 * `ShellContent` — the shell's route-derived content region.
 *
 * The load-bearing property is the one this component was extracted FOR: it
 * must resolve its branch from the AMBIENT wouter location, so a frozen
 * `<Router>` (the `RouteBackedOverlay` underlay) selects the launching surface
 * even while `window.location` points at the overlay. Before the extraction
 * that was impossible — App's body had already fixed the branch against the
 * live URL.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { encodeFolderPath } from "../../../lib/util/folder-encoding.js";
import { ShellContent, type ShellContentRenderers } from "../ShellContent.js";

const CWD = "/work/repo";
const ENC = encodeFolderPath(CWD);

/** Every renderer prints a stable marker so a wrong branch is unambiguous. */
function renderers(): ShellContentRenderers {
  return {
    renderOpenSpecBoard: (cwd) => <div>board:{cwd}</div>,
    renderArchive: (cwd) => <div>archive:{cwd}</div>,
    renderSpecs: (cwd) => <div>specs:{cwd}</div>,
    renderDiff: (id) => <div>diff:{id}</div>,
    renderPiResourceFile: (path, title) => <div>resource:{path}:{title}</div>,
    renderPiResourcesRedirect: (cwd) => <div>redirect:{cwd}</div>,
    renderFolderSettings: (cwd, page) => <div>folder-settings:{cwd}:{page}</div>,
    renderOpenSpecPreview: (cwd, change, artifact) => <div>preview:{cwd}:{change}:{artifact}</div>,
    renderFilePreview: (cwd, path) => <div>file:{cwd}:{path}</div>,
    renderUrlPreview: (url) => <div>url:{url}</div>,
    renderFolderEditor: (cwd) => <div>editor:{cwd}</div>,
    renderFolderHome: (cwd) => <div>home:{cwd}</div>,
    renderSession: (id) => (id === "known" ? <div>session:{id}</div> : null),
    renderLanding: () => <div>landing</div>,
  };
}

function at(location: string, variant: "desktop" | "mobile" = "desktop") {
  const { hook, searchHook } = memoryLocation({
    path: location.split("?")[0],
    searchPath: location.split("?")[1] ?? "",
  });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <ShellContent variant={variant} {...renderers()} />
    </Router>,
  );
}

describe("ShellContent branch selection", () => {
  it("renders the folder home for /folder/:cwd", () => {
    at(`/folder/${ENC}`);
    expect(screen.getByText(`home:${CWD}`)).toBeTruthy();
  });

  it("renders the session chat for /session/:id", () => {
    at("/session/known");
    expect(screen.getByText("session:known")).toBeTruthy();
  });

  it("falls back to the landing page when the session is unknown", () => {
    at("/session/ghost");
    expect(screen.getByText("landing")).toBeTruthy();
  });

  it("renders the landing page for an unmatched route", () => {
    at("/nothing/here");
    expect(screen.getByText("landing")).toBeTruthy();
  });

  it("passes both halves of a query-carrying preview route", () => {
    at(`/folder/${ENC}/view?path=src/a.ts`);
    expect(screen.getByText(`file:${CWD}:src/a.ts`)).toBeTruthy();
  });

  it("resolves /pi-view from the search string", () => {
    at("/pi-view?url=https://example.com");
    expect(screen.getByText("url:https://example.com")).toBeTruthy();
  });

  it("prefers the deeper openspec board route over the folder home", () => {
    at(`/folder/${ENC}/openspec`);
    expect(screen.getByText(`board:${CWD}`)).toBeTruthy();
  });

  it("prefers archive over the board on the deeper path", () => {
    at(`/folder/${ENC}/openspec/archive`);
    expect(screen.getByText(`archive:${CWD}`)).toBeTruthy();
  });

  it("defaults an unknown folder-settings page to packages", () => {
    at(`/folder/${ENC}/settings/bogus`);
    expect(screen.getByText(`folder-settings:${CWD}:packages`)).toBeTruthy();
  });

  it("honours a valid folder-settings page", () => {
    at(`/folder/${ENC}/settings/skills`);
    expect(screen.getByText(`folder-settings:${CWD}:skills`)).toBeTruthy();
  });
});

describe("ShellContent variant divergence (pre-existing, reproduced deliberately)", () => {
  it("gives mobile its own diff branch", () => {
    at("/session/known/diff", "mobile");
    expect(screen.getByText("diff:known")).toBeTruthy();
  });

  it("routes desktop diff through the session chat instead", () => {
    at("/session/known/diff", "desktop");
    expect(screen.getByText("session:known")).toBeTruthy();
  });

  it("gives mobile its own folder-editor branch", () => {
    at(`/folder/${ENC}/editor`, "mobile");
    expect(screen.getByText(`editor:${CWD}`)).toBeTruthy();
  });
});

describe("frozen-underlay derivation (the reason this component exists)", () => {
  it("selects the launching surface from a FROZEN router while the browser URL is the overlay", () => {
    // This is the case the pre-extraction shape could not express: the live URL
    // is /settings, but the pinned router says /folder/:cwd, and the content
    // must follow the pinned one.
    window.history.pushState({}, "", "/settings/general");
    const { hook } = memoryLocation({ path: `/folder/${ENC}`, static: true });
    render(
      <Router hook={hook}>
        <ShellContent variant="desktop" {...renderers()} />
      </Router>,
    );
    expect(screen.getByText(`home:${CWD}`)).toBeTruthy();
    // Fails closed: if the branch were derived from window.location the shell
    // would fall through every branch to the landing page, which is exactly the
    // bug this extraction fixes.
    expect(screen.queryByText("landing")).toBeNull();
  });

  it("derives from the browser URL when NOT pinned — the counterfactual", () => {
    // The other two tests in this block are only meaningful if the same render
    // WITHOUT a pinned router gives a different answer. It does: at /settings
    // no content branch matches and the shell falls through to the landing
    // page. That is precisely the broken underlay the extraction fixes, pinned
    // here so the pair cannot both drift into agreement.
    window.history.pushState({}, "", "/settings/general");
    render(<ShellContent variant="desktop" {...renderers()} />);
    expect(screen.getByText("landing")).toBeTruthy();
    expect(screen.queryByText(`home:${CWD}`)).toBeNull();
  });

  it("keeps a frozen session underlay while the browser URL is a preview overlay", () => {
    window.history.pushState({}, "", "/pi-view?url=https://example.com");
    const { hook, searchHook } = memoryLocation({ path: "/session/known", searchPath: "", static: true });
    render(
      <Router hook={hook} searchHook={searchHook}>
        <ShellContent variant="desktop" {...renderers()} />
      </Router>,
    );
    expect(screen.getByText("session:known")).toBeTruthy();
    // The overlay's own `?url=` must not leak into the frozen underlay.
    expect(screen.queryByText("url:https://example.com")).toBeNull();
  });
});
