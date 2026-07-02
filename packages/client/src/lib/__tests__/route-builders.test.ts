import { describe, expect, it } from "vitest";
import { decodeFolderPath, encodeFolderPath } from "../folder-encoding.js";
import {
  buildEditorUrl,
  buildFolderSettingsUrl,
  buildOpenSpecArchiveUrl,
  buildOpenSpecPreviewUrl,
  buildOpenSpecSpecsUrl,
  buildPiResourceFileUrl,
  buildPiResourcesUrl,
  buildSessionDiffUrl,
} from "../route-builders.js";

describe("route-builders", () => {
  describe("buildOpenSpecPreviewUrl", () => {
    it("uses encodeFolderPath for cwd and encodeURIComponent for change/artifact", () => {
      const url = buildOpenSpecPreviewUrl("/home/user/proj", "my-change", "proposal");
      expect(url).toBe(`/folder/${encodeFolderPath("/home/user/proj")}/openspec/my-change/proposal`);
    });

    it("round-trips cwd with spaces and Unicode through decodeFolderPath", () => {
      const cwd = "/home/user/My Projects/résumé";
      const url = buildOpenSpecPreviewUrl(cwd, "x", "y");
      const m = url.match(/^\/folder\/([^/]+)\/openspec\/x\/y$/);
      expect(m).not.toBeNull();
      expect(decodeFolderPath(m![1])).toBe(cwd);
    });

    it("escapes special chars in changeName and artifactId", () => {
      const url = buildOpenSpecPreviewUrl("/x", "a b/c?d", "p#q");
      expect(url).toContain("/openspec/a%20b%2Fc%3Fd/p%23q");
    });
  });

  describe("buildOpenSpecArchiveUrl / buildOpenSpecSpecsUrl / buildPiResourcesUrl", () => {
    it("each produces a path with encoded cwd and a static tail", () => {
      const cwd = "/proj";
      const enc = encodeFolderPath(cwd);
      expect(buildOpenSpecArchiveUrl(cwd)).toBe(`/folder/${enc}/openspec/archive`);
      expect(buildOpenSpecSpecsUrl(cwd)).toBe(`/folder/${enc}/openspec/specs`);
      expect(buildPiResourcesUrl(cwd)).toBe(`/folder/${enc}/pi-resources`);
    });
  });

  describe("buildFolderSettingsUrl", () => {
    it("omits the page segment when page is undefined", () => {
      const cwd = "/proj";
      expect(buildFolderSettingsUrl(cwd)).toBe(`/folder/${encodeFolderPath(cwd)}/settings`);
    });

    it("appends an encodeURIComponent-encoded page segment", () => {
      const cwd = "/proj";
      const enc = encodeFolderPath(cwd);
      expect(buildFolderSettingsUrl(cwd, "packages")).toBe(`/folder/${enc}/settings/packages`);
      expect(buildFolderSettingsUrl(cwd, "resources")).toBe(`/folder/${enc}/settings/resources`);
    });

    it("round-trips cwd with spaces/Unicode and encodes odd page slugs", () => {
      const cwd = "/home/user/My Projects/résumé";
      const url = buildFolderSettingsUrl(cwd, "a b/c");
      const m = url.match(/^\/folder\/([^/]+)\/settings\/(.+)$/);
      expect(m).not.toBeNull();
      expect(decodeFolderPath(m![1])).toBe(cwd);
      expect(m![2]).toBe("a%20b%2Fc");
    });
  });

  describe("buildPiResourceFileUrl", () => {
    it("uses query string", () => {
      const url = buildPiResourceFileUrl("/x.md", "Title");
      expect(url.startsWith("/pi-resource?")).toBe(true);
      const qs = new URLSearchParams(url.slice("/pi-resource?".length));
      expect(qs.get("path")).toBe("/x.md");
      expect(qs.get("title")).toBe("Title");
    });

    it("encodes ?, &, #, spaces in path and title", () => {
      const path = "/a b/c?d&e#f";
      const title = "T & ?";
      const url = buildPiResourceFileUrl(path, title);
      const qs = new URLSearchParams(url.slice("/pi-resource?".length));
      expect(qs.get("path")).toBe(path);
      expect(qs.get("title")).toBe(title);
      // Raw URL must not contain the literal special chars
      expect(url).not.toContain("?d&e");
      expect(url).not.toContain("#f");
    });
  });

  describe("buildEditorUrl", () => {
    it("builds an editor route with the file query", () => {
      expect(buildEditorUrl("abc-123", "src/foo.ts")).toBe("/session/abc-123/editor?file=src%2Ffoo.ts");
    });
    it("includes line when positive, omits otherwise", () => {
      expect(buildEditorUrl("s1", "a.ts", 42)).toBe("/session/s1/editor?file=a.ts&line=42");
      expect(buildEditorUrl("s1", "a.ts", 0)).toBe("/session/s1/editor?file=a.ts");
    });
  });

  describe("buildSessionDiffUrl", () => {
    it("encodes session id", () => {
      expect(buildSessionDiffUrl("abc-123")).toBe("/session/abc-123/diff");
      expect(buildSessionDiffUrl("a b/c")).toBe("/session/a%20b%2Fc/diff");
    });
  });
});
