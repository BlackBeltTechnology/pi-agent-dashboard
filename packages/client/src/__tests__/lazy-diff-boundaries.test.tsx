/**
 * L1 guards for the App-level diff boundaries (design D2, test-plan F11).
 *
 * WHY SOURCE-LEVEL: `shellRenderers.renderDiff` is a local closure inside the
 * `App` component, so it cannot be imported and rendered in isolation. The
 * load-bearing property — "the callback returns its own `<Suspense>` around the
 * lazy `FileDiffView`" — is only observable in `App.tsx` itself. Rendering a
 * re-implementation of that shape would be a tautology (it would test React's
 * Suspense semantics, not this code).
 *
 * The mechanism half (a suspended lazy child does not unmount its siblings when
 * a boundary sits between them) IS asserted behaviourally below, so the source
 * assertion is paired with proof that the shape it pins actually works.
 *
 * See change: add-lazy-terminal-diff-bootstrap (test-plan F11).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import React, { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.resolve(here, "../App.tsx"), "utf8");

describe("App diff boundaries (design D2)", () => {
  it("imports FileDiffView lazily, never statically", () => {
    // A static import is exactly the cold-landing edge this change removes.
    expect(appSource).not.toMatch(/^\s*import\s+\{[^}]*FileDiffView[^}]*\}\s+from/m);
    expect(appSource).toMatch(/const FileDiffView = lazy\(\(\) => import\("\.\/components\/diff\/FileDiffView\.js"\)/);
  });

  it("F11 · `renderDiff` returns its own <Suspense> around the lazy diff", () => {
    // Extract the renderDiff callback body from the shellRenderers object.
    const m = /renderDiff:\s*\(sessionId\)\s*=>\s*\(([\s\S]*?)\n\s*\),/.exec(appSource);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toContain("<Suspense");
    expect(body).toContain("DiffRouteFallback");
    expect(body).toContain("<FileDiffView");
    // The boundary must WRAP the child, i.e. Suspense opens before FileDiffView.
    expect(body.indexOf("<Suspense")).toBeLessThan(body.indexOf("<FileDiffView"));
  });

  it("both FileDiffView render sites are boundary-wrapped", () => {
    const sites = [...appSource.matchAll(/<FileDiffView\b/g)];
    expect(sites.length).toBe(2); // the route site + the renderDiff callback
    for (const s of sites) {
      const before = appSource.slice(Math.max(0, s.index - 260), s.index);
      expect(before).toContain("<Suspense");
    }
  });
});

describe("Suspense containment mechanism (why the boundary matters)", () => {
  it("a suspended lazy child does NOT unmount its siblings", () => {
    let resolve: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const LazyChild = React.lazy(async () => {
      await gate;
      return { default: () => <div data-testid="lazy-child">loaded</div> };
    });

    render(
      <div>
        <div data-testid="sibling-shell">shell chrome</div>
        <Suspense fallback={<div data-testid="suspense-fallback" />}>
          <LazyChild />
        </Suspense>
      </div>,
    );

    // While suspended, the sibling outside the boundary is still mounted.
    expect(screen.getByTestId("sibling-shell")).toBeTruthy();
    expect(screen.getByTestId("suspense-fallback")).toBeTruthy();
    resolve?.();
    void vi;
  });
});
