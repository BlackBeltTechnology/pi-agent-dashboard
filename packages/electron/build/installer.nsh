; packages/electron/build/installer.nsh
;
; Custom NSIS include for the PI Dashboard installer.
; Extends electron-builder's generated NSIS script via its documented
; macro-override points (customHeader / customInstall / customRemoveFiles).
; Inspired by the JUDO designer reference
; (judo-ng/eclipse/judo-epp-designer/designer-product/install.nsi) but ported
; to MUI2 idiom and slimmed to extension-only code.
;
; Per-user install only (perMachine:false in electron-builder-nsis.json):
;   - No install-mode page (MULTIUSER_PAGE_INSTALLMODE is NOT inserted).
;   - SHCTX resolves to HKCU; all WriteReg*/DeleteReg* land in HKCU.
;
; See: https://www.electron.build/configuration/nsis#custom-nsis-script

; ----------------------------------------------------------------
; customHeader — fires before MUI2 page macros are inserted.
; ----------------------------------------------------------------

!macro customHeader
  BrandingText "BlackBelt Technology — PI Dashboard"
!macroend

; ----------------------------------------------------------------
; customInstall — fires inside the main install Section, after
; electron-builder has written the standard Add/Remove entry.
;
; Augment the uninstall registry entry with the JUDO-style fields
; electron-builder does not write by default: DisplayIcon, NoModify,
; NoRepair. (DisplayName/Publisher/DisplayVersion/UninstallString/
; QuietUninstallString/InstallLocation/EstimatedSize are written by
; electron-builder.)
;
; SHCTX is HKCU (per-user mode) — no branching needed.
; ${UNINSTALL_APP_KEY} is electron-builder's internal leaf-key name;
; dereference via the define so a future electron-builder rename does
; not silently drift the path.
; ----------------------------------------------------------------

!define UNINSTALL_REGISTRY_KEY_PATH \
  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

!macro customInstall
  WriteRegStr   SHCTX "${UNINSTALL_REGISTRY_KEY_PATH}" \
                "DisplayIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr   SHCTX "${UNINSTALL_REGISTRY_KEY_PATH}" \
                "Publisher" "BlackBelt Technology"
  WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY_PATH}" "NoModify" 1
  WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY_PATH}" "NoRepair" 1

  ; Vendor-namespaced install marker — lets a future updater
  ; (windows-authenticode-signing + fix-electron-auto-update-pipeline)
  ; detect a prior install without walking Apps & Features.
  WriteRegStr SHCTX "Software\BlackBelt Technology\PI Dashboard" \
              "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "Software\BlackBelt Technology\PI Dashboard" \
              "Version" "${VERSION}"
!macroend

; ----------------------------------------------------------------
; customRemoveFiles — fires inside the Uninstall Section, replacing
; electron-builder's default file-removal step.
;
; Defensive: $INSTDIR is our install dir, NOT $PROFILE\.pi or
; $PROFILE\.pi-dashboard. RMDir /r is scoped to our dir alone.
; User-data preservation is announced in the post-uninstall MessageBox.
; ----------------------------------------------------------------

!macro customRemoveFiles
  RMDir /r "$INSTDIR"

  ; Remove our vendor-namespaced marker (the Add/Remove Programs entry
  ; itself is removed by electron-builder).
  DeleteRegKey SHCTX "Software\BlackBelt Technology\PI Dashboard"

  ; Inform the user that session data + agent runtime are preserved.
  ; /SD IDOK so silent uninstalls (/S) do not block.
  MessageBox MB_OK|MB_ICONINFORMATION \
    "PI Dashboard has been uninstalled.$\r$\n$\r$\nYour sessions, agent runtime, and settings remain in:$\r$\n  $PROFILE\.pi$\r$\n  $PROFILE\.pi-dashboard$\r$\n$\r$\nDelete these folders manually for a complete removal." \
    /SD IDOK
!macroend
