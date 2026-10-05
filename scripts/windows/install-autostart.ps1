# Starts Hearth automatically when you sign in to Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
#   ... -Kiosk      also open Hearth full screen in Edge (for a dedicated screen)
#   ... -Remove     undo
param([switch]$Kiosk, [switch]$Remove)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$startup = [Environment]::GetFolderPath('Startup')
$serverLink = Join-Path $startup 'Hearth.lnk'
$kioskLink = Join-Path $startup 'Hearth Kiosk.lnk'

if ($Remove) {
  Remove-Item $serverLink, $kioskLink -ErrorAction SilentlyContinue
  Write-Host 'Hearth will no longer start automatically.' -ForegroundColor Green
  exit 0
}

$shell = New-Object -ComObject WScript.Shell

$link = $shell.CreateShortcut($serverLink)
$link.TargetPath = Join-Path $root 'scripts\windows\start-hearth.bat'
$link.WorkingDirectory = $root
$link.WindowStyle = 7   # minimized
$link.Description = 'Hearth family calendar server'
$link.Save()
Write-Host "Hearth will start (minimized) when you sign in." -ForegroundColor Green

if ($Kiosk) {
  $link = $shell.CreateShortcut($kioskLink)
  $link.TargetPath = Join-Path $root 'scripts\windows\kiosk.bat'
  $link.WorkingDirectory = $root
  $link.WindowStyle = 7
  $link.Save()
  Write-Host 'Hearth will also open full screen in Edge. Press Alt+F4 to leave kiosk mode.' -ForegroundColor Green
}
