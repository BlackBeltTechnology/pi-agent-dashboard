import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { InputRenderer } from "../interactive-renderers/InputRenderer.js";

afterEach(cleanup);

const baseProps = {
  requestId: "req-1",
  method: "input",
  params: { title: "Enter your name" },
};

describe("InputRenderer", () => {
  describe("pending state", () => {
    it("renders title and input field", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Enter your name")).toBeTruthy();
      expect(screen.getByRole("textbox")).toBeTruthy();
    });

    it("renders Submit and Cancel buttons", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Submit")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("Submit button is not disabled when input is empty", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("empty submission", () => {
    it("submits empty string via Enter key", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(onRespond).toHaveBeenCalledWith({ value: "" });
    });

    it("submits empty string via button click", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText("Submit"));

      expect(onRespond).toHaveBeenCalledWith({ value: "" });
    });
  });

  describe("non-empty submission", () => {
    it("submits entered text via Enter key", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alice" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(onRespond).toHaveBeenCalledWith({ value: "Alice" });
    });

    it("submits entered text via button click", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bob" } });
      fireEvent.click(screen.getByText("Submit"));

      expect(onRespond).toHaveBeenCalledWith({ value: "Bob" });
    });
  });

  describe("cancel", () => {
    it("calls onCancel when clicking Cancel", () => {
      const onCancel = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={onCancel}
        />,
      );

      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("resolved state", () => {
    it("keeps the question as title and shows the value in a read-only field", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "Alice" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Enter your name")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
    });

    it("renders (left blank) for an empty submitted value", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("(left blank)")).toBeTruthy();
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="cancelled"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });

  describe("dismissed state", () => {
    it("displays Answered in terminal label", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="dismissed"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Answered in terminal")).toBeTruthy();
    });
  });
});
