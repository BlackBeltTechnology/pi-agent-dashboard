packer {
  required_plugins {
    vmware = {
      version = ">= 1.0.0"
      source  = "github.com/hashicorp/vmware"
    }
  }
}

variable "iso_url" {
  type = string
}

variable "iso_checksum" {
  type = string
}

variable "vm_name" {
  type    = string
  default = "windows-11-x86"
}

variable "guest_os" {
  type    = string
  default = "windows9-64"
}

variable "cpus" {
  type    = number
  default = 2
}

variable "memory" {
  type    = number
  default = 4096
}

variable "disk_size" {
  type    = number
  default = 65536
}

variable "ssh_username" {
  type    = string
  default = "qa"
}

variable "ssh_password" {
  type    = string
  default = "qa"
}

variable "ssh_timeout" {
  type    = string
  default = "45m"
}

source "vmware-iso" "windows" {
  iso_url      = var.iso_url
  iso_checksum = var.iso_checksum

  vm_name          = var.vm_name
  guest_os_type    = var.guest_os
  cpus             = var.cpus
  memory           = var.memory
  disk_size        = var.disk_size
  disk_type_id     = "0"
  network          = "nat"
  # Plugin v2.x requires explicit adapter type. e1000e is the
  # widely-supported default on modern Windows + Fusion.
  network_adapter_type = "e1000e"

  # Windows uses WinRM or SSH — we use SSH (OpenSSH installed via autounattend)
  communicator     = "ssh"
  ssh_username     = var.ssh_username
  ssh_password     = var.ssh_password
  ssh_timeout      = var.ssh_timeout
  ssh_handshake_attempts = 200

  shutdown_command = "shutdown /s /t 10 /f"

  output_directory = "../output/${var.vm_name}"

  # Provide autounattend.xml via floppy
  floppy_files = [
    "http/autounattend.xml"
  ]

  # Boot wait for Windows installer
  boot_wait = "5s"
}

build {
  sources = ["source.vmware-iso.windows"]

  # Wait for Windows to finish setup and SSH to become available
  provisioner "shell-local" {
    inline = ["echo 'Waiting for Windows setup to complete...'"]
  }

  # Upload and run provisioning script
  provisioner "powershell" {
    script = "scripts/provision-windows.ps1"
  }

  # Restart after VS Build Tools install
  provisioner "windows-restart" {
    restart_timeout = "15m"
  }

  # Verify installation
  provisioner "powershell" {
    inline = [
      "Write-Host '=== Verification ==='",
      "node --version",
      "npm --version",
      "git --version",
      "Write-Host '=== All verified ==='"
    ]
  }
}
