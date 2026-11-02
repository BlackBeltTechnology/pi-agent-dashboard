# npm-global mode, run inside a Bypass -File script (npm.ps1 shim needs a non-Restricted policy).
param([string]$Ver = '0.10.0', [ValidateSet('inSession','wmi')][string]$StartMode = 'inSession')
"wrong name: " + ((& npm view '@blackbelt-technology/pi-dashboard' version 2>&1 | Select-Object -Last 2) -join ' | ')
$sw = [Diagnostics.Stopwatch]::StartNew()
$o = & npm i -g "@blackbelt-technology/pi-agent-dashboard@$Ver" 2>&1 | Select-Object -Last 4
"install rc=$LASTEXITCODE sec=$([math]::Round($sw.Elapsed.TotalSeconds)) :: $($o -join ' | ')"
"which: $((Get-Command pi-dashboard -ErrorAction SilentlyContinue).Source)"
"version: $(& pi-dashboard --version 2>&1)"
if ($StartMode -eq 'inSession') { "start: " + ((& pi-dashboard start 2>&1) -join ' | ') }
else { $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c pi-dashboard start' }; "wmi start rc=$($r.ReturnValue)"; Start-Sleep -Seconds 10 }
"status: " + ((& pi-dashboard status 2>&1) -join ' | ')
