param([string]$Exe)
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "`"$Exe`""; CurrentDirectory = (Split-Path $Exe) }
"wmi rc=$($r.ReturnValue) pid=$($r.ProcessId)"
