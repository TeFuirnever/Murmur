; [20260912_Feat_272DistCli] Windows installer PATH integration for the
; packaged `murmur` CLI (ticket #272). Included by electron-builder via
; package.json build.nsis.include.
;
; Manual acceptance steps (release owner, on a real machine — CI cannot
; verify installer-time PATH edits):
;   1. Run Murmur-Setup-*.exe and complete the install.
;   2. Open a NEW terminal (existing processes keep the old PATH) with no
;      system Node.js installed and run: murmur --version
;      -> prints the app version, exits 0.
;   3. Re-install over the existing install, then in a new shell run
;      ([Environment]::GetEnvironmentVariable('Path','User') -split ';')
;      -> resources\cli appears exactly once (no duplicates).
;   4. Uninstall, open a new terminal: `murmur` no longer resolves and the
;      resources\cli entry is gone from the user Path.
;
; Mechanism: [Environment]::SetEnvironmentVariable(..., 'User') writes
; HKCU\Environment AND broadcasts WM_SETTINGCHANGE, so newly opened shells
; pick up the change without a reboot — the reason raw registry writes via
; WriteRegStr are NOT used. No NSIS plugin dependency (ExecWait only).
; The user Path is guarded against duplicate entries and handles an empty
; or missing user Path.

!macro customInstall
  ; Append $INSTDIR\resources\cli to the USER Path (HKCU) when absent.
  ; NSIS string escaping: $$ -> literal $ (PowerShell variables), $\" ->
  ; literal double quote (PowerShell -Command wrapper); $INSTDIR expands at
  ; install time. Single quotes pass through so PowerShell receives the
  ; path quoted (install paths may contain spaces, e.g. under a user name
  ; with a space in %LOCALAPPDATA%\Programs\murmur).
  ExecWait "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"$$cliDir='$INSTDIR\resources\cli'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($$null -eq $$p) { $$p='' }; if (($$p -split ';') -notcontains $$cliDir) { [Environment]::SetEnvironmentVariable('Path', ($$p.TrimEnd(';') + ';' + $$cliDir).TrimStart(';'), 'User') }$\""
!macroend

!macro customUnInstall
  ; Remove the $INSTDIR\resources\cli entry from the USER Path (HKCU).
  ; Removing the last entry yields an empty string, which deletes the Path
  ; value (the correct end state when Murmur owned the only entry).
  ExecWait "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"$$cliDir='$INSTDIR\resources\cli'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($$p) { $$n=($$p -split ';' | Where-Object { $$_ -ne $$cliDir }) -join ';'; [Environment]::SetEnvironmentVariable('Path', $$n, 'User') }$\""
!macroend
