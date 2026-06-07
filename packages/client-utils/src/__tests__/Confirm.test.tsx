import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Confirm } from "../Confirm.js";

afterEach(() => cleanup());

describe("Confirm", () => {
  it("renders title and message", () => {
    const { getByText, baseElement } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="Forget workspace?"
        message="This cannot be undone."
        testId="c"
      />,
    );
    expect(getByText("Forget workspace?")).toBeTruthy();
    expect(getByText("This cannot be undone.")).toBeTruthy();
    const container = baseElement.querySelector("[data-testid='c']")!;
    expect(container.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("renders optional body node", () => {
    const { getByTestId } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        body={<ul data-testid="files" />}
      />,
    );
    expect(getByTestId("files")).toBeTruthy();
  });

  it("uses default labels", () => {
    const { getByText } = render(
      <Confirm open onClose={() => {}} onConfirm={() => {}} title="t" message="m" />,
    );
    expect(getByText("Confirm")).toBeTruthy();
    expect(getByText("Cancel")).toBeTruthy();
  });

  it("uses custom labels", () => {
    const { getByText } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        confirmLabel="Forget"
        cancelLabel="Keep"
      />,
    );
    expect(getByText("Forget")).toBeTruthy();
    expect(getByText("Keep")).toBeTruthy();
  });

  it("maps danger intent to action button class", () => {
    const { baseElement } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        intent="danger"
        testId="c"
      />,
    );
    expect(
      baseElement.querySelector("[data-testid='c-action']")!.className,
    ).toContain("bg-red-600");
  });

  it("action calls onConfirm only; cancel/Esc call onClose only", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { baseElement } = render(
      <Confirm
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="t"
        message="m"
        testId="c"
      />,
    );
    fireEvent.click(baseElement.querySelector("[data-testid='c-action']")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(baseElement.querySelector("[data-testid='c-cancel']")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
