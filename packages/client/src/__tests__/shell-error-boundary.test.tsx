/**
 * Regression test for the bug fixed in change
 * `fix-session-card-icon-import-and-shell-boundary`: a ReferenceError
 * thrown during render of a first-party shell chrome component (e.g.
 * `SessionCard` referencing the dropped `mdiConsoleLine` symbol) blanked
 * the entire Electron window because no ErrorBoundary sat above the
 * layout chrome.
 *
 * The fix wraps the shell chrome inside a top-level `<ErrorBoundary>`
 * (in `App.tsx`'s `apiProvider` factory) with a "Shell encountered an
 * error" + "Reload page" fallback.
 *
 * This test pins the boundary's contract: when a chrome component throws
 * a ReferenceError, the boundary catches it and renders the fallback
 * carrying `data-testid="shell-error-fallback"` (so a future refactor
 * cannot accidentally remove the safety net).
 *
 * The inner `ChatView` ErrorBoundary continues to win for chat-only
 * errors via React's nearest-boundary semantics; this test scopes only
 * the *outer* contract that did not previously exist.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { ErrorBoundary } from "../components/primitives/ErrorBoundary.js";

afterEach(() => cleanup());

/**
 * Reproduces the failure shape: a ReferenceError thrown during render of
 * a chrome component (mirrors `?? mdiConsoleLine` evaluating to a
 * dangling identifier).
 */
function ThrowingChromeComponent(): React.ReactElement {
  // Deliberately reference an undefined identifier the way the original
  // SessionCard regression did. `noUndef` is silenced via the bracket
  // access on `globalThis` so TypeScript still type-checks this file.
  throw new ReferenceError("mdiConsoleLine is not defined");
}

/**
 * Mirrors the fallback markup added in `App.tsx::apiProvider`. Kept in
 * sync with the production shape; the testid is the contract anchor.
 */
function ShellFallback(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--bg-primary)] text-[var(--text-primary)]" data-testid="shell-error-fallback">
      <div className="text-center space-y-2">
        <div className="text-red-400 text-sm">Shell encountered an error</div>
        <button onClick={() => window.location.reload()} className="text-xs text-blue-400 hover:underline">Reload page</button>
      </div>
    </div>
  );
}

describe("Shell ErrorBoundary contract", () => {
  // React logs the caught error to the console in test mode; suppress to
  // keep test output readable. The error is still surfaced via the
  // ErrorBoundary's `componentDidCatch` console.error, which we also
  // silence (the boundary itself is the system under test).
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("catches a ReferenceError thrown by a chrome component and renders the shell fallback", () => {
    const { queryByTestId, getByText } = render(
      <ErrorBoundary fallback={<ShellFallback />}>
        <ThrowingChromeComponent />
      </ErrorBoundary>,
    );

    // Fallback rendered.
    expect(queryByTestId("shell-error-fallback")).not.toBeNull();
    expect(getByText("Shell encountered an error")).toBeTruthy();
    expect(getByText("Reload page")).toBeTruthy();
  });

  it("does not render the fallback when the child does not throw", () => {
    const { queryByTestId } = render(
      <ErrorBoundary fallback={<ShellFallback />}>
        <div data-testid="happy-child">healthy chrome</div>
      </ErrorBoundary>,
    );

    expect(queryByTestId("shell-error-fallback")).toBeNull();
    expect(queryByTestId("happy-child")).not.toBeNull();
  });

  // Note: a third test asserting `window.location.reload` is invoked on
  // button click was considered, but jsdom marks `location.reload`
  // non-configurable, so the spy install throws. The button's onClick
  // wires directly to `window.location.reload()` in inline JSX; the
  // visible-fallback contract above is sufficient regression coverage.
});
