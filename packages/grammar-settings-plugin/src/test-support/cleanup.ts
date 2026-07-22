/**
 * Unmount React trees between tests so `screen`/global queries don't see DOM
 * accumulated across `render()` calls (Testing Library auto-cleanup is only
 * registered under vitest `globals: true`, which this package does not set).
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
