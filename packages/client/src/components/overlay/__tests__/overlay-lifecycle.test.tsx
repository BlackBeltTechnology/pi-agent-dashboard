/**
 * Risk R4 — mount/unmount lifecycle (task 8.5).
 *
 * A route-mounted surface unmounts on navigation. A dialog-mounted one need
 * not: if the container keeps rendering while "closed", a live subscription
 * (`AutomationRunMonitor`, a polling `ResourceGridPanel`) stays attached behind
 * a dismissed dialog and leaks.
 *
 * These assert the two halves that make the conversion safe:
 *   - LAZY: nothing inside the overlay mounts until the overlay is rendered, so
 *     converting a surface does not make it start paying costs at app boot.
 *   - RELEASED: dismissal unmounts BOTH the surface and the pinned underlay, so
 *     effects are torn down rather than orphaned.
 *
 * Effect cleanup is the observable, not DOM absence — a subscription can
 * outlive its node, and that is exactly the leak R4 names.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteBackedOverlay } from "../RouteBackedOverlay.js";

afterEach(cleanup);

const BG = { path: "/", search: "" };

/** Stands in for any surface holding a live subscription. */
function Subscriber({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return <div data-testid="surface">surface</div>;
}

function Overlay({ open, mount, unmount }: { open: boolean; mount: () => void; unmount: () => void }) {
  // Mirrors App's shape exactly: a plain conditional, no always-mounted
  // container with an `open` prop. That is what makes the mount lazy.
  return open ? (
    <RouteBackedOverlay
      background={BG}
      backgroundContent={<Subscriber onMount={mount} onUnmount={unmount} />}
      onDismiss={() => {}}
      testId="ov"
    >
      <Subscriber onMount={mount} onUnmount={unmount} />
    </RouteBackedOverlay>
  ) : null;
}

describe("8.5 — converted surfaces mount lazily and release on dismissal", () => {
  it("mounts nothing until the overlay route matches", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    render(<Overlay open={false} mount={mount} unmount={unmount} />);

    expect(mount).not.toHaveBeenCalled();
    expect(screen.queryByTestId("surface")).toBeNull();
    expect(screen.queryByTestId("ov")).toBeNull();
  });

  it("mounts the surface AND the underlay exactly once when opened", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    render(<Overlay open mount={mount} unmount={unmount} />);

    // Two subscribers: the overlay surface and the pinned underlay.
    expect(mount).toHaveBeenCalledTimes(2);
    expect(unmount).not.toHaveBeenCalled();
  });

  it("runs effect cleanup for BOTH on dismissal, leaving nothing subscribed", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    const { rerender } = render(<Overlay open mount={mount} unmount={unmount} />);
    expect(mount).toHaveBeenCalledTimes(2);

    rerender(<Overlay open={false} mount={mount} unmount={unmount} />);

    // The leak R4 names is an effect that outlives its node, so cleanup count
    // is the assertion — DOM absence alone would not catch it.
    expect(unmount).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("ov")).toBeNull();
    expect(screen.queryByTestId("ov-underlay")).toBeNull();
  });

  it("does not remount either subscriber across an unrelated re-render", () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    const { rerender } = render(<Overlay open mount={mount} unmount={unmount} />);

    rerender(<Overlay open mount={mount} unmount={unmount} />);

    // A remount here would restart every subscription on each parent render,
    // and would also churn the frozen background (D1c / task 5.5a).
    expect(mount).toHaveBeenCalledTimes(2);
    expect(unmount).not.toHaveBeenCalled();
  });
});
