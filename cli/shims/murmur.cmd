@echo off
rem [20260912_Feat_272DistCli] Windows launcher shim for the packaged
rem `murmur` CLI (ticket #272). The NSIS installer adds resources\cli to the
rem USER Path at install time (build/installer.nsh), so cmd and PowerShell
rem resolve `murmur` to this script, which runs the CLI through the bundled
rem Electron runtime in ELECTRON_RUN_AS_NODE mode - no system Node.js needed.
rem
rem Packaged layout (Windows NSIS install):
rem   <root>\Murmur.exe                       <- Electron runtime binary
rem   <root>\resources\cli\shims\murmur.cmd   <- this file
rem   <root>\resources\cli\murmur.mjs         <- CLI entry
rem %~dp0 carries a trailing backslash and resolves relative paths, so the
rem `..` segments below reach the install root three levels up.
set "ELECTRON_RUN_AS_NODE=1"
set "MURMUR_RUNTIME=%~dp0..\..\..\Murmur.exe"
if not exist "%MURMUR_RUNTIME%" set "MURMUR_RUNTIME=%~dp0..\..\..\Electron.exe"
if not exist "%MURMUR_RUNTIME%" (
  echo murmur: Electron runtime not found inside the Murmur install. 1>&2
  exit /b 1
)
"%MURMUR_RUNTIME%" "%~dp0..\murmur.mjs" %*
