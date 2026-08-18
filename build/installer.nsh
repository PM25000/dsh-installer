!macro customInit
  ; Stop any running instance of a previous install before copying files, so an
  ; upgrade cannot fail on locked executables. Mirrors the reference
  ; deepseek-harness-desktop/build/installer.nsh.
  InitPluginsDir
  File /oname=$PLUGINSDIR\cleanup-stale-processes.ps1 "${BUILD_RESOURCES_DIR}\cleanup-stale-processes.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-stale-processes.ps1" -InstallDirectory "$INSTDIR"'
  Pop $0
  Pop $1
  Sleep 600
!macroend
