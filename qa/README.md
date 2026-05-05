# Cross-Platform QA Testing

Reproducible VM-based testing for pi-dashboard across macOS, Linux, and Windows.

## Prerequisites

- **[Packer](https://packer.io)** — `brew install packer`
- **[VMware Fusion](https://www.vmware.com/products/fusion.html)** — Free personal license, installed on both machines
- **SSH key pair** — `ssh-keygen -t ed25519 -f ~/.ssh/qa_vm_key -N ""`

### ISOs (download once)

| Platform | ISO | Download |
|----------|-----|----------|
| Ubuntu 24.04 x86 | `ubuntu-24.04-live-server-amd64.iso` | [releases.ubuntu.com](https://releases.ubuntu.com/24.04/) |
| Ubuntu 24.04 ARM | `ubuntu-24.04-live-server-arm64.iso` | [cdimage.ubuntu.com](https://cdimage.ubuntu.com/releases/24.04/release/) |
| Windows 11 x86 | `Win11_Eval.iso` | [microsoft.com/evalcenter](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise) |
| macOS 14 Sonoma | Via App Store or `softwareupdate` | Manual install required |

Place ISOs in `qa/iso/` (gitignored) or update paths in the var files.

## Hardware Setup

| Machine | Role | Targets |
|---------|------|---------|
| Intel Mac (Desktop) | Primary builder | Ubuntu x86, Windows x86, macOS x86 |
| M1 Mac (Laptop) | ARM builder | Ubuntu ARM, macOS ARM |

## Quick Start

```bash
cd qa

# 1. Build a base image (first time only, ~15-30 min)
make build-linux-x86

# 2. Run tests against a clean clone
make test-linux-x86

# 3. Or open a VM for manual poking
make manual-linux-x86
# ... interact via GUI ...
make clean-manual-linux-x86
```

## Commands

### Build Base Images

```bash
make build-linux-x86    # Ubuntu 24.04 x86_64
make build-linux-arm    # Ubuntu 24.04 aarch64 (M1 Mac)
make build-windows      # Windows 11 x86_64
make build-macos-x86    # macOS 14 x86_64 (see macOS section below)
make build-macos-arm    # macOS 14 aarch64 (M1 Mac, see below)
make build-all          # Build everything
```

### Run Tests

```bash
make test-linux-x86     # Test on Ubuntu x86
make test-linux-arm     # Test on Ubuntu ARM
make test-windows       # Test on Windows
make test-macos-x86     # Test on macOS x86
make test-macos-arm     # Test on macOS ARM
make test-all           # All platforms
```

### Manual Access

```bash
make manual-linux-x86   # Boot clone with GUI
# ... interact ...
make clean-manual-linux-x86  # Destroy when done
```

### Cleanup

```bash
make clean              # Destroy all cloned VMs (keeps base images)
```

## Rebuilding Images

When the OS version changes or you need fresh prereqs:

1. Update the var file (e.g., `packer/vars/ubuntu-24.pkrvars.hcl`) with new ISO URL/checksum
2. `make build-linux-x86` — rebuilds from scratch

## macOS VM Setup

macOS has no unattended install. Manual one-time setup is required:

### Initial macOS VM Install (one-time)

1. **Create VM in VMware Fusion**:
   - File → New → Install from disc or image
   - Select macOS Sonoma installer
   - Allocate 4+ CPU cores, 8GB+ RAM, 80GB+ disk
   - Name the VM exactly as expected by the var file (e.g., `macos-14-x86`)

2. **Install macOS** through the GUI installer

3. **Create the QA user account**:
   - Username: `qa`
   - Password: (as set in var file)

4. **Enable SSH**:
   ```bash
   sudo systemsetup -setremotelogin on
   ```

5. **Install SSH key**:
   ```bash
   mkdir -p ~/.ssh
   # Copy your qa_vm_key.pub content into authorized_keys
   echo "YOUR_PUBLIC_KEY" >> ~/.ssh/authorized_keys
   chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
   ```

6. **Shut down the VM**

7. **Run Packer to provision prereqs**:
   ```bash
   make build-macos-x86   # Provisions Homebrew, Xcode CLI Tools, nvm, Node
   ```

The Packer macOS template uses `vmware-vmx` builder (starts from existing VM) rather than `vmware-iso`.

## What the Tests Verify

1. **Install** — `npm install -g @blackbelt-technology/pi-dashboard` succeeds (node-pty compiles)
2. **Server start** — `pi-dashboard start` runs, health endpoint responds HTTP 200
3. **WebSocket** — Connections to pi gateway (9999) and browser WS gateway succeed
4. **Terminal** — PTY spawning works (ConPTY on Windows, pty on Unix)
5. **Git operations** — Branch listing works from server API
6. **Electron ZIP V2 bootstrap (Windows only)** — `qa/tests/07-electron-bootstrap-v2.ps1`. Extracts the production `PI-Dashboard-win32-x64.zip`, launches `pi-dashboard.exe`, waits for `/api/health`, asserts `starter==Electron` and that `~\.pi-dashboard\` is populated with the version marker, `pi-coding-agent` from the offline cacache, and an intact `cliPath` (catches the cpSync-symlink and npm-pruning regression class). Skips when the ZIP artifact is absent.

   **Uploading the ZIP to the test VM**: `qa/scripts/run-test.sh` looks for `packages/electron/out/make/zip/x64/PI-Dashboard-win32-x64.zip` by default and `scp`s it to `C:\qa-artifacts\` before running the test suite. Override with `QA_ELECTRON_ZIP=/path/to/zip make test-windows`.

7. **Electron real-launch smoke (Linux)** — `qa/tests/08-electron-real-launch.sh`. Launches AppImage under `xvfb-run --no-sandbox`. Asserts `/api/health` 200 within 90s, `starter==Electron`, `~/.pi/dashboard/server.log` non-empty, no `FATAL` substring in Electron parent stdout. Catches v0.4.6 regression class: jiti-FATAL on degraded managed dir + `spawnDetached` `stdio[1]='ignore'` producing 0-byte logs. Skips when AppImage artifact absent under `packages/electron/out/make/` (run `npm run make` to build). Requires `xvfb` on QA VM (provisioned via `qa/packer/scripts/provision-linux.sh`).

## Directory Structure

```
qa/
├── Makefile                    # Build/test/manual/clean targets
├── README.md                   # This file
├── packer/
│   ├── ubuntu-x86.pkr.hcl     # Linux x86 Packer template
│   ├── ubuntu-arm.pkr.hcl     # Linux ARM Packer template
│   ├── windows.pkr.hcl        # Windows Packer template
│   ├── macos-x86.pkr.hcl      # macOS x86 Packer template
│   ├── macos-arm.pkr.hcl      # macOS ARM Packer template
│   ├── scripts/
│   │   ├── provision-common.sh # Shared: nvm + Node.js LTS
│   │   ├── provision-linux.sh  # apt, build-essential, git
│   │   ├── provision-macos.sh  # Homebrew, Xcode CLI Tools
│   │   └── provision-windows.ps1  # VS Build Tools, Git, nvm-windows
│   ├── http/
│   │   ├── user-data           # Ubuntu cloud-init autoinstall
│   │   └── autounattend.xml    # Windows unattended install
│   └── vars/
│       ├── ubuntu-24.pkrvars.hcl
│       ├── ubuntu-24-arm.pkrvars.hcl
│       ├── win-11.pkrvars.hcl
│       ├── macos-14.pkrvars.hcl
│       └── macos-14-arm.pkrvars.hcl
├── scripts/
│   ├── run-test.sh             # Test orchestrator (clone → test → destroy)
│   ├── vm-clone.sh             # Clone base image
│   ├── vm-wait-ssh.sh          # Wait for SSH readiness
│   └── vm-destroy.sh           # Stop and delete clone
├── tests/
│   ├── 01-install.sh           # npm install test
│   ├── 02-server-start.sh      # Server start test
│   ├── 03-websocket.sh         # WebSocket connection test
│   ├── 04-terminal.sh          # Terminal spawning test
│   ├── 05-git-ops.sh           # Git operations test
│   ├── 08-electron-real-launch.sh # Real Electron launch smoke. xvfb + AppImage. Skips when AppImage absent.
│   ├── run-all.sh              # Run all tests, report results
│   └── *.ps1                   # Windows PowerShell equivalents
├── iso/                        # ISOs (gitignored)
└── output/                     # Built images (gitignored)
```
