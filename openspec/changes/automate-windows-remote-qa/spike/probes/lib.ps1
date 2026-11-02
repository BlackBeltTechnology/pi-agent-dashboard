# Runner-side helpers (pwsh 7). The runner plays "orchestrator"; sshd on the
# same runner plays "remote Windows QA host". Only Windows OpenSSH client is used.
$global:SSH = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$global:SCP = "$env:WINDIR\System32\OpenSSH\scp.exe"
$global:Key = "$env:USERPROFILE\.ssh\spike_ed25519"
$global:Target = "$env:USERNAME@localhost"
$global:SshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=NUL',
    '-o', 'BatchMode=yes', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=10')
$global:PS = 'powershell -NoProfile -ExecutionPolicy Bypass -File'

function Invoke-Native([string]$Exe, [string[]]$ArgList, [int]$TimeoutSec = 600) {
    $psi = [Diagnostics.ProcessStartInfo]::new($Exe)
    foreach ($a in $ArgList) { $psi.ArgumentList.Add($a) }
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = [Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    $done = $p.WaitForExit($TimeoutSec * 1000)
    if (-not $done) { try { $p.Kill($true) } catch {} }
    [void]$o.Wait(5000); [void]$e.Wait(5000)
    $rc = if ($done) { $p.ExitCode } else { 'TIMEOUT' }
    [pscustomobject]@{ rc = $rc; sec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        out = "$($o.Result)".Trim(); err = "$($e.Result)".Trim() }
}
function Invoke-Remote([string]$Cmd, [int]$TimeoutSec = 600) { Invoke-Native $SSH ($SshOpts + @($Target, $Cmd)) $TimeoutSec }
function Invoke-Scp([string[]]$ArgList, [int]$TimeoutSec = 600) { Invoke-Native $SCP ($SshOpts + $ArgList) $TimeoutSec }

function Tail([string]$s, [int]$n = 1500) { if ($s.Length -gt $n) { '…' + $s.Substring($s.Length - $n) } else { $s } }
function Result([string]$Id, $Obj) {
    if ($Obj -is [pscustomobject] -and $Obj.PSObject.Properties['out']) {
        Write-Host "::group::$Id full output"; Write-Host $Obj.out; if ($Obj.err) { Write-Host "--stderr--"; Write-Host $Obj.err }; Write-Host "::endgroup::"
        $Obj = [ordered]@{ rc = $Obj.rc; sec = $Obj.sec; out = (Tail $Obj.out 600); err = (Tail $Obj.err 300) }
    }
    Write-Host ("RESULT {0} {1}" -f $Id, ($Obj | ConvertTo-Json -Compress -Depth 6))
}

function Wait-Health([int]$Sec = 180, [int[]]$Ports = @(8000, 8112)) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $Sec) {
        foreach ($p in $Ports) {
            try {
                $h = Invoke-RestMethod -Uri "http://localhost:$p/api/health" -TimeoutSec 3 -ErrorAction Stop
                return [ordered]@{ ok = $true; port = $p; sec = [math]::Round($sw.Elapsed.TotalSeconds); starter = $h.starter; version = $h.version; launchSource = $h.launchSource }
            } catch {}
        }
        Start-Sleep -Seconds 2
    }
    [ordered]@{ ok = $false; sec = $Sec }
}

function Snap([string]$Name) {
    $r = Invoke-Remote "$PS C:\spike\snapshot.ps1 -Out C:\spike\snap-$Name.json" 120
    if ($r.rc -ne 0) { Result "snap.$Name" $r }
    "C:\spike\snap-$Name.json"
}
function Compare-Snap([string]$BasePath, [string]$NowPath) {
    $base = Get-Content $BasePath -Raw | ConvertFrom-Json
    $now = Get-Content $NowPath -Raw | ConvertFrom-Json
    Write-Host "snap sizes: $((Get-Item $BasePath).Length) / $((Get-Item $NowPath).Length)"
    $d = [ordered]@{}
    foreach ($k in $now.PSObject.Properties.Name) {
        $x = @($base.$k | Where-Object { $_ -ne $null }); $y = @($now.$k | Where-Object { $_ -ne $null })
        $c = @(Compare-Object -ReferenceObject $x -DifferenceObject $y -ErrorAction SilentlyContinue)
        $add = @($c | Where-Object SideIndicator -eq '=>' | ForEach-Object InputObject)
        $rem = @($c | Where-Object SideIndicator -eq '<=' | ForEach-Object InputObject)
        if ($add.Count -or $rem.Count) { $d[$k] = [ordered]@{ added = $add; removed = $rem } }
    }
    $d
}
function Dump-AppLogs([string]$Id) {
    $r = Invoke-Remote "$PS C:\spike\applogs.ps1" 60
    Write-Host "::group::$Id app logs"; Write-Host $r.out; Write-Host "::endgroup::"
}
function Clean([string]$Id) { $r = Invoke-Remote "$PS C:\spike\remote-clean.ps1" 300; Result "$Id.clean" $r; $r }
