# schtasks.exe /IT variant: run in the user's interactive session if one exists.
param([string]$Exe, [string]$Name = 'spike-it')
$o = schtasks.exe /Create /TN $Name /TR "`"$Exe`"" /SC ONCE /ST 23:59 /IT /F /RU "$env:USERDOMAIN\$env:USERNAME" 2>&1 | Out-String
"create rc=$LASTEXITCODE $o"
$o = schtasks.exe /Run /TN $Name 2>&1 | Out-String
"run rc=$LASTEXITCODE $o"
Start-Sleep -Seconds 4
schtasks.exe /Query /TN $Name /V /FO LIST 2>&1 | Select-String 'Status|Last Result|Logon Mode|Run As' | ForEach-Object { $_.Line }
Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Exe)) -ErrorAction SilentlyContinue | ForEach-Object { "proc pid=$($_.Id) session=$($_.SessionId)" }
