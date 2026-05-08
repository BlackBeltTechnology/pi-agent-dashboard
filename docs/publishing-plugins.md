# Publishing Plugin Packages to npm

Monorepo enforces **lockstep versioning** — every workspace `package.json`
MUST share same `version` (enforced by `scripts/sync-versions.js`, which
`exit 1`s on drift). Release workflow (`.github/workflows/publish.yml`)
bumps every workspace in lockstep on every release tag.

Problem for **first-time publishing of new plugin**: plugin inherits
current monorepo version (e.g. `0.4.5`) on first npm publish despite
never existing on npm before. To seed at `0.0.1`, procedure below
preserves lockstep invariant via **one-shot manual publish, then
revert** before any commit.

## When to use this procedure

**MUST do local manual seed publish for every brand-new plugin.**
Non-optional, because of npm's chicken-and-egg constraint:

- `.github/workflows/publish.yml` publishes via **OIDC / Trusted Publisher
  only** — intentionally no `NPM_TOKEN` secret in repo.
- npmjs.com **only allows Trusted Publisher config on package that already
  exists** (Settings → Trusted Publisher grey-locked until package has
  ≥1 published version).

So brand-new package's first publish CANNOT come from workflow — must
come from developer's machine with `npm login`. After first publish
lands, configure Trusted Publisher on npmjs.com; every subsequent
release publishes via workflow's OIDC path.

Whether to seed at `0.0.1` (one-shot, then revert — steps 4–7) or at
current lockstep version (skip 4–7, publish at e.g. `0.4.5`) is
stylistic. Either way, **manual local publish in step 6 required for
every new plugin**.

## Procedure

### 1. Drop `private`, add `publishConfig` and `license`

Edit new plugin's `package.json`:

```jsonc
{
  "name": "@blackbelt-technology/pi-dashboard-<your-plugin>-plugin",
  "version": "0.4.5",                    // current lockstep version
  // REMOVE: "private": true,
  "license": "MIT",                       // ADD
  "publishConfig": {                      // ADD
    "access": "public"
  },
  "type": "module",
  // … exports / files / pi-dashboard-plugin block stay as-is …
}
```

### 2. Declare every runtime workspace dep explicitly

In monorepo, workspace packages linked by npm's `workspaces:` hoist, so
plugin can `import "@blackbelt-technology/dashboard-plugin-runtime/context"`
without declaring in `dependencies`. **Breaks once published** — npm
consumers don't hoist.

Grep plugin source for every `@blackbelt-technology/*` import, ensure
each appears in `dependencies` of plugin's `package.json` with
`^<lockstep-version>`. Example:

```bash
grep -rEh "from \"@blackbelt-technology/[^\"]+\"" packages/<your-plugin>/src \
  | sed 's|.*from "\(@blackbelt-technology/[^/"]*\).*|\1|' | sort -u
```

### 3. Add plugin to publish workflow

Edit `.github/workflows/publish.yml`, add plugin to `PACKAGES=(...)` bash
array. Position matters:

- **After** `dashboard-plugin-runtime` (plugins depend on it).
- **Before** `@blackbelt-technology/pi-agent-dashboard` (root metapackage,
  depends on every sub-package, MUST publish last).

```bash
PACKAGES=(
  "@blackbelt-technology/pi-dashboard-shared"
  "@blackbelt-technology/pi-dashboard-extension"
  "@blackbelt-technology/pi-dashboard-server"
  "@blackbelt-technology/pi-dashboard-web"
  "@blackbelt-technology/dashboard-plugin-runtime"
  "@blackbelt-technology/pi-dashboard-flows-plugin"
  "@blackbelt-technology/pi-dashboard-<your-new-plugin>"   # ADD HERE
  "@blackbelt-technology/pi-agent-dashboard"
)
```

### 4. (One-shot 0.0.1 seed only) Bump new plugin to 0.0.1

```bash
# Edit ONLY new plugin's package.json — leave other workspaces alone.
# Breaks lockstep temporarily; revert in step 7.
sed -i '' 's/"version": "0.4.5"/"version": "0.0.1"/' \
  packages/<your-plugin>/package.json
```

Do NOT run `npm install` or `node scripts/sync-versions.js` in this state
— latter refuses with "Lockstep invariant violated".

### 5. Dry-run publish

```bash
npm publish --workspace=@blackbelt-technology/pi-dashboard-<your-plugin> --dry-run
```

Verify file list matches `files: ["src/"]`, package size sane (< 1 MB
usually), version `0.0.1`.

### 6. Publish for real

Must be logged in to npm with publish rights on `@blackbelt-technology`
scope:

```bash
npm whoami                   # confirm logged in
npm publish --workspace=@blackbelt-technology/pi-dashboard-<your-plugin> \
  --access public
```

> ⚠️ **Why this step is local, not in CI** — npm's Trusted Publisher
> (OIDC) grey-locked until package has ≥1 version on npm. Workflow has
> no `NPM_TOKEN`, so can never publish brand-new package. First
> `npm publish` of any new package MUST come from developer machine with
> `npm login`. Once landed, configure Trusted Publisher on npmjs.com:
>
> - Package → Settings → Trusted Publisher → Add
> - Publisher: GitHub Actions
> - Owner: `BlackBeltTechnology`
> - Repository: `pi-agent-dashboard`
> - Workflow filename: `publish.yml`
> - Environment: (leave blank)
>
> Until Trusted Publisher configured, every subsequent workflow run will
> fail to publish that package (per-package `FAIL=1` loop in
> `publish.yml` isolates failure so other packages still publish, but
> new plugin won't update until fixed). One-time per package.

### 7. Revert version to lockstep value

```bash
sed -i '' 's/"version": "0.0.1"/"version": "0.4.5"/' \
  packages/<your-plugin>/package.json
node scripts/sync-versions.js   # MUST report "Lockstep invariant OK"
```

### 8. Commit

```bash
git add packages/<your-plugin>/package.json .github/workflows/publish.yml
git commit -m "chore(release): make <your-plugin> publishable"
```

git history shows package at lockstep version (`0.4.5`); only npm sees
`0.0.1` seed. Next release tag publishes plugin at new lockstep version
(e.g. `0.4.6`) via regular workflow.

## Verification checklist

- [ ] `node scripts/sync-versions.js` exits 0 with "Lockstep invariant OK"
- [ ] `npm view @blackbelt-technology/pi-dashboard-<your-plugin> version`
      returns `0.0.1`
- [ ] Trusted Publisher configured on npmjs.com for new package
- [ ] Plugin appears in `publish.yml`'s `PACKAGES=(...)` array
- [ ] All `@blackbelt-technology/*` imports declared in `dependencies`

## See also

- `.github/workflows/publish.yml` — per-package skip-if-exists loop,
  Trusted Publisher / OIDC config notes
- `scripts/sync-versions.js` — lockstep invariant enforcer
- `packages/dashboard-plugin-runtime/package.json` — reference layout for
  publishable plugin-adjacent workspace package
