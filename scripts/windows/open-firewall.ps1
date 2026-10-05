# Lets tablets and phones on your Wi-Fi reach Hearth.
# Run from an Administrator PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\open-firewall.ps1
param([int]$Port = 3000, [int]$HttpsPort = 3443)

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host 'Please run this from an Administrator PowerShell (right-click PowerShell > Run as administrator).' -ForegroundColor Yellow
  exit 1
}

Get-NetFirewallRule -DisplayName 'Hearth *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Hearth (HTTP)' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
New-NetFirewallRule -DisplayName 'Hearth (HTTPS)' -Direction Inbound -Protocol TCP -LocalPort $HttpsPort -Action Allow -Profile Private,Domain | Out-Null
Write-Host "Firewall rules added for ports $Port and $HttpsPort on Private networks." -ForegroundColor Green

$public = Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public'
foreach ($p in $public) {
  Write-Host ''
  Write-Host "Your network '$($p.Name)' ($($p.InterfaceAlias)) is set to Public, so the rule won't apply to it." -ForegroundColor Yellow
  Write-Host "If this is your home network, make it Private with:"
  Write-Host "  Set-NetConnectionProfile -InterfaceAlias '$($p.InterfaceAlias)' -NetworkCategory Private"
}
