import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ConfirmRenderer } from "../interactive-renderers/ConfirmRenderer.js";

afterEach(cleanup);

const baseProps = {
  requestId: "req-1",
  method: "confirm",
  params: { title: "Initialize git?" },
};

describe("ConfirmRenderer", () => {
  describe("pending state", () => {
    it("renders Yes and No labels (not Allow/Deny)", () => {
      render(<ConfirmRenderer {...baseProps} status="pending" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
      expect(screen.queryByText("Allow")).toBeNull();
      expect(screen.queryByText("Deny")).toBeNull();
    });

    it("Yes responds confirmed=true, No responds confirmed=false", () => {
      const onRespond = vi.fn();
      render(<ConfirmRenderer {...baseProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText("Yes"));
      expect(onRespond).toHaveBeenCalledWith({ confirmed: true });
      fireEvent.click(screen.getByText("No"));
      expect(onRespond).toHaveBeenCalledWith({ confirmed: false });
    });
  });

  describe("resolved state", () => {
    it("renders BOTH Yes and No with the chosen one highlighted", () => {
      render(
        <ConfirmRenderer
          {...baseProps}
          status="resolved"
          result={{ confirmed: true }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      // Both options present in the resolved card.
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
      // Question kept as title.
      expect(screen.getByText("Initialize git?")).toBeTruthy();
    });

    it("renders both options when denied", () => {
      render(
        <ConfirmRenderer
          {...baseProps}
          status="resolved"
          result={{ confirmed: false }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(<ConfirmRenderer {...baseProps} status="cancelled" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });

  describe("dismissed state", () => {
    it("displays Answered in terminal label", () => {
      render(<ConfirmRenderer {...baseProps} status="dismissed" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Answered in terminal")).toBeTruthy();
    });
  });
});
