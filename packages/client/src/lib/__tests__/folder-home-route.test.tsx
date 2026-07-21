/**
 * E6 — the bare `/folder/:encodedCwd` home route must NOT shadow the deeper
 * `/folder/:encodedCwd/terminals` (and siblings). wouter's regexparam compiles
 * `/folder/:encodedCwd` to `^/folder/([^/]+?)/?$`; `[^/]+?` never crosses `/`,
 * so a URL with a deeper segment matches the deeper route only.
 *
 * Also asserts the mobile back-depth classifier treats the bare home route as a
 * depth-1 detail surface (D1a), popping to cards rather than being a dead
 * depth-0 no-op.
 * See change: add-directory-home-page.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router, useRoute } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { computeBackTarget, routeDepth } from "../nav/back-target.js";

function RouteProbe() {
  const [homeMatch] = useRoute("/folder/:encodedCwd");
  const [termMatch] = useRoute("/folder/:encodedCwd/terminals");
  return (
    <div>
      <span data-testid="home-match">{String(homeMatch)}</span>
      <span data-testid="term-match">{String(termMatch)}</span>
    </div>
  );
}

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, static: true });
  render(
    <Router hook={hook}>
      <RouteProbe />
    </Router>,
  );
}

describe("bare folder-home route matching (E6)", () => {
  it("bare route matches a 2-segment folder URL; terminals does not", () => {
    renderAt("/folder/Zm9v");
    expect(screen.getByTestId("home-match").textContent).toBe("true");
    expect(screen.getByTestId("term-match").textContent).toBe("false");
  });

  it("a deeper /terminals URL matches terminals but NOT the bare home route (no shadowing)", () => {
    renderAt("/folder/Zm9v/terminals");
    expect(screen.getByTestId("home-match").textContent).toBe("false");
    expect(screen.getByTestId("term-match").textContent).toBe("true");
  });
});

describe("bare folder-home mobile back depth (D1a)", () => {
  it("resolves to depth 1 and pops to cards", () => {
    expect(routeDepth("/folder/Zm9v")).toBe(1);
    expect(computeBackTarget("/folder/Zm9v")).toBe("/");
  });

  it("does not disturb the deeper folder routes' depth", () => {
    expect(routeDepth("/folder/Zm9v/terminals")).toBe(1);
    expect(computeBackTarget("/folder/Zm9v/terminals")).toBe("/");
  });
});
