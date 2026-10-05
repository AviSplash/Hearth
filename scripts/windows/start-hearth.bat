@echo off
setlocal
title Hearth
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS version from https://nodejs.org, install it, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Installing Hearth - first run only, takes a minute...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo   npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node server\index.js
echo.
echo   Hearth stopped.
pause
