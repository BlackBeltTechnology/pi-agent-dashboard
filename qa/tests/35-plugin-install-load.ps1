# Test: a CLEAN INSTALL PREFIX loads the browser plugin (test-plan X7-X11) — Windows.
# See change: fix-browser-plugin-vendor-specifier-resolution.
#
# PowerShell twin of `35-plugin-install-load.sh`. The invariants, the
# three vacuous-green traps it closes, and the inputs are documented there; this
# file mirrors them so a Windows leg reports the same verdict as a POSIX one.
#
#   QA_PREFIX             install prefix / throwaway HOME (default: temp dir)
#   QA_DASHBOARD_TARBALL  path to a locally packed dashboard tarball
#   QA_PLUGIN_TARBALL     path to a locally packed browser-plugin tarball
#   QA_EXTRA_TARBALLS     space-separated extra tarballs (see the POSIX twin:
#                         required with the tarball inputs, or the registry
#                         supplies a stale `shared` / `dashboard-plugin-runtime`)
#   QA_DASHBOARD_VERSION  registry version when no tarball is given (default latest)
#   QA_REPO_ROOT          a checkout to prove is NOT used (contamination probe)
$ErrorActionPreference = "Stop"

Write-Host "=== Test: clean-prefix plugin install-load (X7-X11) ==="

$pluginId = "browser"
$port = if ($env:QA_PORT) { $env:QA_PORT } else { "18917" }
$bootTimeout = if ($env:QA_BOOT_TIMEOUT) { [int]$env:QA_BOOT_TIMEOUT } else { 60 }
$prefix = if ($env:QA_PREFIX) { $env:QA_PREFIX } else { Join-Path $env:TEMP ("qa-prefix-" + [guid]::NewGuid().ToString("N")) }
$logPath = Join-Path $prefix ".pi\dashboard\server.log"

# The previous script crashed mid-way would leave a prefix; only remove what we made.
$ownPrefix = -not $env:QA_PREFIX
# Set by the install step below; PATH is re-applied once the real value is known.
$binDir = ""

Write-Host "prefix: $prefix"

$version = if ($env:QA_DASHBOARD_VERSION) { $env:QA_DASHBOARD_VERSION } else { "latest" }
$dashboardSrc = if ($env:QA_DASHBOARD_TARBALL) { $env:QA_DASHBOARD_TARBALL } else { "@blackbelt-technology/pi-agent-dashboard@$version" }
$pluginSrc = if ($env:QA_PLUGIN_TARBALL) { $env:QA_PLUGIN_TARBALL } else { "@blackbelt-technology/pi-dashboard-browser-plugin@$version" }

# `JITI_TSCONFIG_PATHS` is the deleted stamp: it must not be supplied by the
# caller, or a green run proves nothing about a real install.
if (Test-Path Env:JITI_TSCONFIG_PATHS) { Remove-Item Env:JITI_TSCONFIG_PATHS }

function Set-PrefixHome {
    $env:USERPROFILE = $prefix
    $env:HOME = $prefix
    $env:PATH = "$binDir;$env:PATH"
}

function Stop-QaServer {
    try { & pi-dashboard stop 2>&1 | Out-Null } catch { }
}

function Start-QaServerAndWait {
    # An explicit --port keeps this off 8000, where a dev instance may be running.
    & pi-dashboard start --port $port --no-tunnel 2>&1 | Out-Null
    for ($elapsed = 0; $elapsed -lt $bootTimeout; $elapsed += 2) {
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Get-Plugins {
    return Invoke-RestMethod -Uri "http://localhost:$port/api/plugins" -TimeoutSec 10
}

# Point a package.json at the given spec ("-" = none) and force every first-party
# workspace in QA_EXTRA_TARBALLS to resolve locally. Without the overrides npm
# serves the REGISTRY copies of packages under test — the stale-copy hazard this
# change is about. An existing package.json (an unpacked tarball) is updated in
# place, so its manifest and dependencies survive.
function Write-Manifest {
    param([string]$Path, [string]$Spec = "-")
    $extras = @()
    if ($env:QA_EXTRA_TARBALLS) { $extras = @($env:QA_EXTRA_TARBALLS -split '\s+' | Where-Object { $_ }) }
    $js = @'
const fs = require("node:fs");
const tar = require("node:child_process");
const [out, spec, ...extras] = process.argv.slice(2);
const nameOf = (t) => JSON.parse(tar.execFileSync("tar", ["-xzOf", t, "package/package.json"], { encoding: "utf-8" })).name;
const local = (t) => (t.endsWith(".tgz") || t.endsWith(".tar.gz") ? "file:" + t : t);
const byName = Object.fromEntries(extras.map((t) => [nameOf(t), t]));
const overrides = { ...byName };
const pkg = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf-8")) : {};
if (!pkg.name) { pkg.name = "qa-clean-prefix"; pkg.private = true; pkg.version = "0.0.0"; pkg.dependencies = {}; }
if (spec && spec !== "-") { pkg.dependencies = pkg.dependencies || {}; pkg.dependencies[nameOf(spec)] = local(spec); }
// npm REJECTS an override that conflicts with a DIRECT dependency (EOVERRIDE), so
// a first-party package that is a direct dep is pinned through the dep itself;
// the override map then carries only the TRANSITIVE ones, which is what stops a
// nested copy from coming off the registry.
for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const name of Object.keys(deps)) {
    if (byName[name]) { deps[name] = "file:" + byName[name]; delete overrides[name]; }
  }
}
if (Object.keys(overrides).length) pkg.overrides = { ...(pkg.overrides || {}), ...overrides };
fs.writeFileSync(out, JSON.stringify(pkg, null, 2));
'@
    # The program goes in a temp .cjs FILE rather than `node -e`: Windows
    # PowerShell's legacy native-argument handling strips embedded double quotes
    # from an inline program, so it can arrive mangled and fail to parse —
    # silently, because the exit code was not checked. A file has no quoting
    # surface, and the exit code is checked here.
    $jsFile = Join-Path ([System.IO.Path]::GetTempPath()) ("qa-manifest-" + [guid]::NewGuid().ToString("N") + ".cjs")
    Set-Content -Path $jsFile -Value $js -Encoding utf8
    try {
        & node $jsFile $Path $Spec @extras
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FAIL: could not write the manifest for $Path"
            exit 1
        }
    } finally {
        Remove-Item -Force $jsFile -ErrorAction SilentlyContinue
    }
}

