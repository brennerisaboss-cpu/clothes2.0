@echo off
REM Double-click this to start the resale tracker.
setlocal
cd /d "%~dp0"

REM PowerShell does the real work: finding a Node new enough, fetching one if
REM there is none, then handing over to the launcher. This file exists only
REM because a .ps1 is not double-clickable by default on Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 pause
endlocal
