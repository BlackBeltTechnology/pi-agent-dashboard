# Why does PS 5.1 Invoke-WebRequest to localhost time out while the server is up on 127.0.0.1?
param([int]$Port = 8000)
"session=$((Get-Process -Id $PID).SessionId) ps=$($PSVersionTable.PSVersion)"
"dns localhost -> " + (([Net.Dns]::GetHostAddresses('localhost') | ForEach-Object { $_.ToString() }) -join ',')
"listen: " + ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ',')
"system proxy for localhost: " + ([Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]"http://localhost:$Port/"))
foreach ($u in "http://localhost:$Port/api/health", "http://127.0.0.1:$Port/api/health") {
  foreach ($t in 2, 10) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec $t; $res = "HTTP $($r.StatusCode)" } catch { $res = "ERR $($_.Exception.Message)" }
    "IWR $u timeout=$t -> $res in $([math]::Round($sw.Elapsed.TotalSeconds,2))s"
  }
}
$sw = [Diagnostics.Stopwatch]::StartNew()
try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('::1', $Port); $res = 'connected' } catch { $res = "ERR $($_.Exception.Message)" }
"tcp [::1]:$Port -> $res in $([math]::Round($sw.Elapsed.TotalSeconds,2))s"
