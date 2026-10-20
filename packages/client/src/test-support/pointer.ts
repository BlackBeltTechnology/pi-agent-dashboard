/**
 * Pointer-event dispatch helpers for jsdom (no `PointerEvent`, no
 * `setPointerCapture`). Dispatches typed `MouseEvent`s named like pointer events
 * with a defined `pointerId`; React's `onPointerDown` and native `window`
 * listeners both see them.
 *
 * See change: fix-split-divider-drag (§1.1).
 */

import { act } from "@testing-library/react";

export interface PointerInit {
  clientX?: number;
  clientY?: number;
  button?: number;
  buttons?: number;
  pointerId?: number;
}

function fire(target: Element | Window, type: string, init: PointerInit, defaultButtons: number): void {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    buttons: init.buttons ?? defaultButtons,
  });
  Object.defineProperty(ev, "pointerId", { value: init.pointerId ?? 1 });
  act(() => {
    target.dispatchEvent(ev);
  });
}

export const pointerDown = (target: Element, init: PointerInit = {}) => fire(target, "pointerdown", init, 1);
export const pointerMove = (target: Element | Window, init: PointerInit = {}) => fire(target, "pointermove", init, 1);
export const pointerUp = (target: Element | Window, init: PointerInit = {}) => fire(target, "pointerup", init, 0);
export const pointerCancel = (target: Element | Window, init: PointerInit = {}) =>
  fire(target, "pointercancel", init, 0);

/** `lostpointercapture` does not bubble in browsers; it targets the handle only. */
export function lostPointerCapture(target: Element, init: PointerInit = {}): void {
  const ev = new MouseEvent("lostpointercapture", { bubbles: false, cancelable: false });
  Object.defineProperty(ev, "pointerId", { value: init.pointerId ?? 1 });
  act(() => {
    target.dispatchEvent(ev);
  });
}

/** Resolve after the next animation frame (the hook's rAF coalescing tick). */
export async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}
