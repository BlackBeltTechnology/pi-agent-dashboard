#!/usr/bin/env bash
# Linux (Ubuntu) provisioning: system packages + common prereqs
set -euo pipefail

echo "=== Updating apt ==="
sudo apt-get update -y
sudo apt-get upgrade -y

echo "=== Installing build tools and dependencies ==="
sudo apt-get install -y \
  build-essential \
  curl \
  git \
  openssh-server \
  python3 \
  ca-certificates \
  xvfb \
  libnss3 \
  libgtk-3-0 \
  libgbm1 \
  libasound2

echo "=== Enabling SSH ==="
sudo systemctl enable ssh
sudo systemctl start ssh

echo "=== Running common provisioner (nvm + Node.js) ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/provision-common.sh"

echo "=== Provisioning the sudo-askpass QA user (non-NOPASSWD) ==="
# `qa/tests/58-sudo-askpass-fallback.sh` needs a user that sudo really challenges
# (the `qa` user is NOPASSWD:ALL): known password, listed in sudoers WITHOUT NOPASSWD.
# sudo-rs is best-effort: it is not packaged on every Ubuntu release, and the test
# marks an absent / unsupported flavour instead of failing.
# See change: add-sudo-credential-prompt (tasks 1.1, 1.10).
sudo apt-get install -y sudo-rs || echo "NOTE: sudo-rs not available from apt on this release; the sudo-rs variant is skipped"
if ! id qa-sudo >/dev/null 2>&1; then
  sudo useradd --create-home --shell /bin/bash qa-sudo
fi
echo 'qa-sudo:qa-sudo-pass' | sudo chpasswd
echo 'qa-sudo ALL=(ALL:ALL) ALL' | sudo tee /etc/sudoers.d/qa-sudo >/dev/null
sudo chmod 440 /etc/sudoers.d/qa-sudo
sudo visudo -cf /etc/sudoers.d/qa-sudo

echo "=== Cleaning up apt cache ==="
sudo apt-get autoremove -y
sudo apt-get clean

echo "=== Linux provisioning complete ==="
