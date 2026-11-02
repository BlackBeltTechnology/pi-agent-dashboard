Add-Type -Namespace W -Name J -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
[DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr j, int cls, IntPtr buf, int len, IntPtr ret);
'@
$inJob = $false
[void][W.J]::IsProcessInJob([W.J]::GetCurrentProcess(), [IntPtr]::Zero, [ref]$inJob)
$buf = [Runtime.InteropServices.Marshal]::AllocHGlobal(512)
$ok = [W.J]::QueryInformationJobObject([IntPtr]::Zero, 9, $buf, 512, [IntPtr]::Zero)
$flags = -1
if ($ok) { $flags = [Runtime.InteropServices.Marshal]::ReadInt32($buf, 16) }
$p = Get-Process -Id $PID
$o = [ordered]@{
  session = $p.SessionId; user = (whoami); interactive = [Environment]::UserInteractive
  temp = $env:TEMP; psver = "$($PSVersionTable.PSVersion)"
  inJob = $inJob; limitFlags = ('0x{0:X}' -f $flags)
  killOnClose = (($flags -band 0x2000) -ne 0); breakawayOk = (($flags -band 0x800) -ne 0); silentBreakaway = (($flags -band 0x1000) -ne 0)
  npmOnPath = ((($env:Path -split ';') | Where-Object { $_ -match 'npm' }) -join '|')
  node = ((Get-Command node -ErrorAction SilentlyContinue).Source)
}
$o | ConvertTo-Json -Compress
