# Cross-Platform QA Testing with VMware Fusion + Packer
#
# Prerequisites:
#   - Packer (https://packer.io)
#   - VMware Fusion (free personal license)
#   - vmrun CLI (bundled with VMware Fusion)
#
# Usage:
#   make build-linux-x86    Build Ubuntu x86 base image
#   make build-linux-arm    Build Ubuntu ARM base image
#   make build-windows      Build Windows 11 base image
#   make build-macos-x86    Provision macOS x86 base image
#   make build-macos-arm    Provision macOS ARM base image
#   make test-linux-x86     Run test suite on Linux x86
#   make test-linux-arm     Run test suite on Linux ARM
#   make test-windows       Run test suite on Windows
#   make test-macos-x86     Run test suite on macOS x86
#   make test-macos-arm     Run test suite on macOS ARM
#   make test-all           Run test suite on all platforms
#   make manual-<target>    Boot clone with GUI for manual use
#   make clean              Destroy all cloned VMs

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Directories
PACKER_DIR := packer
OUTPUT_DIR := output
SCRIPTS_DIR := scripts

# SSH settings
SSH_USER := qa
SSH_KEY := $(HOME)/.ssh/qa_vm_key
SSH_TIMEOUT := 120

# vmrun path (macOS VMware Fusion default)
VMRUN := /Applications/VMware\ Fusion.app/Contents/Library/vmrun

# ─── Build targets ───────────────────────────────────────────────

# Preflight: reject var files that still contain REPLACE_WITH_ placeholders
# and missing user-data SSH key, with a helpful message.
define check_placeholders
	@if grep -l 'REPLACE_WITH_' $(1) >/dev/null 2>&1; then \
		echo "ERROR: $(1) contains placeholder values (REPLACE_WITH_...)."; \
		echo "       Fill in ISO URL/checksum (or source_vmx) before building."; \
		grep -n 'REPLACE_WITH_' $(1); \
		exit 1; \
	fi
endef

define check_user_data
	@if grep -q 'REPLACE_WITH_YOUR_PUBLIC_KEY' $(PACKER_DIR)/http/user-data 2>/dev/null; then \
		echo "ERROR: $(PACKER_DIR)/http/user-data still has a placeholder SSH key."; \
		echo "       Replace REPLACE_WITH_YOUR_PUBLIC_KEY with the contents of ~/.ssh/qa_vm_key.pub"; \
		exit 1; \
	fi
endef

# `packer init .` scans every .pkr.hcl in the directory, which fails
# because each template redeclares common variables (`vm_name`,
# `cpus`, `ssh_username`, etc.). Pass the specific template file to
# `packer init` so only that file's variable/required_plugin block is
# evaluated. See: https://github.com/hashicorp/packer/issues/12260
.PHONY: build-linux-x86
build-linux-x86:
	$(call check_placeholders,$(PACKER_DIR)/vars/ubuntu-24.pkrvars.hcl)
	$(call check_user_data)
	cd $(PACKER_DIR) && packer init ubuntu-x86.pkr.hcl && \
	packer build -var-file=vars/ubuntu-24.pkrvars.hcl ubuntu-x86.pkr.hcl

.PHONY: build-linux-arm
build-linux-arm:
	$(call check_placeholders,$(PACKER_DIR)/vars/ubuntu-24-arm.pkrvars.hcl)
	$(call check_user_data)
	cd $(PACKER_DIR) && packer init ubuntu-arm.pkr.hcl && \
	packer build -var-file=vars/ubuntu-24-arm.pkrvars.hcl ubuntu-arm.pkr.hcl

.PHONY: build-windows
build-windows:
	$(call check_placeholders,$(PACKER_DIR)/vars/win-11.pkrvars.hcl)
	cd $(PACKER_DIR) && packer init windows.pkr.hcl && \
	packer build -var-file=vars/win-11.pkrvars.hcl windows.pkr.hcl

.PHONY: build-macos-x86
build-macos-x86:
	$(call check_placeholders,$(PACKER_DIR)/vars/macos-14.pkrvars.hcl)
	cd $(PACKER_DIR) && packer init macos-x86.pkr.hcl && \
	packer build -var-file=vars/macos-14.pkrvars.hcl macos-x86.pkr.hcl

