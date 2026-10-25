foreach ($f in @("$env:TEMP\pi-dashboard-electron.log", "$env:USERPROFILE\.pi\dashboard\server.log", "$env:USERPROFILE\.pi\dashboard\qa-test-app.log", "$env:USERPROFILE\.pi\dashboard\qa-test-app.log.err", "$env:TEMP\pi-dash-electron-out.log", "$env:TEMP\pi-dash-electron-err.log")) {
  if (Test-Path $f) { "===== $f ($((Get-Item $f).Length) bytes)"; Get-Content $f -Tail 40 } else { "===== ${f}: absent" }
}
Get-Process -Name pi-dashboard, node -ErrorAction SilentlyContinue | ForEach-Object { "proc $($_.Name) pid=$($_.Id) session=$($_.SessionId)" }
