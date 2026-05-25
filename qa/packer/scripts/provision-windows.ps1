# Windows provisioning: nvm-windows, Node.js LTS, Git, VS Build Tools
$ErrorActionPreference = "Stop"

# After a Chocolatey install, the *current* PowerShell session's PATH is
# stale: Choco updates the system Path in the registry, but the running
# process keeps the snapshot it inherited at launch. Worse, the new
# entries often use env-var indirections (e.g. %NVM_HOME%, %NVM_SYMLINK%)
# whose underlying variables ALSO need to be re-imported — just rebuilding
# $env:Path leaves those unexpanded and PATH-lookup fails.
#
# This helper re-imports the COMPLETE Machine + User env block into the
# current Process scope so subsequent commands see the same environment
# a freshly-spawned shell would. Idempotent; safe to call repeatedly.
function Update-Environment {
    foreach ($scope in 'Machine', 'User') {
        $vars = [System.Environment]::GetEnvironmentVariables($scope)
        foreach ($key in $vars.Keys) {
            if ($key -ieq 'Path') { continue }  # PATH handled specially below
            [System.Environment]::SetEnvironmentVariable($key, $vars[$key], 'Process')
        }
    }
    # PATH is the concatenation of Machine + User PATHs. Re-set on Process
    # AFTER importing the env vars above so any %VAR% references inside
    # PATH expand correctly.
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

Write-Host "=== Installing Chocolatey ==="
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Update-Environment
}
Write-Host "Chocolatey: $(choco --version)"

Write-Host "=== Installing Git ==="
choco install git -y --no-progress
Update-Environment
Write-Host "Git: $(git --version)"

Write-Host "=== Installing nvm-windows ==="
choco install nvm -y --no-progress
Update-Environment

Write-Host "=== Installing Node.js LTS ==="
nvm install lts
nvm use lts
Update-Environment
Write-Host "Node: $(node --version)"
Write-Host "npm: $(npm --version)"

Write-Host "=== Installing Visual Studio Build Tools ==="
# Install VS Build Tools with C++ workload for native module compilation (node-pty)
choco install visualstudio2022buildtools -y --no-progress --package-parameters `
    "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait"

Write-Host "=== Enabling OpenSSH Server ==="
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
# Set default shell to PowerShell for SSH
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
    -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -PropertyType String -Force

Write-Host "=== Windows provisioning complete ==="
