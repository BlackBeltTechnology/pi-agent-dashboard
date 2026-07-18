/**
 * Per-kind mime icon distinctness (defect #2).
 * See change: improve-content-editor (tasks §2.3).
 */

import { mdiLanguageCss3 } from "@mdi/js";
import { describe, expect, it } from "vitest";
import { fileIcon } from "../preview/file-icon.js";

describe("fileIcon", () => {
  it("gives .ts/.json/.png/.mp4/.mp3/.mmd/.pdf each a distinct icon", () => {
    const exts = ["a.ts", "a.json", "a.png", "a.mp4", "a.mp3", "a.mmd", "a.pdf"];
    const icons = exts.map((f) => fileIcon(f).iconPath);
    expect(new Set(icons).size).toBe(exts.length);
  });

  it("falls back to a generic glyph for unknown extensions", () => {
    const fallback = fileIcon("a.xyzzy");
    expect(fallback.iconPath).toBe(fileIcon("noext").iconPath);
    expect(fallback.colorClass).toBe("");
  });

  it("maps .css/.scss/.less to the CSS glyph", () => {
    for (const f of ["a.css", "a.scss", "a.less"]) {
      expect(fileIcon(f).iconPath).toBe(mdiLanguageCss3);
    }
  });

  it("matches on the last extension, case-insensitively", () => {
    expect(fileIcon("Foo.TS").iconPath).toBe(fileIcon("bar.ts").iconPath);
    expect(fileIcon("dir/x.min.JS").iconPath).toBe(fileIcon("y.js").iconPath);
  });
});
