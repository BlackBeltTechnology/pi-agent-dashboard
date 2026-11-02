# Snapshot every location a pi-dashboard install/run could leave state in.
param([string]$Out)
$roots = [ordered]@{
  APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA
  LOCALAPPDATA_Programs = (Join-Path $env:LOCALAPPDATA 'Programs')
  USERPROFILE = $env:USERPROFILE; TEMP = $env:TEMP; C_ROOT = 'C:\'
  StartMenu = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
  Desktop = [Environment]::GetFolderPath('Desktop')
}
$snap = [ordered]@{}
foreach ($k in $roots.Keys) { $snap[$k] = @(Get-ChildItem -LiteralPath $roots[$k] -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object) }
$snap['HKCU_Uninstall'] = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName } | Sort-Object)
$snap['HKCU_Software'] = @(Get-ChildItem 'HKCU:\Software' -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName } | Sort-Object)
$npmRoot = $null
if (Get-Command npm -ErrorAction SilentlyContinue) { $npmRoot = (& npm root -g 2>$null | Out-String).Trim() }
$snap['npm_global'] = @()
if ($npmRoot -and (Test-Path $npmRoot)) {
  $snap['npm_global'] = @(Get-ChildItem $npmRoot -Directory | ForEach-Object { if ($_.Name -like '@*') { $s = $_.Name; Get-ChildItem $_.FullName -Directory | ForEach-Object { "$s/$($_.Name)" } } else { $_.Name } } | Sort-Object)
}
$snap['listeners'] = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8000,8112,9999 } | ForEach-Object { "$($_.LocalPort)" } | Sort-Object -Unique)
$snap['procs'] = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(pi-dashboard|electron|node)$' } | ForEach-Object { $_.Name } | Sort-Object -Unique)
$snap['tasks'] = @(Get-ScheduledTask -TaskName 'spike-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskName })
$snap | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $Out
"snapshot -> $Out"
