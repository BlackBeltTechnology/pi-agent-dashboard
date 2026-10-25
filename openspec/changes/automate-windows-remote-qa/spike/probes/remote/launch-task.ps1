# Register + start a scheduled task running <Exe> as the current user with the given logon type.
param([string]$Exe, [string]$TaskArgs = '', [ValidateSet('Interactive','S4U')][string]$Logon, [string]$Name)
$user = "$env:USERDOMAIN\$env:USERNAME"
try {
  if ($TaskArgs) { $a = New-ScheduledTaskAction -Execute $Exe -Argument $TaskArgs } else { $a = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory (Split-Path $Exe) }
  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType $Logon
  Register-ScheduledTask -TaskName $Name -Action $a -Principal $pr -Force -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $Name -ErrorAction Stop
  Start-Sleep -Seconds 3
  $i = Get-ScheduledTaskInfo -TaskName $Name
  "cim task=$Name logon=$Logon state=$((Get-ScheduledTask -TaskName $Name).State) lastResult=0x{0:X}" -f $i.LastTaskResult
} catch { "cim task FAILED: " + ($_ | Out-String) }
