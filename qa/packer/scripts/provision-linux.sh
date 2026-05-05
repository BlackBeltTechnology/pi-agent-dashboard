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

echo "=== Cleaning up apt cache ==="
sudo apt-get autoremove -y
sudo apt-get clean

echo "=== Linux provisioning complete ==="