try {
    Set-PrefixHome

    # --- step 1: the dashboard app, on PATH as `pi-dashboard` ---------------
    if ($env:QA_DASHBOARD_TARBALL -or $env:QA_PLUGIN_TARBALL) {
        # LOCAL-TARBALL MODE must be a NON-global install with an `overrides` map:
        # the root package declares only the three workspace packages, while the
        # third-party deps live in packages/server — and the server source shipped
        # INSIDE the root tarball resolves them from its own nest. A global install
        # of root + workspace tarballs makes npm NEST those workspace packages, so
        # the inlined source cannot see their dependencies. `overrides` yields one
        # flat tree instead.
        $app = Join-Path $prefix "app"
        New-Item -ItemType Directory -Force -Path $app | Out-Null
        Write-Manifest (Join-Path $app "package.json") $dashboardSrc
        Push-Location $app
        npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
        $installCode = $LASTEXITCODE
        Pop-Location
        if ($installCode -ne 0) {
            Write-Host "FAIL: npm install (local dashboard tarball + overrides) failed in $app"
            exit 1
        }
        $binDir = Join-Path $app "node_modules\.bin"
    } else {
        npm install -g --prefix $prefix $dashboardSrc 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FAIL: npm install -g --prefix $prefix failed for $dashboardSrc"
            exit 1
        }
        $binDir = Join-Path $prefix "bin"
    }

    # --- step 2: the plugin, materialised where discovery looks -------------
    # `discoverPlugins()` scans ONE level — `<dir>/<entry>/package.json` — so a
    # SCOPED package inside a node_modules tree appears as `@scope/`, which has no
    # package.json and is never discovered. User-installed plugins live as
    # top-level directories under `~/.pi/dashboard/plugins/`, each with its own
    # node_modules; that directory is what the X11 prefix assertion covers.
    $scratchTarballs = Join-Path $prefix ".qa-tarballs"
    New-Item -ItemType Directory -Force -Path $scratchTarballs | Out-Null
    $pluginTarball = $env:QA_PLUGIN_TARBALL
    if (-not $pluginTarball) {
        $packed = npm pack --pack-destination $scratchTarballs $pluginSrc 2>$null | Select-Object -Last 1
        if ($packed) { $pluginTarball = Join-Path $scratchTarballs $packed }
    }
    if (-not $pluginTarball -or -not (Test-Path $pluginTarball)) {
        Write-Host "FAIL: could not obtain a plugin tarball from $pluginSrc"
        exit 1
    }
    $pluginsDir = Join-Path $prefix ".pi\dashboard\plugins\browser-plugin"
    New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
    tar -xzf $pluginTarball -C $pluginsDir --strip-components=1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL: could not unpack $pluginTarball"
        exit 1
    }
    # Only the overrides apply here: adding a dependency on the plugin itself
    # (its own tarball) would make npm install the package into itself.
    Write-Manifest (Join-Path $pluginsDir "package.json")
    Push-Location $pluginsDir
    npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
    $depCode = $LASTEXITCODE
    Pop-Location
    if ($depCode -ne 0) {
        Write-Host "FAIL: npm install (plugin deps) failed in $pluginsDir"
        exit 1
    }
    Set-PrefixHome
    Write-Host "installed dashboard + $pluginId plugin into $prefix (bin: $binDir)"

    # --- boot 1: DISCOVERY ---------------------------------------------------
    if (-not (Start-QaServerAndWait)) {
        Write-Host "FAIL: boot 1: /api/health never answered 200 on :$port"
        exit 1
    }
    Write-Host "boot 1: health 200"

    $plugins = Get-Plugins
    $discovered = @($plugins.plugins | ForEach-Object { $_.id })

    # X8 — an empty prefix cannot pass.
    if ($discovered.Count -eq 0) {
        Write-Host "FAIL: no plugins discovered in a prefix with the plugin installed (vacuous-green guard)"
        exit 1
    }
    Write-Host "discovered: $($discovered -join ' ')"

    if ($discovered -notcontains $pluginId) {
        Write-Host "FAIL: $pluginId is NOT in the discovered set: $($discovered -join ' ')"
        exit 1
    }
    Write-Host "$pluginId is discovered"

    # --- enable every discovered plugin, then boot 2 -------------------------
    # After discovery: `browser` is defaultEnabled:false, so without this the
    # second boot never attempts it (X9).
    $cfgPath = Join-Path $prefix ".pi\dashboard\config.json"
    New-Item -ItemType Directory -Force -Path (Split-Path $cfgPath) | Out-Null
    $cfg = @{}
    if (Test-Path $cfgPath) {
        try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json -AsHashtable } catch { $cfg = @{} }
    }
    if (-not $cfg.ContainsKey("plugins") -or $null -eq $cfg["plugins"]) { $cfg["plugins"] = @{} }
    foreach ($id in $discovered) {
        if (-not $cfg["plugins"].ContainsKey($id)) { $cfg["plugins"][$id] = @{} }
        $cfg["plugins"][$id]["enabled"] = $true
    }
    $cfg | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $cfgPath
    Write-Host "enabled all discovered plugins"

    Stop-QaServer
    if (-not (Start-QaServerAndWait)) {
        Write-Host "FAIL: boot 2: /api/health never answered 200 on :$port"
        exit 1
    }
    Write-Host "boot 2: health 200"

    # --- X7: the launcher reports the plugin loaded --------------------------
    $logText = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { "" }
    if ($logText -notmatch [regex]::Escape("Loaded plugin ""$pluginId""")) {
        Write-Host "FAIL: log has no 'Loaded plugin ""$pluginId""' after a clean-prefix boot"
        ($logText -split "`n" | Select-String -Pattern "plugin-loader|Failed to load" | Select-Object -First 10) | ForEach-Object { Write-Host $_ }
        exit 1
    }
    Write-Host "log: 'Loaded plugin ""$pluginId""'"

    # --- X10: no ERRORED plugin ---------------------------------------------
    # `loaded:false` alone is legitimate (missing dep / unmet requirement).
    $plugins = Get-Plugins
    $errors = @($plugins.plugins | Where-Object { $_.status -and $_.status.error })
    if ($errors.Count -gt 0) {
        Write-Host "FAIL: plugin(s) reported a load error:"
        $errors | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.id, $_.status.error) }
        exit 1
    }
    Write-Host "no plugin reported a load error"

    # --- X11: every LOADED plugin must come from the install prefix ----------
    # This is the assertion that actually holds the line; the log scan below is
    # only a secondary signal. `discoverPlugins()` searches a monorepo checkout as
    # well as the install, and a checkout-sourced plugin that wins discovery BY ID
    # loads cleanly, satisfies X7 and X10, and never names a path in the log — so
    # a log scan alone reports a clean run over the wrong tree. `packageDir` is
    # the only surface that distinguishes them.
    $outside = @((Get-Plugins).plugins | Where-Object {
        $_.status -and $_.status.loaded -and
        (-not $_.packageDir -or -not $_.packageDir.StartsWith($prefix + "\", [System.StringComparison]::OrdinalIgnoreCase))
    } | ForEach-Object { "$($_.id): $(if ($_.packageDir) { $_.packageDir } else { '<missing packageDir>' })" })
    if ($outside.Count -gt 0) {
        Write-Host "FAIL: loaded plugin(s) outside the install prefix (wrong-tree contamination):"
        $outside | ForEach-Object { Write-Host "  $_" }
        exit 1
    }

    # --- X11: no plugin path outside the prefix ------------------------------
    # Any `/plugins/` path named in the log must be inside the prefix. On a
    # healthy boot there are none, which is why the X8/X9 guards above carry the
    # anti-vacuity weight.
    $stray = [regex]::Matches($logText, '[A-Za-z]:\\[^"\s]*\\plugins\\[^"\s)*]*') |
        ForEach-Object { $_.Value } |
        Where-Object { -not $_.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 5
    if ($stray.Count -gt 0) {
        Write-Host "FAIL: a plugin path outside the install prefix appeared in the log (wrong-tree contamination):"
        $stray | ForEach-Object { Write-Host "  $_" }
        exit 1
    }
    if ($env:QA_REPO_ROOT -and $logText.Contains($env:QA_REPO_ROOT)) {
        Write-Host "FAIL: the log references the checkout $($env:QA_REPO_ROOT) — a monorepo checkout can masquerade as the install"
        exit 1
    }
    Write-Host "no plugin path outside the prefix"

    Write-Host "PASS: clean-prefix plugin install-load (X7-X11)"
} finally {
    Stop-QaServer
    if ($ownPrefix -and (Test-Path $prefix)) { Remove-Item -Recurse -Force $prefix -ErrorAction SilentlyContinue }
}
