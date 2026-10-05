@echo off
rem Opens Hearth full screen in Microsoft Edge. Press Alt+F4 to exit.
rem Usage: kiosk.bat [url]   (default http://localhost:3000)
set "URL=%~1"
if "%URL%"=="" set "URL=http://localhost:3000"

rem Give the server a moment to start when launched at sign-in.
timeout /t 10 /nobreak >nul
start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run
