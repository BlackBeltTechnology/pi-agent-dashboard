/**
 * TooLargePreview: default cap unchanged (CappedViewer path) + optional `cap`.
 * See change: harden-untrusted-content-ingestion (test-plan #F5, D6).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { TooLargePreview } from "../TooLargePreview.js";

afterEach(cleanup);

describe("TooLargePreview", () => {
  it("F5: without `cap` the notice names the 10 MB MAX_PREVIEW_BYTES limit", () => {
    render(<TooLargePreview cwd="/proj" path="big.md" size={11 * 1024 * 1024} />);
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 10 MB");
  });

  it("an explicit `cap` overrides the named limit", () => {
    render(<TooLargePreview cwd="/proj" path="big.xlsx" cap={50 * 1024 * 1024} />);
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 50 MB");
  });
});
