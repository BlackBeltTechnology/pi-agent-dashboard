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
  # Win 11 WinPE ships drivers for lsisas1068 (LSI Logic SAS) but NOT
  # for the default "lsilogic" (LSI Logic Parallel). Without this, the
  # Setup disk picker shows an empty list with "Hardware not showing up?
  # Load driver to access your hardware." prompt. Switching to
  # lsisas1068 makes the disk visible immediately. NVMe + SATA also work,
  # but lsisas1068 stays closest to the existing packer-vmware default
  # and doesn't change other vmx layout.
  disk_adapter_type = "lsisas1068"
  network          = "nat"
  # Plugin v2.x requires explicit adapter type. e1000e is the
  # widely-supported default on modern Windows + Fusion.
  network_adapter_type = "e1000e"

  # Windows 11 hard requirements: UEFI firmware with Secure Boot enabled
  # AND a TPM 2.0 device. Without these the installer halts at
  # "The PC must support TPM 2.0 / Secure Boot". Packer's vmware-iso
  # builder exposes them via `vmx_data` (raw .vmx key/value injection).
  # See: VMware KB 95934, Fusion 13+ supports virtual TPM 2.0.
  vmx_data = {
    "firmware"                  = "efi"
    "uefi.secureBoot.enabled"   = "TRUE"
    "managedvm.autoAddVTPM"     = "software"
    # VMware encrypts the .vmx + virtual disk when a vTPM is attached;
    # `encryption.required` opts into the lightweight "encryption for vTPM"
    # variant that does NOT prompt for a passphrase (the encryption key is
    # auto-managed). Without this, the build hangs at first power-on.
    "encryption.required"       = "TRUE"
    "encryption.required.vTPM"  = "TRUE"

    # Explicitly declare a TPM device. `managedvm.autoAddVTPM` is a
    # higher-level Fusion convenience that *should* infer this, but on
    # some Fusion 13.x builds the auto-add only fires when the VM is
    # created via the GUI — Packer's vmware-iso builder doesn't trigger
    # it. Adding the literal device key makes vTPM presence deterministic.
    "tpm.present"               = "TRUE"

    # Nested virtualization assist. Win 11 25H2 enables VBS (HVCI) by
    # default, which requires hardware virt extensions visible to the
    # guest. Without `vhv.enable`, early kernel init triggers a
    # CRITICAL_PROCESS_DIED BSOD that the firmware auto-restarts —
    # exactly the "shows Windows logo, restarts" symptom.
    "vhv.enable"                = "TRUE"

    # Hide the hypervisor signature from cpuid so Win 11 doesn't
    # short-circuit some startup checks expecting bare-metal-like CPU.
    # See: VMware KB 1009458.
    "hypervisor.cpuid.v0"       = "FALSE"

    # Explicit boot order: HDD first, CDROM as fallback. On the FIRST
    # boot the empty SCSI disk has no bootable partition so firmware
    # falls through to the CDROM and the Windows installer ISO loads.
    # On every SUBSEQUENT boot the disk has Windows' EFI bootloader
    # written to its ESP and firmware boots directly from it — the
    # Boot Manager menu is bypassed entirely. Without this key the
    # default UEFI behaviour is to land in the menu on every boot,
    # which causes Setup to either restart from CDROM (install loop)
    # or stall at the menu waiting for keyboard input.
    "bios.bootOrder"            = "hdd,cdrom"
    "bios.bootDelay"            = "0"
    "bios.forceSetupOnce"       = "FALSE"
  }

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

  # With `bios.bootOrder = "hdd,cdrom"` set in vmx_data above, the
  # firmware boots without showing the Boot Manager menu. On the
  # first power-on the empty disk falls through and CDROM (the Win
  # 11 installer ISO) loads; subsequent reboots auto-pick the disk
  # once Setup writes the EFI bootloader. We only need to dismiss
  # the installer's "Press any key to boot from CD or DVD" prompt.
  boot_wait = "10s"
  boot_command = [
    "<enter><enter><enter><enter><enter>"
  ]
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
