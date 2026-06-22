import { useEffect } from "react";

/**
 * Toggle the `app-hidden` class on a root element. While set, CSS pauses all
 * animations (`animation-play-state: paused`) so a backgrounded / tray-hidden
 * window stops driving continuous compositing.
 * See change: throttle-idle-ui-animations.
 */
export function applyAppHiddenClass(root: HTMLElement, hidden: boolean): void {
  root.classList.toggle("app-hidden", hidden);
}

/**
 * Mirror `document.visibilityState` onto the `app-hidden` root class. Listens
 * for `visibilitychange` (fires when the window is hidden to the tray, even
 * with Electron occlusion detection disabled) plus window `blur`/`focus` as
 * extra re-evaluation triggers. Cleans up its listeners on unmount.
 */
export function useAppHidden(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      applyAppHiddenClass(root, document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
    };
  }, []);
}