.PHONY: build-macos-arm
build-macos-arm:
	$(call check_placeholders,$(PACKER_DIR)/vars/macos-14-arm.pkrvars.hcl)
	cd $(PACKER_DIR) && packer init macos-arm.pkr.hcl && \
	packer build -var-file=vars/macos-14-arm.pkrvars.hcl macos-arm.pkr.hcl

.PHONY: build-all
build-all: build-linux-x86 build-linux-arm build-windows build-macos-x86 build-macos-arm

# ─── Test targets ────────────────────────────────────────────────

.PHONY: test-linux-x86
test-linux-x86:
	@$(SCRIPTS_DIR)/run-test.sh linux-x86 $(OUTPUT_DIR)/ubuntu-x86 $(SSH_USER) $(SSH_KEY) $(SSH_TIMEOUT)

.PHONY: test-linux-arm
test-linux-arm:
	@$(SCRIPTS_DIR)/run-test.sh linux-arm $(OUTPUT_DIR)/ubuntu-arm $(SSH_USER) $(SSH_KEY) $(SSH_TIMEOUT)

.PHONY: test-windows
test-windows:
	@$(SCRIPTS_DIR)/run-test.sh windows $(OUTPUT_DIR)/windows $(SSH_USER) $(SSH_KEY) $(SSH_TIMEOUT)

.PHONY: test-macos-x86
test-macos-x86:
	@$(SCRIPTS_DIR)/run-test.sh macos-x86 $(OUTPUT_DIR)/macos-x86 $(SSH_USER) $(SSH_KEY) $(SSH_TIMEOUT)

.PHONY: test-macos-arm
test-macos-arm:
	@$(SCRIPTS_DIR)/run-test.sh macos-arm $(OUTPUT_DIR)/macos-arm $(SSH_USER) $(SSH_KEY) $(SSH_TIMEOUT)

.PHONY: test-all
test-all: test-linux-x86 test-linux-arm test-windows test-macos-x86 test-macos-arm

# ─── Manual targets ──────────────────────────────────────────────

.PHONY: manual-linux-x86
manual-linux-x86:
	@$(SCRIPTS_DIR)/vm-clone.sh $(OUTPUT_DIR)/ubuntu-x86 manual-linux-x86 gui

.PHONY: manual-linux-arm
manual-linux-arm:
	@$(SCRIPTS_DIR)/vm-clone.sh $(OUTPUT_DIR)/ubuntu-arm manual-linux-arm gui

.PHONY: manual-windows
manual-windows:
	@$(SCRIPTS_DIR)/vm-clone.sh $(OUTPUT_DIR)/windows manual-windows gui

.PHONY: manual-macos-x86
manual-macos-x86:
	@$(SCRIPTS_DIR)/vm-clone.sh $(OUTPUT_DIR)/macos-x86 manual-macos-x86 gui

.PHONY: manual-macos-arm
manual-macos-arm:
	@$(SCRIPTS_DIR)/vm-clone.sh $(OUTPUT_DIR)/macos-arm manual-macos-arm gui

# ─── Clean targets ───────────────────────────────────────────────

.PHONY: clean
clean:
	@$(SCRIPTS_DIR)/vm-destroy.sh --all

.PHONY: clean-manual-%
clean-manual-%:
	@$(SCRIPTS_DIR)/vm-destroy.sh manual-$*

# ─── Help ────────────────────────────────────────────────────────

.PHONY: help
help:
	@echo "Cross-Platform QA Testing"
	@echo ""
	@echo "Build base images:"
	@echo "  make build-linux-x86    Ubuntu 24.04 x86_64"
	@echo "  make build-linux-arm    Ubuntu 24.04 aarch64"
	@echo "  make build-windows      Windows 11 x86_64"
	@echo "  make build-macos-x86    macOS 14 x86_64"
	@echo "  make build-macos-arm    macOS 14 aarch64"
	@echo "  make build-all          Build all images"
	@echo ""
	@echo "Run tests:"
	@echo "  make test-linux-x86     Test on Ubuntu x86"
	@echo "  make test-linux-arm     Test on Ubuntu ARM"
	@echo "  make test-windows       Test on Windows"
	@echo "  make test-macos-x86     Test on macOS x86"
	@echo "  make test-macos-arm     Test on macOS ARM"
	@echo "  make test-all           Test all platforms"
	@echo ""
	@echo "Manual access:"
	@echo "  make manual-<target>    Boot clone with GUI"
	@echo "  make clean-manual-<t>   Destroy manual clone"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean              Destroy all clones"
