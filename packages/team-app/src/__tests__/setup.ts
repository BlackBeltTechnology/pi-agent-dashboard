import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no <dialog> modal API.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ||= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ||= function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ||= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
});

import { targetStore } from "../state/target-store.js";
afterEach(() => targetStore.reset());
