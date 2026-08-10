/**
 * AudioPreview renders an <audio> element sourced from /api/file/raw.
 * See change: improve-content-editor (tasks §4.1).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { AudioPreview } from "../AudioPreview.js";

afterEach(cleanup);

describe("AudioPreview", () => {
  it("renders an <audio> with the raw file src and controls", () => {
    const { container } = render(
      <AudioPreview target={{ kind: "file", cwd: "/proj", path: "sound.mp3" }} />,
    );
    const audio = container.querySelector("audio");
    expect(audio).toBeTruthy();
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("src")).toBe(
      "/api/file/raw?cwd=%2Fproj&path=sound.mp3",
    );
  });
});
