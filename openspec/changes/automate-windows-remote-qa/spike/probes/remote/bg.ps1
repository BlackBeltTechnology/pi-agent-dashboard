# Launch a marker node process by <Mode>, print what was launched. Used to test
# whether a process started inside an sshd session survives session close.
param([string]$Mode)
$cmdFile = "C:\spike\bg-$Mode.cmd"
Set-Content -Path $cmdFile -Encoding ascii -Value "@node -e ""setInterval(()=>{},1000)"" spike-$Mode"
switch ($Mode) {
  'startprocess' { Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmdFile -WindowStyle Hidden }
  'cmdstart'     { cmd /c start "" /b $cmdFile }
  'wmi'          { $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd /c $cmdFile" }; "wmi rc=$($r.ReturnValue)" }
  'taskIT'       { & C:\spike\launch-task.ps1 -Exe cmd.exe -TaskArgs "/c $cmdFile" -Logon Interactive -Name "spike-bg-$Mode" }
  'taskS4U'      { & C:\spike\launch-task.ps1 -Exe cmd.exe -TaskArgs "/c $cmdFile" -Logon S4U -Name "spike-bg-$Mode" }
}
Start-Sleep -Seconds 3
$ps = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*spike-$Mode*" })
"launched: " + (($ps | ForEach-Object { "pid=$($_.ProcessId) session=$($_.SessionId)" }) -join '; ')
