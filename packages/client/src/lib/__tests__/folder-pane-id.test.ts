import { describe, expect, it } from "vitest";
import { FOLDER_PANE_PREFIX, folderPaneId, isFolderPaneId } from "../folder-pane-id.js";

describe("folderPaneId", () => {
  it("namespaces the cwd with the folder prefix", () => {
    expect(folderPaneId("/Users/me/repo")).toBe("folder:/Users/me/repo");
    expect(folderPaneId("/Users/me/repo").startsWith(FOLDER_PANE_PREFIX)).toBe(true);
  });

  it("is disjoint from a UUID session id key space", () => {
    const uuid = "019f6820-5d77-784e-849f-e31e4417ba18";
    const id = folderPaneId("/some/dir");
    // A real session id is a bare UUID; the folder key never collides.
    expect(id).not.toBe(uuid);
    expect(isFolderPaneId(uuid)).toBe(false);
    expect(isFolderPaneId(id)).toBe(true);
  });

  it("distinct cwds yield distinct keys", () => {
    expect(folderPaneId("/a")).not.toBe(folderPaneId("/b"));
  });
});
