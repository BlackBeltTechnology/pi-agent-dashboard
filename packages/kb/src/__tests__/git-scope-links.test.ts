// Cross-links between history items (change: add-kb-git-forge-scope, test-plan #E32–#E36).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractRefs } from "../git-scope/links.js";
import { FakeForge, fakeClock, fakeItem, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const fast = { forge: { minSyncIntervalSeconds: 1, hintedMinSyncIntervalSeconds: 1 } };

describe("links", () => {
  it("E32/E33: squash commit links to a later-synced PR, and keeps the link across a re-sync", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const sha = fx.commit(dir, "Fix the parser (#123)");
    const forge = new FakeForge();
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: fast });
    await scope.search({ query: "parser" }, { cwd: dir }); // commit indexed, PR 123 not on the forge yet
    const before = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(before.text).toMatch(/Linked: .*issue\/123 \(not indexed\)/);

    forge.items = [fakeItem("pr", 123, "Parser fix")];
    clock.advance(5000);
    await scope.search({ query: "parser" }, { cwd: dir });
    const after = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(after.text).toMatch(/Linked: .*pr\/123(?! \(not)/);
    expect(after.text).not.toContain("issue/123");

    forge.items = [fakeItem("pr", 123, "Parser fix (edited)")]; // PR updated on the forge
    clock.advance(5000);
    await scope.search({ query: "edited" }, { cwd: dir });
    const again = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(again.text).toMatch(/Linked: .*pr\/123/);
    const pr = await scope.get({ path: "pr/123" }, { cwd: dir });
    expect(pr.text).toContain("edited");
    expect(pr.text).toContain(`commit/${sha}`); // inbound link listed on the PR
  });

  it("E34: GitLab #N and !N stay distinct, no re-pointing", async () => {
    const dir = fx.repo({ remote: "https://gitlab.com/g/r.git" });
    const sha = fx.commit(dir, "Fixes #7, see !7");
    const forge = new FakeForge({ id: "gitlab", endpoints: ["issues", "merge_requests"], sharedNumberSpace: false });
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: fast });
    await scope.search({ query: "fixes" }, { cwd: dir });
    forge.items = [fakeItem("issue", 7, "Seven issue"), fakeItem("pr", 7, "Seven merge request")];
    clock.advance(5000);
    await scope.search({ query: "seven" }, { cwd: dir });
    const got = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(got.text).toMatch(/Linked: .*issue\/7/);
    expect(got.text).toMatch(/Linked: .*pr\/7/);
  });

  it("E35: link parser table", () => {
    const gh = { forge: "github" as const, identity: "github.com/a/r" };
    expect(extractRefs("see #12", gh)).toEqual(["issue/12"]);
    expect(extractRefs("Closes #3", gh)).toEqual(["issue/3"]);
    expect(extractRefs("merged https://github.com/a/r/pull/9", gh)).toEqual(["pr/9"]);
    expect(extractRefs("see https://github.com/a/r/issues/4", gh)).toEqual(["issue/4"]);
    expect(extractRefs("see https://github.com/other/repo/pull/5", gh)).toEqual([]);
    expect(extractRefs("owner/repo#77 cross repo", gh)).toEqual([]);
    expect(extractRefs("See change: add-foo", gh)).toEqual(["change:add-foo"]);
    const gl = { forge: "gitlab" as const, identity: "gitlab.com/g/r" };
    expect(extractRefs("Fixes #7, see !8", gl)).toEqual(["issue/7", "pr/8"]);
    expect(extractRefs("see !8", gh)).toEqual([]); // `!N` is a GitLab convention only
  });

  it("E36: change link resolves against the caller's checkout", async () => {
    const dir = fx.repo();
    mkdirSync(join(dir, "openspec", "changes", "archive", "2026-01-01-add-foo"), { recursive: true });
    const sha = fx.commit(dir, "ship it", { body: "See change: add-foo" });
    const scope = scopeFor(fx);
    await scope.search({ query: "ship" }, { cwd: dir });
    const got = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(got.text).toContain("Linked: openspec/changes/archive/2026-01-01-add-foo");
  });
});
