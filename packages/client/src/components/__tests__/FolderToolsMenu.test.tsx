import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FolderToolsMenu } from "../folder/FolderToolsMenu.js";

afterEach(() => cleanup());

describe("FolderToolsMenu", () => {
  it("opens supplied secondary content and closes with Escape", () => {
    render(
      <FolderToolsMenu cwd="/repo" hasOpenSpec>
        <button type="button">OpenSpec board</button>
      </FolderToolsMenu>,
    );

    const trigger = screen.getByTestId("folder-tools-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("folder-tools-menu")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("folder-tools-menu")).toBeTruthy();
    expect(screen.getByText("OpenSpec board")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("folder-tools-menu")).toBeNull();
  });

  it("omits the trigger when no secondary tool is available", () => {
    render(<FolderToolsMenu cwd="/repo" hasOpenSpec={false} />);
    expect(screen.queryByTestId("folder-tools-trigger")).toBeNull();
  });
});
