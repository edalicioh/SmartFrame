@echo off
setlocal
title SmartFrame
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-smartframe.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o SmartFrame. Veja a mensagem acima.
  pause
)
endlocal
