import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { Toast, useToast } from "../Toast.js";

describe("Toast variants", () => {
  it("renders success variant with success styling", () => {
    const { container } = render(
      <Toast
        messages={[{ id: 1, text: "Done", variant: "success" }]}
        onDismiss={() => {}}
      />,
    );
    expect(container.innerHTML).toMatch(/green/);
  });

  it("renders default (no variant) with error styling (back-compat)", () => {
    const { container } = render(
      <Toast messages={[{ id: 2, text: "Oops" }]} onDismiss={() => {}} />,
    );
    expect(container.innerHTML).toMatch(/red/);
  });

  it("renders info variant without red/green error styling", () => {
    const { container } = render(
      <Toast
        messages={[{ id: 3, text: "Working", variant: "info" }]}
        onDismiss={() => {}}
      />,
    );
    expect(container.innerHTML).not.toMatch(/red-900/);
  });
});

describe("useToast.showToast", () => {
  it("defaults to error variant when called without a variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showToast("boom"); });
    expect(result.current.messages[0].variant ?? "error").toBe("error");
  });

  it("accepts an explicit variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showToast("yay", "success"); });
    expect(result.current.messages[0].variant).toBe("success");
  });
});
